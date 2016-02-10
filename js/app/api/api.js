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

var adapter = require('./adapter/adapter'),
    client = require('./facade/client'),
    query = require('./facade/query'),
    facadeManager = require('./facade-manager'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

module.exports = Api;

/**
 * The Api class is added to the window and exposed as 'window.endpoint'.  It is
 * the main entry interface to call or execute methods within Endpoint.js
 * @param {EndpointManager} endpointManager - An instance of the EndpointManager class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function Api(endpointManager, config) {
    if (!(this instanceof Api)) { return new Api(endpointManager, config); }

    // Sender ID for this Endpoint.js.
    this._id = config.get('instanceId');

    // Used to pass to new instances of facade, query and adapter
    this._endpointManager = endpointManager;

    log.log(log.DEBUG, 'API Layer initialized');
}

/**
 * Return the Endpoint.js instance id for this API.
 * @returns {*}
 */
Api.prototype.getInstanceId = function() {
    return this._id;
};

/**
 * Return the endpoint manager
 * @returns {*}
 */
Api.prototype.getEndpointManager = function() {
    return this._endpointManager;
};

/**
 * This function will return the configuration used
 * to initially setup Endpoint.js.  This is useful in order
 * to add new links, remove links, or to add new sockets, workers, or windows
 * to existing links.
 */
Api.prototype.getConfiguration = function() {
    return this._endpointManager.getConfiguration();
};

/**
 * Search the registry and send out a request for a specific adapter name,
 * returing the created facade to the application.
 * @param name - name of the adapter to look for.
 * @param version - version of the adapter to look for.
 * @param {Object} [settings] - additional parameters
 * @param {Object} [settings.criteria] - options passed to the adapter's resolver
 * @param {String} [settings.neighborhood] - how wide of a request to make (default to group)
 * @param {String} [settings.bridgeId] - send query to only links that are on this bridge
 * @param {String} [settings.hostId] - send query only to this host
 * @param {Boolean} [settings.tryForever] - whether to continue sending out bus messages until the adapter is found
 */
Api.prototype.createQuery = function(name, version, settings) {
    settings = settings || {};
    // Create a facade.
    return query(
        this._endpointManager,
        {
            name: name,
            version: version,
            criteria: settings.criteria || {},
            neighborhood: settings.neighborhood || 'local',
            tryForever: settings.hasOwnProperty('tryForever') ? settings.tryForever : true,
            bridgeId: settings.bridgeId,
            hostId: settings.hostId
        }
    );
};

/**
 * Search the registry and send out a request for a specific adapter name,
 * returning the created facade to the application.  Additionally,
 * the request for adapters will be limited to internal servers only.
 * @param name - name of the adapter to look for.
 * @param version - version of the adapter to look for.
 * @param {Object} [settings] - additional parameters
 * @param {Object} [settings.criteria] - see createQuery.
 * @param {String} [settings.neighborhood] - how wide of a request to make (default to group)
 * @param {Object} [settings.api] - use the given api (from createQuery) instead of querying
 * @param {String} [settings.bridgeId] - send query to only links that are on this bridge
 * @param {String} [settings.hostId] - send query only to this host
 * @param {Boolean} [settings.tryForever] - whether to continue sending out bus messages until the adapter is found
 */
Api.prototype.createFacade = function(name, version, settings) {
    settings = settings || {};

    // Create a client.  The client manages the connection to the client instance,
    // as well as events.
    var clientInstance = client(
        this._endpointManager,
        {
            name: name,
            version: version
        }
    );

    // Create the initial parent facade
    var facade = clientInstance.createFacadeInstance(name);

    // If someone closes the facade, close the client.  The facade is
    // already attached to the client instance via the above command to
    // create it.  So, they are circularly dependent.
    facade.attachEndpoint(clientInstance, false);

    // This function will take the given api and tell the
    // client to connect to it.
    function connectClient(api) {
        clientInstance.connect(api.address, api.id, api.neighborhood, facade.getId());
    }

    // If we already have an api defined, then use it, otherwise create a query.
    if (!settings.api) {

        var query = this.createQuery(name, version, settings);
        query.on('api', function(api) {
            query.close();
            connectClient(api);
        });
        query.on('timeout', function() {
            log.log(log.WARN, 'A facade timed out for %s', this);
            facade.emit('timeout');
            facade.close();
        });

        // If someone closes the facade, then close the query.
        facade.attachEndpoint(query);
    }
    else {
        connectClient(settings.api);
    }

    return facade;
};

/**
 * Create and manage multiple facades
 */
Api.prototype.manageFacades = function() {
    var facadeMgr = facadeManager(this);
    try {
        for (var i = 0; i < arguments.length; i++) {
            var item = arguments[i];
            if (item.length < 2) {
                facadeMgr.close();
                throw new Error('Input error, invalid number of arguments for facade manager');
            }
            facadeManager.prototype.addFacade.apply(facadeMgr, item);
        }
    }
    catch (e) {
        log.log(log.ERROR, 'Could not create facade manager: %s, stack = %s', e.message, e.stack);
        facadeMgr.close();
        throw e;
    }
    return facadeMgr;
};

/**
 * This function is used to register the given object as an adapter within
 * the Endpoint.js registry.  An adapter is returned.
 * @param name - the exported name
 * @param version - the version
 * @param object - the object to export (functions starting with underscore are ignored)
 * @param {Object} [settings] - additional parameters
 * @param {Object} [settings.resolver] - object which specifies whether it responds to a request
 * @param {Object} [settings.metadata] - criteria used to compare against
 * @param {String} [settings.neighborhood] - how wide of a request to accept (default to group)
 */
Api.prototype.registerAdapter = function(name, version, object, settings) {
    settings = settings || {};
    // Create the adapter
    return adapter(
        this._endpointManager,
        {
            name: name,
            version: version,
            object: object,
            neighborhood: settings.neighborhood || 'group',
            resolver: settings.resolver,
            metadata: settings.metadata || {}
        }
    );
};
