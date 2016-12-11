/*
 *  (C) 2016
 *  Booz Allen Hamilton, All rights reserved
 *  Powered by InnoVision, created by the GIAT
 *
 *  Endpoint.js was developed at the
 *  National Geospatial-Intelligence Agency (NGA) in collaboration with
 *  Booz Allen Hamilton [http://www.boozallen.com]. The government has
 *  "unlimited rights" and is releasing this software to increase the
 *  impact of government investments by providing developers with the
 *  opportunity to take things in new directions.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

/* jshint -W097 */
/* globals __filename */

'use strict';

var Endpoint = require('../../endpoint/endpoint'),
    inherits = require('util').inherits,
    addressTool = require('../../routing/address'),
    xtend = require('xtend'),
    uuid = require('uuid'),
    constants = require('../../util/constants'),
    appUtils = require('../../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Query, Endpoint);

module.exports = Query;

/**
 * Perform a query for adapters and return the results.  Query is used by Facade,
 * however you can use it yourself you wish to find all adapters that expose an API.
 * @example
 * var query = window.endpoint.createQuery('mapapi', '1.0');
 * query.on('api', function() {
 *   console.log('found api');
 * });
 * query.on('closed', function() {
 *   console.log('query finished / timed out');
 *   var totalApis = query.getFoundApisCount();
 *   var apis = query.getFoundApis();
 * });
 * @augments Endpoint
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings
 * @param {String} settings.name - the name of the api to query for
 * @param {String} settings.version - the version of the api to query for
 * @param {Object} [settings.criteria] - the criteria of the api to query for
 * @param {String} [settings.neighborhood] - the bus mode to use {@see constants.Neighborhood}
 * @param {String} [settings.bridgeId] - send query to only links that are on this bridge
 * @param {String} [settings.hostId] - send query only to this host
 * @param {Boolean} [settings.tryForever] - whether to continue sending out bus messages until the adapter is found
 * @constructor
 */
function Query(endpointManager, settings) {
    if (!(this instanceof Query)) {
        return new Query(endpointManager, settings);
    }

    // Call parent constructor
    Query.super_.call(this,
        endpointManager,
        {
            type: constants.EndpointType.QUERY,
            id: uuid()
        }
    );

    // Register the messenger to receive messages from externals
    this.registerDefaultMessengerListener();

    // Facade request timeout
    this.getEndpointManager().registerPeriodic(this);

    // Register for router events
    var router = this.getEndpointManager().getService('router');
    this.registerObjectEvent(router, 'route-available', this._routeAvailable.bind(this));
    this.registerObjectEvent(router, 'route-unavailable', this._routeLost.bind(this));

    // Settings
    this._periodicCounter = 0;
    this._name = settings.name;
    this._version = settings.version;
    this._criteria = settings.criteria;
    this._bridgeId = settings.bridgeId;
    this._hostId = settings.hostId;
    this._tryForever = settings.tryForever;
    this._maxHops = endpointManager.getConfiguration().get('maxHops');
    this._queryNeighborhood = appUtils.getNeighborhood(settings.neighborhood, 'local');

    // Operational Data
    this._foundApis = {};
    this._foundApisCount = 0;
    this._searchQueued = false;

    // This is a special case. Because we can't know for sure if something came from
    // a global or universal source, if the user says they're looking for 'global' data,
    // then we'll accept responses from 'universal'.
    this._acceptNeighborhood = this._queryNeighborhood ==
        constants.Neighborhood.GLOBAL ? constants.Neighborhood.UNIVERSAL : this._queryNeighborhood;

    // Register for bus messages related to new local adapters being registered
    // after this query was created.  Saves a few seconds
    var event = 'register|' + this.getName() + '|' + this.getVersion();
    this.registerBusEvent(event, this._adapterRegistered.bind(this));

    // Search for endpoints that we can communicate with.  Wait till
    // next tick so that the user can add 'ready' listeners, in case
    // we're connecting to a local facade.
    this.searchAdapter(this._queryNeighborhood, this._bridgeId, this._hostId, this._criteria);

}

/**
 * Returns the name of the adapter
 * @returns {*}
 */
Query.prototype.getName = function() {
    return this._name;
};

/**
 * Returns the version of the adapter
 * @returns {*}
 */
Query.prototype.getVersion = function() {
    return this._version;
};

/**
 * Return each API interface found at query completion
 * @returns {*}
 */
Query.prototype.getFoundApis = function() {
    return this._foundApis;
};

/**
 * Return each API interface found at query completion
 * @returns {*}
 */
Query.prototype.getFoundApisCount = function() {
    return this._foundApisCount;
};

/**
 * If an adjacent route joined during query, then emit the bus packet directly
 * to that host.
 * @param fromUuid
 * @param route
 * @private
 */
Query.prototype._routeAvailable = function(fromUuid, route) {
    if (route.adjacent) {
        if (this._hostId) {
            return;
        }
        // Emit directly to this new host.
        this.searchAdapter(this._queryNeighborhood, this._bridgeId, fromUuid, this._criteria);
    }
};

/**
 * If an adjacent route is lost, and we're trying to get to that host, then
 * tell the facade the host has died.
 * @param fromUuid
 * @private
 */
Query.prototype._routeLost = function(fromUuid) {
    // If hostId is specified and host disconnects, then emit something to facade to timeout
    if (this._hostId == fromUuid) {
        this.emit('timeout');
        this.close();
    }
};

/**
 * If an adapter registers after we sent out our search request, then re-send
 * our search locally to ensure that we can connect.
 * @param source
 * @param address
 * @private
 */
Query.prototype._adapterRegistered = function(address, source) {
    // Ensure that the source is within the expected neighborhood
    if (source > constants.Neighborhood.LOCAL) {
        return;
    }

    // Resend our search locally.
    this.searchAdapter(constants.Neighborhood.LOCAL, null, null, this._criteria);
};

/**
 * This is executed by endpoint manager to ensure that this facade hasn't become
 * stale.
 * @private
 */
Query.prototype.performPeriodic = function(closing) {
    if (!closing) {
        this._periodicCounter++;
        if (this._periodicCounter % 2 === 0) {
            if (!this._tryForever) {
                if (this._foundApisCount === 0) {
                    this.emit('timeout');
                }
                this.close();
            }
            else {
                if (this._foundApisCount === 0) {
                    log.log(log.WARN, 'Could not find a suitable Adapter. Check the \'neighborhood\' settings on' +
                        ' both the Facade and Adapter to ensure they are high enough.');
                }
            }
            // Execute the search again!
            this.searchAdapter(this._queryNeighborhood, this._bridgeId, this._hostId, this._criteria);
        }
    }
};

/**
 * Search for and establish affinity with the given API.
 * @param criteria
 * @private
 */
Query.prototype.searchAdapter = function(neighborhood, bridgeId, hostId, criteria) {

    if (!this._searchQueued) {
        log.log(log.DEBUG3, 'Queuing search request for %s', this);
        appUtils.nextTick(function() {
            this._searchQueued = false;

            log.log(log.DEBUG2, 'Sending a search request [Name: %s] [Bridge: %s] [Host: %s]',
                this.getName(), bridgeId, hostId);

            // Create query for adapter.
            var query = {
                id: this.getId(),
                criteria: {}
            };
            if (criteria) {
                query.criteria = xtend(criteria);
            }

            // Build the address
            var address = 'adapter|' + this.getName() + '|' + this.getVersion();

            // Send out a request for adapter.
            if (bridgeId || hostId) {
                this.getBus().emitDirect(bridgeId, hostId, neighborhood, address, query);
            }
            else {
                this.getBus().emit(neighborhood, address, query);
            }
        }.bind(this));

        // Ensure future search requests are ignored
        this._searchQueued = true;
    }
};

/**
 * When a response comes from an external host
 * @private
 */
Query.prototype._handleMessage = function(response, source) {

    // Ensure that the source is within the expected neighborhood
    if (source > this._acceptNeighborhood) {
        return;
    }

    switch (response.type) {

        case 'api':
            if (!this._foundApis[response.id]) {
                response.address = addressTool(response.address);
                response.neighborhood = source;
                if (response.address.isValid(this._maxHops)) {
                    this._foundApis[response.id] = response;
                    this._foundApisCount += 1;
                    this.emit('api', response);
                }
            }
            break;
    }

};
