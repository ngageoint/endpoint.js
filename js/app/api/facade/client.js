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
    facade = require('./facade'),
    EventEmitter = require('events').EventEmitter,
    uuid = require('uuid'),
    format = require('util').format,
    constants = require('../../util/constants'),
    appUtils = require('../../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Client, Endpoint);

module.exports = Client;

/**
 * A client establishes an affinity with a remote client instance.  It manages host
 * affinity as well as operational affinity.  All facades created during this session
 * are managed by the client.  If the client is closed, all facades are closed. It
 * additionally manages event messaging for the client/client instance connection.
 * @augments Endpoint
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings
 * @param {String} settings.name - the name of the api to query for
 * @param {String} settings.version - the version of the api to query for
 * @constructor
 */
function Client(endpointManager, settings) {
    if (!(this instanceof Client)) {
        return new Client(endpointManager, settings);
    }

    // Call parent constructor
    Client.super_.call(this,
        endpointManager,
        {
            type: constants.EndpointType.CLIENT,
            id: uuid(),
            identification: format('[name: %s] [version: %s]', settings.name, settings.version)
        }
    );

    // Register the messenger to receive messages from externals
    this.registerDefaultMessengerListener();

    // This is a list of executing strategies
    this._eventEmitter = new EventEmitter();

    // Used for determining ready state.
    this._name = settings.name;
    this._version = settings.version;
    this._remoteConnected = false;

    // Tracked facades
    this._facades = {};

    // Operational Metadata
    this._remoteAddress = null;
    this._remoteId = null;
    this._hostAffinityId = null;

    // This is an extra security precaution.  Once we've connected to a remote
    // instance, we ensure that any messages transmitted to any facades or sub-facades
    // all originate with the given neighborhood.
    this._neighborhood = 0;

    // The parent facade id, once we issue a connect
    this._facadeId = null;

    log.log(log.DEBUG, 'Created %s', this);
}

/**
 * Returns the name of the adapter
 * @returns {*}
 */
Client.prototype.getName = function() {
    return this._name;
};

/**
 * Returns the version of the adapter
 * @returns {*}
 */
Client.prototype.getVersion = function() {
    return this._version;
};

/**
 * Returns the remote address of the client instance this facade
 * is connected to
 * @returns {*}
 */
Client.prototype.getRemoteAddress = function() {
    return this._remoteAddress;
};

/**
 * Who we accept messages from
 */
Client.prototype.getNeighborhood = function() {
    return this._neighborhood;
};

/**
 * Returns the remote id of the client instance this facade
 * is connected to
 * @returns {*}
 */
Client.prototype.getRemoteId = function() {
    return this._remoteId;
};

/**
 * Return the ID being used for host affinity
 * @returns {*}
 */
Client.prototype.getHostAffinityId = function() {
    return this._hostAffinityId;
};

/**
 * Return the event emitter
 * @returns {*}
 */
Client.prototype.getEvents = function() {
    return this._eventEmitter;
};

/**
 * Establish an affinity with the remote adapter.  This function will
 * take the address and id of the remote adapter, and send out a connect
 * request.  The adapter will create a client instance, assign an object
 * instance, and send the API directly back in a 'connect' response
 * @param remoteAddress
 * @param remoteId
 * @param neighborhood
 */
Client.prototype.connect = function(remoteAddress, remoteId, neighborhood, facadeId) {

    // This is the address of the adapter and the future client instance
    this._remoteAddress = remoteAddress;

    // Where the message originated from
    this._neighborhood = neighborhood;
    this._facadeId = facadeId;

    // Establish affinity with the host.
    this._hostAffinityId = this.getHostAffinity().establishHostAffinity(remoteAddress);
    this.trackEndpointAffinity(this._hostAffinityId);

    // Tell the adapter to create a client instance
    this.getMessenger().sendMessage(
        remoteAddress,
        remoteId, {
            id: this.getId(),
            address: remoteAddress.getPathVector(),
            hostAffinityId: this._hostAffinityId,
            facadeId: facadeId
        });
};

/**
 * When a response comes from an external host
 * @private
 */
Client.prototype._handleMessage = function(response, source) {
    // Ensure that the source is within the expected neighborhood
    if (source > this._neighborhood) {
        return;
    }

    switch (response.type) {

        case 'connect':
            if (appUtils.isUuid(response.id)) {
                this._remoteConnected = true;
                this._handleConnection(response);
            }
            break;

        case 'disconnect':
            this._remoteConnected = false;
            this.close();
            break;

        case 'event':
            this._eventEmitter.emit.apply(this._eventEmitter, response.event);
            break;
    }
};

/**
 * Upon initial connection with external client instance, the instance will report
 * the adapter's default interface API.  We take that and assign it to our only
 * pending facade.
 * @param response
 * @private
 */
Client.prototype._handleConnection = function(response) {
    // Remote client instance id
    this._remoteId = response.id;

    // Remote Object API
    var objectInstance = response.object;

    // Get our facade
    var facade = this._facades[this._facadeId];

    if (!facade) {
        var msg = 'Could not locate facade to assign API to for ';
        log.log(log.ERROR, msg + this);
        throw new Error(msg + this);
    }

    facade.assignObject(objectInstance);

    this.emit('ready');
};

/**
 * This function is used to create a child facade for this client.
 * Once created, the facade can be assigned an API
 * @param name - should follow <adapter name>.<function name>.<...> format
 * @param [parentEndpoint] - when the parent endpoint is closed, so is this facade
 */
Client.prototype.createFacadeInstance = function(name, parentEndpoint) {

    // Create the facade endpoint, and return it to the user
    var facadeInstance =
        facade(
            this.getEndpointManager(),
            {
                name: name,
                version: this.getVersion(),
                client: this
            });

    this._facades[facadeInstance.getId()] = facadeInstance;

    // When I close, then remove myself from the managed list of objects.
    facadeInstance.on('closed', function() {
        delete this._facades[facadeInstance.getId()];
    }.bind(this));

    // If the parent closes, then close me.
    parentEndpoint = parentEndpoint || this;
    parentEndpoint.attachEndpoint(facadeInstance);

    return facadeInstance;
};

/**
 * Cancels affinity and reports disconnect to the remote client instance.
 * Does not need to close individual facades, as they are all tied via
 * event emitters to the close event of this client.
 * @param affinityClosure - whether host affinity forced this closure
 * @private
 */
Client.prototype._handleClose = function(affinityClosure) {
    // Tell the remote we're closing!
    if (this._remoteConnected && !affinityClosure) {
        this.getMessenger().sendMessage(
            this._remoteAddress,
            this._remoteId, {
                id: this.getId(),
                type: 'disconnect'
            });
    }

    // Remove any host affinities
    if (this._remoteAddress) {
        this.getHostAffinity()
            .removeHostAffinity(this._remoteAddress, this._hostAffinityId);
    }
};
