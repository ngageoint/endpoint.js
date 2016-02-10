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
/* globals process,__filename */
'use strict';

var Endpoint = require('../../endpoint/endpoint'),
    EventEmitter = require('events').EventEmitter,
    inherits = require('util').inherits,
    format = require('util').format,
    uuid = require('node-uuid'),
    constants = require('../../util/constants'),
    addressTool = require('../../routing/address'),
    clientInstance = require('./client-instance'),
    resolver = require('./resolver'),
    appUtils = require('../../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Adapter, Endpoint);

module.exports = Adapter;

/**
 * An Adapter is one of the two main parts of the Endpoint.js API (along with Facade) and performs two roles:
 * - Expose functions of an object to be executed remotely
 * - Emit events to remote clients
 * @example <caption>Creating an adapter</caption>
 * var adapter = window.endpoint.registerAdapter('mapapi', '1.0', mapapi);
 * @augments Endpoint
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings
 * @param {String} settings.name - the name of this api
 * @param {String} settings.version - the version of this api
 * @param {String} settings.resolver - used to determine whether to respond to queries
 * @param {String} settings.metadata - the metadata used by the resolver
 * @param {String} settings.object - the object api to expose
 * @param {String} settings.neighborhood - whether to accept local, group (default), or universal messages
 * @constructor
 */
function Adapter(endpointManager, settings) {
    if (!(this instanceof Adapter)) {
        return new Adapter(endpointManager, settings);
    }

    // Call parent constructor
    Adapter.super_.call(this,
        endpointManager,
        {
            type: constants.EndpointType.ADAPTER,
            id: uuid(),
            identification: format('[name: %s] [version: %s]', settings.name, settings.version)
        }
    );

    // Settings
    this._name = settings.name;
    this._version = '' + settings.version;
    this._object = settings.object || {};
    this._resolver = settings.resolver || resolver({instanceId: endpointManager.getInstanceId(), id: this.getId()});
    this._metadata = settings.metadata || {};
    this._neighborhood = appUtils.getNeighborhood(settings.neighborhood, 'group');

    if (this._neighborhood === constants.Neighborhood.GLOBAL) {
        this.close();
        throw new Error('Cannot use GLOBAL neighborhood for adapter. Must use UNIVERSAL');
    }

    var busAddress = 'adapter|' + this.getName() + '|' + this.getVersion();

    // Verify that there are no listeners currently for the given adapter.
    if (EventEmitter.listenerCount(this.getBus(), busAddress) > 0) {
        this.close();
        throw new Error('That adapter is already registered: ' + busAddress);
    }

    // Configuration
    this._maxAdapterInstances = endpointManager.getConfiguration().get('maxAdapterInstances');
    this._maxHops = endpointManager.getConfiguration().get('maxHops');

    // Operational Settings
    this._clientInstances = {};
    this._clientInstancesCount = 0;
    this._currentContext = null;
    this._facadeEvents = null;

    // Listen to the global bus for requests, and respond.
    this.registerBusEvent(busAddress, this._handleRegistryRequest.bind(this));

    // Listen for connect requests
    this.registerDefaultMessengerListener();

    log.log(log.DEBUG, 'Created %s', this);

    // Send out a notification that this adapter has been created locally.
    // This is done so that queries that are outstanding get a notification of the
    // api.
    var bus = this.getBus();
    var event = 'register|' + this.getName() + '|' + this.getVersion();
    appUtils.nextTick(function() {
        log.log(log.DEBUG2, 'Sending register event for %s', this);
        bus.emit(constants.Neighborhood.LOCAL, event);
    }.bind(this));
}

/**
 * Return the name of this adapter
 * @returns {*}
 */
Adapter.prototype.getName = function() {
    return this._name;
};

/**
 * This is the version of the interface
 */
Adapter.prototype.getVersion = function() {
    return this._version;
};

/**
 * Return the object we're adapted to.
 */
Adapter.prototype.getObject = function() {
    return this._object;
};

/**
 * Return a facade event emitter to send events to connected
 * facades
 */
Adapter.prototype.getEvents = function() {

    if (this._facadeEvents === null) {
        var _this = this;
        this._facadeEvents = {
            emit: function() {
                for (var instance in _this._clientInstances) {
                    _this._clientInstances[instance].getEvents().emit
                        .apply(_this._clientInstances[instance], arguments);
                }
            }
        };
    }

    return this._facadeEvents;
};

/**
 * Get the current metadata.
 */
Adapter.prototype.getMetadata = function() {
    return this._metadata;
};

/**
 * Set a key metadata
 * @param metadata
 */
Adapter.prototype.setMetadata = function(metadata) {
    this._metadata = metadata || {};
};

/**
 * Sets the context used by call context to execute a call
 * @param context
 */
Adapter.prototype.setCurrentContext = function(context) {
    this._currentContext = context;
};

/**
 * Get the current call context
 */
Adapter.prototype.getCurrentContext = function() {
    return this._currentContext;
};

/**
 * Determine if we should reply to this registry request.
 * @param query
 * @private
 */
Adapter.prototype._handleRegistryRequest = function(address, source, query) {

    // Ensure that the source is within the expected neighborhood
    if (source > this._neighborhood) {
        return;
    }

    log.log(log.TRACE, 'Adapter request: %s', this);

    if (this._clientInstancesCount >= this._maxAdapterInstances) {
        log.log(log.WARN, 'Max client instance count reached [%s], ignoring adapter request',
            this._clientInstancesCount);
        return;
    }

    if (this._resolver.resolve(query.criteria, this._metadata, address)) {
        log.log(log.DEBUG3, 'Responding to adapter request [for: %s]: %s',
            query.id,
            this);

        // Send the response
        this.getMessenger().sendMessage(
            address,
            query.id,
            {
                type: 'api',
                id: this.getId(),
                address: address.getPathVector()
            });
    }
};

/**
 * This occurs when a facade decides to use this adapter.  Create an instance for the
 * facade.
 * @param message
 * @private
 */
Adapter.prototype._handleMessage = function(message, source) {

    // Ensure that the source is within the expected neighborhood
    if (source > this._neighborhood) {
        return;
    }

    if (this._clientInstancesCount >= this._maxAdapterInstances) {
        return;
    }

    // Ensure valid message
    var address = addressTool(message.address);

    var inValid = !appUtils.isUuid(message.id) ||
        !address.isValid(this._maxHops) ||
        (message.hostAffinityId !== null && !appUtils.isUuid(message.hostAffinityId));

    if (inValid) {
        log.log(log.WARN, 'Invalid adapter request: %j', message);
        return;
    }

    var instance = clientInstance(
        this.getEndpointManager(),
        {
            remoteAddress: address,
            remoteId: message.id,
            hostAffinityId: message.hostAffinityId,
            neighborhood: this._neighborhood,
            facadeId: message.facadeId,
            adapter: this
        }
    );

    this._clientInstances[instance.getId()] = instance;
    this._clientInstancesCount += 1;

    // When the instance closes, remove it from our list.
    instance.on('closed', function() {
        delete this._clientInstances[instance.getId()];
        this._clientInstancesCount -= 1;
    }.bind(this));

    this.emit('client-instance', instance);
};

/**
 * Cancel all strategies
 * @private
 */
Adapter.prototype._handleClose = function() {
    if (this._clientInstances) {
        var instances = Object.keys(this._clientInstances);
        for (var instance in instances) {
            this._clientInstances[instance].close();
        }
    }
};
