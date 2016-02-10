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

var endpoint = require('./endpoint'),
    periodicTimer = require('../util/periodic-timer'),
    appUtils = require('../util/appUtils'),
    uuid = require('node-uuid'),
    log = appUtils.getLogger(__filename);

module.exports = EndpointManager;

/**
 * The endpoint manager executes periodic checks on the endpoints to ensure
 * they haven't timed out.  It can also be used to close all endpoints registered
 * in an Endpoint.js instance immediately.
 * @param {Configuration} config - the configuration for this endpoint instance
 * @param {Object} services - bus, messenger, etc
 * @constructor
 */
function EndpointManager(config, services) {
    if (!(this instanceof EndpointManager)) {
        return new EndpointManager(
            config, services);
    }

    this._endpoints = {};
    this._periodic = {};

    this._config = config;
    this._services = services;

    // Listen for updates
    this._timer = periodicTimer('Endpoint Manager', 5000);
    this._timer.on('period', this._performPeriodic.bind(this));
}

/**
 * Return the instance id of this endpoint.js instance
 */
EndpointManager.prototype.getInstanceId = function() {
    return this._config.get('instanceId');
};

/**
 * Return the configuration
 * @returns {*}
 */
EndpointManager.prototype.getConfiguration = function() {
    return this._config;
};

/**
 * Return the requested services
 * @returns {*}
 */
EndpointManager.prototype.getService = function(name) {
    return this._services[name];
};

/**
 * Occasionally probe each endpoint to ensure it's still alive.
 * @private
 */
EndpointManager.prototype._performPeriodic = function(isEnd) {
    if (!isEnd) {
        var keys = Object.keys(this._periodic);
        log.log(log.DEBUG, 'Executing endpoint manager periodic for %s endpoints', keys.length);
        keys.forEach(function(key) {
            try {
                if (this._endpoints[key]) {
                    this._endpoints[key].performPeriodic();
                }
                else {
                    log.log(log.DEBUG2, 'Endpoint was removed before periodic executed for %s', key);
                }
            }
            catch (e) {
                log.log(log.WARN, 'Issue executing periodic for %s [message: %s] [stack: %s]',
                    this._endpoints[key],
                    e.message,
                    e.stack);
            }
        }, this);
    }
};

/**
 * Register the endpoint with the endpoint manager
 * @returns {*}
 */
EndpointManager.prototype.registerPeriodic = function(endpoint) {
    if (!this._periodic[endpoint.getId()]) {
        log.log(log.DEBUG3, 'Endpoint registered for periodic updates %s', endpoint);
        this._timer.addReference();
        this._periodic[endpoint.getId()] = true;
    }
};

/**
 * Unregister the endpoint with the endpoint manager
 * @returns {*}
 */
EndpointManager.prototype.unregisterPeriodic = function(endpoint) {
    if (this._periodic[endpoint.getId()]) {
        log.log(log.DEBUG3, 'Endpoint unregistered for periodic updates %s', endpoint);
        delete this._periodic[endpoint.getId()];
        this._timer.removeReference();
    }
};

/**
 * Register the endpoint with the endpoint manager
 * @returns {*}
 */
EndpointManager.prototype.registerEndpoint = function(endpoint) {
    this._endpoints[endpoint.getId()] = endpoint;
    log.log(log.DEBUG2, 'Endpoint registered with endpoint manager %s', endpoint);
    endpoint.on('closed', function() {
        delete this._endpoints[endpoint.getId()];
        this.unregisterPeriodic(endpoint);
    }.bind(this));
};

/**
 * Create an instance of an endpoint with the given id.
 * @param id - if null, a uuid will be generated
 * @param type - any user-defined string representing a 'type' of endpoint
 * @param [identification] - extra identification for endpoint
 */
EndpointManager.prototype.createEndpoint = function(id, type, identification) {
    if (!id) {
        id = uuid();
    }
    return endpoint(
        this,
        {
            id: id,
            type: type,
            identification: identification
        }
    );
};

/**
 * Close all endpoints registered
 * @returns {*}
 */
EndpointManager.prototype.closeAll = function() {
    var keys = Object.keys(this._endpoints);
    keys.forEach(function(key) {
        this._endpoints[key].close();
    }, this);
};

