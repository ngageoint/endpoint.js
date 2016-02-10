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
    isArray = require('util').isArray,
    uuid = require('node-uuid'),
    format = require('util').format,
    strategy = require('./strategy'),
    constants = require('../../util/constants'),
    appUtils = require('../../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Facade, Endpoint);

module.exports = Facade;

/**
 * The facade acts as an API interface between Endpoint.js and the rest of
 * the application for a specific adapter instance.  Facade functions
 * return strategy objects, which establish a route for the call,
 * and execute the call.
 * A Facade fulfills two roles:
 * - Execute functions on the adapter
 * - Receive events from the adapter
 * @example
 * var facade = window.endpoint.createFacade('mapapi', '1.0');
 * facade.on('ready', function() {
 *   var api = facade.getApi();
 *   var events = facade.getEvents();
 * };
 * @augments Endpoint
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings
 * @param {String} settings.name - the name of the api to query for
 * @param {String} settings.version - the version of the api to query for
 * @param {Object} settings.client - the client instance we belong to
 * @constructor
 */
function Facade(endpointManager, settings) {
    if (!(this instanceof Facade)) {
        return new Facade(endpointManager, settings);
    }

    // Call parent constructor
    Facade.super_.call(this,
        endpointManager,
        {
            type: constants.EndpointType.FACADE,
            id: uuid(),
            identification: format('[name: %s] [version: %s]', settings.name, settings.client.getVersion())
        }
    );

    // Register the messenger to receive messages from externals
    this.registerDefaultMessengerListener();

    // This is a list of executing strategies
    this._strategies = {};

    // Settings
    this._name = settings.name;
    this._client = settings.client;

    // Operational data
    this._remoteConnected = false;
    this._api = null;
    this._remoteId = null;
    this._ready = false;

    log.log(log.DEBUG, 'Created %s', this);
}

/**
 * Returns the name of the adapter
 * @returns {*}
 */
Facade.prototype.getName = function() {
    return this._name;
};

/**
 * Returns the version of the adapter
 * @returns {*}
 */
Facade.prototype.getVersion = function() {
    return this.getClient().getVersion();
};

/**
 * Returns the client this facade is attached to
 * @returns {*}
 */
Facade.prototype.getClient = function() {
    return this._client;
};

/**
 * Return the event emitter
 * @returns {*}
 */
Facade.prototype.getEvents = function() {
    return this.getClient().getEvents();
};

/**
 * Returns the remote address of the client instance this facade
 * is connected to
 * @returns {*}
 */
Facade.prototype.getRemoteAddress = function() {
    return this.getClient().getRemoteAddress();
};

/**
 * Returns the remote id of the client instance this facade
 * is connected to
 * @returns {*}
 */
Facade.prototype.getRemoteId = function() {
    return this._remoteId;
};

/**
 * Whether this facade is connected
 * @returns {*} connected
 */
Facade.prototype.isReady = function() {
    return this._ready;
};

/**
 * This Facade represents the following interface defined in 'object'.
 * Once this method is called, this facade is active and emits ready.
 * @param object
 */
Facade.prototype.assignObject = function(object) {

    // Make sure this is a valid object instance we're connecting to
    if (!object || !isArray(object.methods) || !appUtils.isUuid(object.id)) {
        this.close();
        throw new Error('Invalid API response for Facade ' + this);
    }

    if (this._api === null) {
        this._remoteConnected = true;
        this._remoteId = object.id;

        log.log(log.DEBUG, 'Assigning API [id = %s] for %s', this._remoteId, this);

        // A reference to this facade.
        var _this = this;

        var api = this._api = {};

        // Add a record for each function.  When the function is called, it should
        // create a strategy and return it.
        object.methods.forEach(function(func) {
            api[func] = function() {

                // Return a new strategy with the call.
                var newStrategy = strategy(_this.getEndpointManager());

                // Call the first method
                newStrategy.call(api[func], arguments);

                // Cache the strategy in case we need to cancel it.
                _this._strategies[newStrategy.getId()] = newStrategy;

                // Listen for completion/cancel messages
                newStrategy.on('complete', function() {
                    delete _this._strategies[newStrategy.getId()];
                });

                // Execute the strategy on the next tick.
                appUtils.nextTick(function() {
                    newStrategy.execute();
                });

                return newStrategy;
            };

            // Whether this is an Endpoint.js function, so that the executor can
            // determine how to route the data.
            api[func].isFacadeFunction = function() {
                return true;
            };

            // This is a way to address the function on the facade
            api[func].getFacadeFunctionName = function() {
                return func;
            };

            // This is used by the executor to get the facade reference,
            // so that we can get the event stream and choreograph the call.
            api[func].getFacade = function() {
                return _this;
            };
        });

        // Store reference to facade like this so that minifiers don't minify it.
        /*jshint -W069 */
        // jscs:disable requireDotNotation
        api['_facade'] = this;
        /*jshint +W069 */

        // Emit ready to tell anyone waiting that they can make calls now
        this._ready = true;
        this.emit('ready');
    }
    else {
        log.log(log.DEBUG, 'Already established API for %s', this);
    }
};

/**
 * When a response comes from an external host
 * @private
 */
Facade.prototype._handleMessage = function(response, source) {
    // Ensure that the source is within the expected neighborhood
    if (source > this.getClient().getNeighborhood()) {
        return;
    }

    switch (response.type) {
        case 'close':
            this._remoteConnected = false;
            this.close();
            break;

    }
};

/**
 * Returns the interface for this facade, which includes the functions that
 * can be directly executed for the API represented by this facade.
 */
Facade.prototype.getApi = function() {
    if (!this.isReady()) {
        var error = new Error('Tried to get API but not ready for ' + this);
        log.log(log.ERROR, error);
        throw error;
    }
    return this._api;
};

/**
 * Cancel all strategies
 * @param affinityClosure - whether host affinity forced this closure
 * @private
 */
Facade.prototype._handleClose = function(affinityClosure) {

    // Tell the remote we're closing!
    if (this._remoteConnected && !affinityClosure) {
        this.getMessenger().sendMessage(
            this.getRemoteAddress(),
            this._remoteId, {
                id: this.getId(),
                type: 'close'
            });
    }

    var strategies = Object.keys(this._strategies);
    strategies.forEach(function(strategy) {
        this._strategies[strategy].cancel();
    }, this);
};
