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
    uuid = require('uuid'),
    callContext = require('./context'),
    address = require('../../routing/address'),
    constants = require('../../util/constants'),
    appUtils = require('../../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(ObjectInstance, Endpoint);

module.exports = ObjectInstance;

/**
 * This represents an instance of a remote facade for one of my published
 * adapters.  This client instance is an event emitter which is emitted
 * to an instance of an Endpoint.js adapter when someone tries to use it.
 * @augments Endpoint
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings
 * @param {String} settings.name - the name of this object instance, derived from adapter name
 * @param {String} settings.clientInstance - the client instance this object instance belongs to
 * @param {String} settings.remoteId - the id of the remote facade endpoint
 * @param {Object} settings.object - the object this instance represents
 * @constructor
 */
function ObjectInstance(endpointManager, settings) {
    if (!(this instanceof ObjectInstance)) {
        return new ObjectInstance(endpointManager, settings);
    }

    var adapter = settings.clientInstance.getAdapter();

    // Call parent constructor
    ObjectInstance.super_.call(this,
        endpointManager,
        {
            type: constants.EndpointType.OBJECT_INSTANCE,
            id: uuid(),
            identification: format('[name: %s] [version: %s]',
                settings.name,
                adapter.getVersion())
        }
    );

    // Register the streamer & messenger to receive messages from externals
    this.registerDefaultStreamerListener();
    this.registerDefaultMessengerListener();

    // Pending call contexts
    this._name = settings.name;
    this._object = settings.object;
    this._clientInstance = settings.clientInstance;
    this._remoteId = settings.remoteId;
    this._contexts = {};
    this._contextsCount = 0;

    // Object instance starts as connected
    this._remoteConnected = true;

    // Bootstrap the API for this object
    this._methodIndex = this._createMethodIndex();

    log.log(log.DEBUG, 'Created %s', this);
}

/**
 * Returns the name of this object instance
 * @return {String}
 */
ObjectInstance.prototype.getName = function() {
    return this._name;
};

/**
 * Return the object this instance is wrapping
 * @returns {*}
 */
ObjectInstance.prototype.getObject = function() {
    return this._object;
};

/**
 * Returns the client instance assigned to this object
 */
ObjectInstance.prototype.getClientInstance = function() {
    return this._clientInstance;
};

/**
 * Returns the remote address of the facade this client instance
 * is connected to
 * @returns {*}
 */
ObjectInstance.prototype.getRemoteAddress = function() {
    return this.getClientInstance().getRemoteAddress();
};

/**
 * Returns the remote id of the facade this client instance
 * is connected to
 * @returns {*}
 */
ObjectInstance.prototype.getRemoteId = function() {
    return this._remoteId;
};

/**
 * Return or create a context.
 * @param callId
 * @param createIfNotFound
 * @returns {*}
 */
ObjectInstance.prototype.getContext = function(callId, createIfNotFound) {
    if (this.hasContext(callId)) {
        return this._contexts[callId];
    }
    else if (createIfNotFound) {
        if (!appUtils.isUuid(callId)) {
            throw new Error('invalid context id');
        }
        var context = this._contexts[callId] = callContext(this, callId);
        this._contextsCount += 1;
        if (this._contextsCount == 1) {
            // Ensure no stale contexts
            this.getEndpointManager().registerPeriodic(this);
        }
        return context;
    }
    return null;
};

/**
 * Get an API response for this object instance
 * @return {Object} API response
 */
ObjectInstance.prototype.getApi = function() {
    return {
        id: this.getId(),
        methods: this.getMethodNames()
    };
};

/**
 * Return a list of method names registered with this adapter.
 */
ObjectInstance.prototype.getMethodNames = function() {
    return Object.keys(this._methodIndex);
};

/**
 *
 * @param callId
 * @returns {boolean}
 */
ObjectInstance.prototype.hasContext = function(callId) {
    if (this._contexts[callId]) {
        return true;
    }
    return false;
};

/**
 * Handle a stream creation event from a remote facade or client instance
 * @param fromUuid
 * @param stream
 */
ObjectInstance.prototype._handleStream = function(stream, opts) {

    var type = stream.meta.type;
    var callId = stream.meta.id;

    // If the affinity is lost, end the stream.
    this.attachStream(stream);

    if (callId) {
        var context;
        switch (type) {
            case 'input':
                context = this.getContext(callId, true);
                context.setInputStream(stream);
                context.setBuffered(!opts.objectMode);
                break;
            case 'output':
                context = this.getContext(callId, true);
                context.setOutputStream(stream);
                break;
            default:
                log.log(log.ERROR, 'Malformed stream: %j for %s',
                    stream.meta,
                    this);
                stream.end();
                return;
        }

        // Tell the call originator that the remote stream is ready.
        this.getMessenger().sendMessage(this.getRemoteAddress(), callId, {
            type: 'stream-connected'
        });
    }
};

/**
 * Handle an API request from a remote facade.
 * @param message
 */
ObjectInstance.prototype._handleMessage = function(message, source) {

    // Ensure that the source is within the expected neighborhood
    if (source > this._neighborhood) {
        return;
    }

    var callId = message.id;
    var callType = message.type;

    if (callId && callType) {
        switch (callType) {
            case 'close':
                this._remoteConnected = false;
                this.close();
                return;
            case 'remote-stream':
                this._establishRemoteStream(callId, message);
                return;
            case 'call-facade':
            case 'call-ignore':
            case 'call':
                this._callMethod(callId, callType, message);
                return;
            case 'cancel':
                this.cancel(callId);
                return;
        }
    }

    log.log(log.ERROR, 'Malformed message: %j for %s', message, this);
};

/**
 * Call the given method, executing the callback when finished
 * @param callId
 * @param callType
 * @param message
 * @private
 */
ObjectInstance.prototype._callMethod = function(callId, callType, message) {
    // Execute the context/call
    var context = this.getContext(callId, true);

    // Convert arguments, looking for Facades
    if (message.xargs && message.xargs.length > 0) {
        for (var i = 0; i < message.xargs.length; i++) {
            var arg = message.xargs[i];
            var id = message.args[arg];
            var remote = this.getClientInstance().getObjectInstance(id);
            if (remote) {
                message.args[arg] = remote.getObject();
            }
            else {
                log.log(log.WARN, 'Unknown object id: %s', id);
            }
        }
    }

    // This method will process the result & send the
    // result message to the facade
    var resultFunction = function(type, data) {

        // Remove the context since it's finished
        this.removeContext(callId);

        if (type == 'result') {
            result = {
                type: 'result'
            };
            if (callType == 'call') {
                // Only return the result if requested
                result.value = data;
            }
            else if (callType == 'call-facade') {

                // Derive the new name for the object instance;
                var newName = format('%s.%s', this.getName(), message.func);

                // Register the result as a facade.
                var objectInstance = this.getClientInstance()
                    .createObjectInstance(newName, data, message.facadeId, this);

                if (objectInstance) {
                    result.value = objectInstance.getApi();
                }
                else {
                    result = {
                        type: 'error',
                        message: 'Could not create the object instance',
                        name: 'Error'
                    };
                }
            }
        }
        else {
            result = {
                type: 'error',
                message: data.message,
                name: data.name
            };
        }

        // Send the result
        this.getMessenger().sendMessage(
            this.getRemoteAddress(),
            callId,
            result);

    }.bind(this);

    // Make sure the function exists, and call it.
    var result;
    if (this.hasMethod(message.func)) {
        context.execute(message.func, message.args, resultFunction);
    }
    else {
        log.log(log.ERROR, 'Method does not exist: %s for %s', message.func, this);
        resultFunction('error', new Error('Method not found'));
    }
};

/**
 * Create a stream to the remote client instance from a facade request.
 * @param callId
 * @param message
 * @private
 */
ObjectInstance.prototype._establishRemoteStream = function(callId, message) {
    var context = this.getContext(callId, true);

    // Parse the remote address from the metadata
    var desiredRemoteAddress = message.remoteAddress,
        desiredRemoteId = message.remoteId;

    // Create a route to the destination
    var streamAddress = this.getRemoteAddress().routeThrough(address(desiredRemoteAddress, true));

    // Create the remote stream.
    var stream = this.getStreamer().createStream(
        desiredRemoteId,
        streamAddress,
        {
            id: message.callId,
            type: 'input'
        },
        {
            objectMode: !message.buffered
        });

    // If the affinity is lost, end the stream.
    this.attachStream(stream);

    this.getMessenger().sendMessage(this.getRemoteAddress(), callId, {
        type: 'stream-connected'
    });

    // Connect it to the call
    context.setOutputStream(stream);
};

/**
 * Whether the method is registered in the method index
 * @param name
 */
ObjectInstance.prototype.hasMethod = function(name) {
    return !!this._methodIndex[name];
};

/**
 * Create a list of method names registered with this adapter.
 */
ObjectInstance.prototype._createMethodIndex = function() {
    var methodIndex = {};
    var obj = this._object;
    // Generate the methods.
    var total = 0;
    for (var prop in obj) {
        if (typeof (obj[prop]) == 'function' && prop.charAt(0) !== '_') {
            methodIndex[prop] = true;
            total += 1;
        }
    }
    log.log(log.DEBUG2,
        'Counted %s functions in object for %s',
        total,
        this);
    return methodIndex;
};

/**
 * Ensure no contexts are stale
 * @private
 */
ObjectInstance.prototype.performPeriodic = function() {
    var contexts = Object.keys(this._contexts);
    for (var i = 0; i < contexts.length; i++) {
        var callId = contexts[i];
        var ctx = this._contexts[callId];
        ctx.incrementPeriodic();
        if (ctx.getPeriodic() > 2) {
            log.log(log.DEBUG, 'Context is stale [ctx: %s] for %s', callId, this);
            this.cancel(callId);
        }
    }
};

/**
 * Cancel the given call and clean it up
 * @param callId
 */
ObjectInstance.prototype.cancel = function(callId) {
    if (this.hasContext(callId)) {
        this._contexts[callId].cancel();
        this.removeContext(callId);
    }
};

/**
 * Stop listening for periodic updates & remove the context
 * @param callId
 */
ObjectInstance.prototype.removeContext = function(callId) {
    if (this.hasContext(callId)) {
        delete this._contexts[callId];
        this._contextsCount -= 1;
        if (this._contextsCount === 0) {
            this.getEndpointManager().unregisterPeriodic(this);
        }
    }
};

/**
 * Cancel all contexts
 * @private
 */
ObjectInstance.prototype._handleClose = function(affinityClosure) {
    // Tell the remote we're closing!
    if (this._remoteConnected && !affinityClosure) {
        this.getMessenger().sendMessage(
            this.getRemoteAddress(),
            this._remoteId, {
                id: this.getId(),
                type: 'close'
            });
    }
    // Close all contexts
    var contexts = Object.keys(this._contexts);
    for (var callId in contexts) {
        this.cancel(callId);
    }

};
