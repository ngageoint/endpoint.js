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

var EventEmitter = require('events').EventEmitter,
    inherits = require('util').inherits,
    format = require('util').format,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Endpoint, EventEmitter);

module.exports = Endpoint;

/**
 * An Endpoint is an object with a unique identifier that registered subscriptions
 * with the Bus, Messenger and Streamer.  When the endpoint is closed, it automatically
 * closes each of these subscriptions.
 * @augments EventEmitter
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings
 * @param {String} settings.type - a short descriptive name to describe this endpoint
 * @param {String} settings.id - a globally unique identifer
 * @param {String} settings.identification - a descriptive string used in logging statements
 * @constructor
 */
function Endpoint(endpointManager, settings) {
    if (!(this instanceof Endpoint)) {
        return new Endpoint(endpointManager, settings);
    }

    EventEmitter.call(this);
    this.setMaxListeners(0);

    // Input settings
    this._type = settings.type;
    this._id = settings.id;
    this._endpointManager = endpointManager;

    // Identity used to print to the log
    this._identifierString = format('[%s] [id: %s]', this.getType(), this.getId());
    if (settings.identification) {
        this._identifierString += ' ' + settings.identification;
    }

    // Register with the endpoint manager
    this._endpointManager.registerEndpoint(this);

    // List of registered messenger endpoints, bus endpoints, and
    // streamer endpoints, so we can clean up.
    this._registeredListeners = {};
    this._listenerCtr = 1;
    this._closing = false;
}

/**
 * Return the id of the endpoint
 * @returns {*}
 */
Endpoint.prototype.getId = function() {
    return this._id;
};

/**
 * Return the instance id of the endpoint
 * @returns {*}
 */
Endpoint.prototype.getInstanceId = function() {
    return this._endpointManager.getInstanceId();
};

/**
 * Return the type of the endpoint
 * @returns {*}
 */
Endpoint.prototype.getType = function() {
    return this._type;
};

/**
 * Return the bus
 * @returns {*}
 */
Endpoint.prototype.getBus = function() {
    return this._endpointManager.getService('bus');
};

/**
 * Return the messenger
 * @returns {*}
 */
Endpoint.prototype.getMessenger = function() {
    return this._endpointManager.getService('messenger');
};

/**
 * Return the streamer
 * @returns {*}
 */
Endpoint.prototype.getStreamer = function() {
    return this._endpointManager.getService('streamer');
};

/**
 * This allows us to establish a relationship with the
 * remote host, so that it if it goes down, our
 * endpoints can end.
 * @param criteria
 */
Endpoint.prototype.getHostAffinity = function() {
    return this._endpointManager.getService('hostaffinity');
};

/**
 * Return the endpoint manager
 * @returns {*}
 */
Endpoint.prototype.getEndpointManager = function() {
    return this._endpointManager;
};

/**
 * Do periodic calls
 */
Endpoint.prototype.performPeriodic = function() {
    throw new Error('not implemented');
};

/**
 * Register the messenger to receive messages for _handleMessage
 * on this.getId()
 */
Endpoint.prototype.registerDefaultMessengerListener = function() {
    this.registerMessenger(this.getId(), this._handleMessage.bind(this));
};

/**
 * Register the streamer to receive streams for _handleStream
 * on this.getId()
 */
Endpoint.prototype.registerDefaultStreamerListener = function() {
    this.registerStreamer(this.getId(), this._handleStream.bind(this));
};

/**
 * Register the bus to receive events for _handleBusEvent
 * on this.getId()
 */
Endpoint.prototype.registerDefaultBusEventListener = function() {
    this.registerBusEvent(this.getId(), this._handleBusEvent.bind(this));
};

/**
 * Register for the given bus event.
 * @param event
 * @param callback
 */
Endpoint.prototype.registerBusEvent = function(event, callback) {

    // Add to list of registered endpoints
    var key = this._addListener({
        type: 'bus',
        event: event,
        callback: callback
    });

    this.getBus().on(event, callback);

    log.log(log.DEBUG3, 'Added bus event listener %s for %s', event, this);
    return key;
};

/**
 * Register for the given object
 * @param object
 * @param event
 * @param callback
 */
Endpoint.prototype.registerObjectEvent = function(object, event, callback) {

    // Add to list of registered endpoints
    var key = this._addListener({
        type: 'object-event',
        object: object,
        event: event,
        callback: callback
    });

    object.on(event, callback);

    log.log(log.DEBUG3, 'Added object event listener %s for %s', event, this);
    return key;
};

/**
 * Register to receive messages on the given interface
 * @param id
 * @param callback
 */
Endpoint.prototype.registerMessenger = function(id, callback) {

    // Add to list of registered endpoints
    var key = this._addListener({
        type: 'messenger',
        id: id
    });

    // Listen for responses to adapter request.
    this.getMessenger().register(id, callback);

    log.log(log.DEBUG3, 'Added messenger %s for %s', id, this);
    return key;
};

/**
 * Register to receive new streams on the given interface
 * @param id
 * @param callback
 */
Endpoint.prototype.registerStreamer = function(id, callback) {

    // Add to list of registered endpoints
    var key = this._addListener({
        type: 'streamer',
        key: id,
        callback: callback
    });

    // Setup a streamer endpoint to listen for new event streams (to
    // create client instances)
    this.getStreamer().addHandler(id);
    this.getStreamer().on('stream-' + id, callback);

    log.log(log.DEBUG3, 'Added streamer %s for %s', id, this);
    return key;
};

/**
 * This function will add the endpoint to the local registered endpoints list
 * and return its new key.
 * @param endpoint
 * @private
 */
Endpoint.prototype._addListener = function(endpoint) {
    var key = this._listenerCtr;
    this._registeredListeners[key] = endpoint;
    this._listenerCtr += 1;
    return key;
};

/**
 * Close the client instance, and report the closure on the
 * event stream.
 * @param {Boolean} [affinityForced] - when affinity forces the closure
 */
Endpoint.prototype.close = function(affinityForced) {
    if (this._closing) {
        log.log(log.DEBUG3, 'Already Closed: %s', this);
        return;
    }

    log.log(log.DEBUG2, 'Closing %s', this);
    this._closing = true;

    // Unregister all endpoints.
    var listeners = Object.keys(this._registeredListeners);
    listeners.forEach(function(endpointKey) {
        this.closeListener(endpointKey);
    }.bind(this));

    if (typeof (this._handleClose) == 'function') {
        this._handleClose(!!affinityForced);
    }
    this.emit('closed', !!affinityForced);
};

/**
 * This function will close the given endpoint, if it's registered
 * @param endpointKey
 */
Endpoint.prototype.closeListener = function(endpointKey) {

    var listener = this._registeredListeners[endpointKey];

    if (listener) {
        switch (listener.type) {
            case 'streamer':
                this.getStreamer().removeHandler(listener.key);
                this.getStreamer().removeListener('stream-' + listener.key, listener.callback);
                break;
            case 'messenger':
                this.getMessenger().unRegister(listener.id);
                break;
            case 'bus':
                this.getBus().removeListener(listener.event, listener.callback);
                break;
            case 'object-event':
                listener.object.removeListener(listener.event, listener.callback);
                break;
            default:
                log.log(log.ERROR, 'Unknown endpoint type %s for %s', listener.type, this);
                break;
        }
    }
};

/**
 * Handle a new inbound message for this endpoint.
 * @param message
 * @private
 */
Endpoint.prototype._handleMessage = function(message) {
    log.log(log.ERROR, 'Message method not implemented for %s', this);
};

/**
 * Handle a new inbound request for this endpoint
 * @param event
 * @private
 */
Endpoint.prototype._handleBusEvent = function(event) {
    log.log(log.ERROR, 'Bus Event method not implemented for %s', this);
};

/**
 * Handle a new inbound stream for this endpoint.
 * @param fromUuid
 * @param stream
 * @private
 */
Endpoint.prototype._handleStream = function(stream, opts) {
    log.log(log.ERROR, 'Stream method not implemented for %s', this);
    stream.end();
};

/**
 * When the facade closes, close the associated stream
 * @param hostAffinityId
 * @param stream
 */
Endpoint.prototype.attachStream = function(stream) {
    var listener = function() {
        log.log(log.DEBUG2, 'Endpoint closed, ending stream [id = %s]',
            stream.id);
        stream.end();
    };
    this.once('closed', listener);
    var streamEnd = function() {
        this.removeListener('closed', listener);
    }.bind(this);
    stream.on('end', streamEnd);
    stream.on('finish', streamEnd);
};

/**
 * Attach the given endpoint as subordinate.  If I close, then the
 * child endpoint will be forced closed.  If the child closed, stop
 * listening to it
 * @param endpoint
 */
Endpoint.prototype.attachEndpoint = function(endpoint) {
    var listener = function() {
        // Treat any attached closures as an affinity break, since the parent died,
        // and it's being forced shut (not manually closed)
        endpoint.close(true);
    };
    this.once('closed', listener);
    var endpointClosed = function() {
        this.removeListener('closed', listener);
    }.bind(this);
    endpoint.on('closed', endpointClosed);
};

/**
 * Allow users to attach this endpoint to the given affinity id. Close the endpoint if
 * affinity breaks.
 * @param hostAffinityId
 */
Endpoint.prototype.trackEndpointAffinity = function(hostAffinityId) {
    if (hostAffinityId && hostAffinityId !== null) {
        var listener = function(type) {
            log.log(log.DEBUG, 'Received affinity message %s for %s', type, this);
            if (type == 'remove') {
                this.close(true);
            }
        }.bind(this);
        this.getHostAffinity().once(hostAffinityId, listener);
        this.once('closed', function() {
            this.getHostAffinity().removeListener(hostAffinityId, listener);
        }.bind(this));
    }
};

/**
 * Override the toString
 * @returns {*}
 */
Endpoint.prototype.toString = function() {
    return this._identifierString;
};
