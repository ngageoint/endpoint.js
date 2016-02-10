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
    format = require('util').format,
    objectInstance = require('./object-instance'),
    uuid = require('node-uuid'),
    constants = require('../../util/constants'),
    appUtils = require('../../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(ClientInstance, Endpoint);

module.exports = ClientInstance;

/**
 * This represents an instance of a remote facade for one of my published
 * adapters.  This client instance is an event emitter which is emitted
 * to an instance of an Endpoint.js adapter when someone tries to use it.
 * @augments Endpoint
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings
 * @param {String} settings.adapter - the adapter this client instance belongs to
 * @param {Address} settings.remoteAddress - the facade address
 * @param {String} settings.remoteId - the facade id
 * @param {String} settings.hostAffinityId - the id to listen to host affinity for disconnections
 * @param {Number} settings.neighborhood - the granularity of requests to accept
 * @param {String} settings.facadeId - the facade that will serve as the initial facade
 * @constructor
 */
function ClientInstance(endpointManager, settings) {
    if (!(this instanceof ClientInstance)) {
        return new ClientInstance(endpointManager, settings);
    }

    // Call parent constructor
    ClientInstance.super_.call(this,
        endpointManager,
        {
            type: constants.EndpointType.CLIENT_INSTANCE,
            id: uuid(),
            identification: format('[name: %s] [version: %s]', settings.adapter.getName(),
                settings.adapter.getVersion())
        }
    );

    // Register the streamer & messenger to receive messages from externals
    this.registerDefaultMessengerListener();

    // Configuration
    this._maxClientObjects = endpointManager.getConfiguration().get('maxClientObjects');

    // Pending call contexts
    this._facadeEvents = null;

    // Cache the input settings
    this._adapter = settings.adapter;
    this._remoteAddress = settings.remoteAddress;
    this._remoteId = settings.remoteId;
    this._hostAffinityId = settings.hostAffinityId;
    this._neighborhood = settings.neighborhood;

    // Start out as being 'connected' because we send the 'connect' statement below
    // to the facade
    this._remoteConnected = true;

    // This is the list of objects known to this instance
    this._objects = {};
    this._totalObjects = 0;

    // Bootstrap the object list with the initial object
    var rootObjectInstance = this.createObjectInstance(this._adapter.getName(),
            this._adapter.getObject(), settings.facadeId);

    // If the object instance closes, then treat the client as closing too.
    rootObjectInstance.attachEndpoint(this);

    // Tell the facade that we're here!
    this.getMessenger().sendMessage(
        this._remoteAddress,
        this._remoteId, {
        type: 'connect',
        id: this.getId(),
        object: rootObjectInstance.getApi()
    });

    // Setup host affinity listener
    this.trackEndpointAffinity(this._hostAffinityId);

    log.log(log.DEBUG, 'Created %s', this);
}

/**
 * Return the adapter referenced by this instance.
 * @returns {*}
 */
ClientInstance.prototype.getAdapter = function() {
    return this._adapter;
};

/**
 * This function is used mainly to retrieve object instances
 * when they are passed as arguments to other facade functions
 * @param  {String} id - unique identifer for the object
 * @return {ObjectInstance} - the given instance
 */
ClientInstance.prototype.getObjectInstance = function(id) {
    return this._objects[id];
};

/**
 * Returns the remote address of the facade this client instance
 * is connected to
 * @returns {*}
 */
ClientInstance.prototype.getRemoteAddress = function() {
    return this._remoteAddress;
};

/**
 * Returns the remote id of the facade this client instance
 * is connected to
 * @returns {*}
 */
ClientInstance.prototype.getRemoteId = function() {
    return this._remoteId;
};

/**
 * Return the ID being used for host affinity
 * @returns {*}
 */
ClientInstance.prototype.getHostAffinityId = function() {
    return this._hostAffinityId;
};

/**
 * Return a facade event emitter to send events to connected
 * facade
 */
ClientInstance.prototype.getEvents = function() {

    if (this._facadeEvents === null) {
        // Event Facade to send events to the connected facade
        var _this = this;
        this._facadeEvents = {
            emit: function() {
                var event = [];
                for (var i = 0; i < arguments.length; i++) {
                    event.push(arguments[i]);
                }
                _this.getMessenger().sendMessage(
                    _this._remoteAddress,
                    _this._remoteId,
                    {
                        type: 'event',
                        event: event
                    });
            }
        };
    }

    return this._facadeEvents;
};

/**
 * This function will take the given object, wrap it in an object instance
 * and store it locally, managing its lifespan
 * @param object
 * @param remoteId - the id of the remote facade
 * @param [parentEndpoint] - if the parent endpoint closes, so will this object
 */
ClientInstance.prototype.createObjectInstance = function(name, object, remoteId, parentEndpoint) {

    if (this._totalObjects > this._maxClientObjects) {
        log.log(log.WARN, 'Max client objects exceeded [total: %s] for %s', this._maxClientObjects, this);
        return null;
    }

    // Create the object endpoint, and return it to the user
    var objectInst =
        objectInstance(
            this.getEndpointManager(),
            {
                name: name,
                object: object,
                remoteId: remoteId,
                clientInstance: this
            });

    this._objects[objectInst.getId()] = objectInst;
    this._totalObjects += 1;

    // When I close, then remove myself from the managed list of objects.
    objectInst.on('closed', function() {
        delete this._objects[objectInst.getId()];
        this._totalObjects -= 1;
    }.bind(this));

    // If the parent closes, then close me.
    parentEndpoint = parentEndpoint || this;
    parentEndpoint.attachEndpoint(objectInst);

    return objectInst;
};

/**
 * Handle an API request from a remote facade.
 * @param message
 */
ClientInstance.prototype._handleMessage = function(message, source) {

    // Ensure that the source is within the expected neighborhood
    if (source > this._neighborhood) {
        return;
    }

    var callType = message.type;

    if (callType) {
        switch (callType) {
            case 'disconnect':
                this._remoteConnected = false;
                this.close();
                return;
        }
    }

    log.log(log.ERROR, 'Malformed message: %j for %s', message, this);
};

/**
 * Be sure to tell the remote client that we're closing.  All child object instances
 * will automatically be closed because they are attached to me.
 * @param affinityClosure - whether host affinity forced this closure
 * @private
 */
ClientInstance.prototype._handleClose = function(affinityClosure) {
    // Tell the remote we're closing!
    if (this._remoteConnected && !affinityClosure) {
        this.getMessenger().sendMessage(
            this._remoteAddress,
            this._remoteId, {
            id: this.getId(),
            type: 'disconnect'
        });
    }
};
