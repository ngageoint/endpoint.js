(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (__filename){
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

}).call(this,"/js\\app\\api\\adapter\\adapter.js")
},{"../../endpoint/endpoint":26,"../../routing/address":36,"../../util/appUtils":54,"../../util/constants":55,"./client-instance":2,"./resolver":5,"events":64,"node-uuid":69,"util":92}],2:[function(require,module,exports){
(function (__filename){
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

}).call(this,"/js\\app\\api\\adapter\\client-instance.js")
},{"../../endpoint/endpoint":26,"../../util/appUtils":54,"../../util/constants":55,"./object-instance":4,"node-uuid":69,"util":92}],3:[function(require,module,exports){
(function (__filename){
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

var through2 = require('through2'),
    appUtils = require('../../util/appUtils'),
    log = appUtils.getLogger(__filename);

module.exports = Context;

/**
 * A context is an execution context for an API call on an adapter.
 * It has the current input stream, output stream, and some utility functions
 * for dealing with streams.
 * @param objectInstance - the object instance this context belongs to
 * @constructor
 */
function Context(objectInstance) {
    if (!(this instanceof Context)) {
        return new Context(objectInstance);
    }
    this._objectInstance = objectInstance;
    this._inputStream = null;
    this._outputStream = null;
    this._cb = null;
    this._asyncMode = false;
    this._buffered = false;
    this._periodicCounter = 0;

}

/**
 * Ensure the context isn't stale.
 */
Context.prototype.incrementPeriodic = function() {
    this._periodicCounter += 1;
};

/**
 * Get the current periodic count
 */
Context.prototype.getPeriodic = function() {
    return this._periodicCounter;
};

/**
 * The client instance which made the call.
 * @returns {*}
 */
Context.prototype.getClientInstance = function() {
    return this._objectInstance.getClientInstance();
};

/**
 * The object instance which made the call.
 * @returns {*}
 */
Context.prototype.getObjectInstance = function() {
    return this._objectInstance;
};

/**
 * Whether the input stream is buffered
 */
Context.prototype.isBuffered = function() {
    return this._buffered;
};

/**
 * Whether the input stream is buffered
 */
Context.prototype.setBuffered = function(buffered) {
    this._buffered = buffered;
};

/**
 * Whether this is an asynch call, meaning that it won't
 * return a result immediately
 */
Context.prototype.setAsyncMode = function() {
    this._asyncMode = true;
};

/**
 * Whether this context is in async mode.
 */
Context.prototype.isAsync = function() {
    return this._asyncMode;
};

/**
 * End an async call by returning a result
 * @param result
 */
Context.prototype.setAsyncResult = function(result) {
    this._cb('result', result);
};

/**
 * End an async call by throwing an error
 * @param result
 */
Context.prototype.setAsyncError = function(error) {
    this._cb('error', error);
};

/**
 * Whether the inputStream value is null
 * @returns {boolean}
 */
Context.prototype.hasInputStream = function() {
    if (this._inputStream !== null) {
        return true;
    }
    return false;
};

/**
 * Whether the inputStream value is null
 * @returns {boolean}
 */
Context.prototype.hasOutputStream = function() {
    if (this._outputStream !== null) {
        return true;
    }
    return false;
};

/**
 * Input stream from the facade that called this, or another client
 * instance.
 * @returns {*}
 */
Context.prototype.getInputStream = function() {
    return this._inputStream;
};

/**
 * Sets the input stream for this instance
 */
Context.prototype.setInputStream = function(inputStream) {
    this._inputStream = inputStream;
};

/**
 * Output stream is used to pipe to another facade function, stream, or then.
 * @returns {*}
 */
Context.prototype.getOutputStream = function() {
    return this._outputStream;
};

/**
 * Sets the output stream for this instance
 */
Context.prototype.setOutputStream = function(outputStream) {
    this._outputStream = outputStream;
};

/**
 * Execute the given API function on the adapter.
 * @param args
 */
Context.prototype.execute = function(func, args, cb) {

    var objectInstance = this.getObjectInstance();
    var adapter = this.getClientInstance().getAdapter();

    log.log(log.DEBUG3, 'Executing %s on %s', func, objectInstance);
    this._cb = cb;

    // Call the method
    var result;
    try {

        // Set call context on adapter.
        adapter.setCurrentContext(this);

        // Call the method
        var obj = objectInstance.getObject();
        if (obj[func]) {
            result = obj[func].apply(obj, args);
        }
        else {
            throw new Error('Unknown function name');
        }

        // Wrap the end() of streams, if there are streams.  Done here so that
        // user defined 'end()' function executes first.
        if (this.hasInputStream() && this.hasOutputStream()) {
            this.getInputStream().on('end', function() {
                this.getOutputStream().end();
            }.bind(this));
            this.getOutputStream().on('end', function() {
                this.getInputStream().end();
            }.bind(this));
        }

        // Clear call context
        adapter.setCurrentContext(null);

        // Send the result back.
        if (!this.isAsync()) {
            cb('result', result);
        }
    }
    catch (e) {
        // Clear call context
        adapter.setCurrentContext(null);

        log.log(log.WARN, 'Issue executing API call [func: %s] [args: %j] [exception: %s] [trace: %s]',
            func, args, e.toString(), e.stack);

        // Send the result back.
        cb('error', e);

    }

};

/**
 * End the input/output streams if they're set
 */
Context.prototype.cancel = function() {
    if (this.hasInputStream()) {
        this.getInputStream().end();
    }
    if (this.hasOutputStream()) {
        this.getOutputStream().end();
    }
};

/**
 * Transform the stream by taking input and transforming, and output and
 * transforming in the reverse direction
 * @param forwardTransformFunc
 * @param reverseTransformFunc
 */
Context.prototype.transformDuplexStream = function(forwardTransformFunc, reverseTransformFunc) {
    var func = through2.obj;
    if (this._buffered) {
        func = through2;
    }
    this._inputStream.pipe(func(forwardTransformFunc)).pipe(this._outputStream);
    this._outputStream.pipe(func(reverseTransformFunc)).pipe(this._inputStream);
};

/**
 * Transform the stream by taking input stream through the transformFunc
 * function
 * @param transformFunc
 */
Context.prototype.transformStream = function(transformFunc) {
    var func = through2.obj;
    if (this._buffered) {
        func = through2;
    }
    this._inputStream.pipe(func(transformFunc)).pipe(this._outputStream);
};

}).call(this,"/js\\app\\api\\adapter\\context.js")
},{"../../util/appUtils":54,"through2":89}],4:[function(require,module,exports){
(function (__filename){
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
    uuid = require('node-uuid'),
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

}).call(this,"/js\\app\\api\\adapter\\object-instance.js")
},{"../../endpoint/endpoint":26,"../../routing/address":36,"../../util/appUtils":54,"../../util/constants":55,"./context":3,"node-uuid":69,"util":92}],5:[function(require,module,exports){
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

module.exports = Resolver;

/**
 * The resolver is used to determine if the facade criteria matches the metadata
 * for the adapter.  This is the default resolver for an adapter, but
 * a custom resolver can be used.
 * @example <caption>Using a custom resolver</caption>
 * var metadata = {
 *   tags: ['blue', 'green']
 * };
 *
 * var resolver = {
 *   resolve: function(metadata, criteria) {
 *     for (var i = 0; i < criteria.tags.length; i++) {
 *       if (metadata.tags.indexOf(tag) !== -1) {
 *         return true;
 *       }
 *     }
 *     return false;
 *   }
 * };
 *
 * var adapter = window.endpoint.registerAdapter('mapapi', '1.0',
 *   mapapi, metadata, resolver);
 * @param {Object} settings
 * @param {String} settings.id - the endpoint (adapter) id
 * @param {String} settings.instanceId - the endpoint.js instance id
 * @constructor
 */
function Resolver(settings) {
    if (!(this instanceof Resolver)) { return new Resolver(settings); }

    // Endpoint.js instance id.
    this._id = settings.id;
    this._instanceId = settings.instanceId;
}

/**
 * Respond to the key request.
 * @param {Object} metadata - adapter metadata set on adapter creation
 * @param {Object} criteria - criteria sent with the query
 * @param {RemoteAddress} remoteAddress - remote address information
 * @return boolean - resolved - whether the criteria matches this metadata.
 */
Resolver.prototype.resolve = function(criteria, metadata, remoteAddress) {

    // Match anything
    if (!criteria) {
        return true;
    }

    // Only resolve based on Endpoint.js instance id right now.
    if (criteria.hasOwnProperty('instanceId')) {
        if (criteria.instanceId !== this._instanceId) {
            return false;
        }
    }

    // Only resolved if the instance Id matches.
    if (criteria.hasOwnProperty('id')) {
        if (criteria.id !== this._id) {
            return false;
        }
    }

    return true;
};


},{}],6:[function(require,module,exports){
(function (__filename){
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

}).call(this,"/js\\app\\api\\api.js")
},{"../util/appUtils":54,"./adapter/adapter":1,"./facade-manager":7,"./facade/client":14,"./facade/query":16}],7:[function(require,module,exports){
(function (__filename){
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
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(FacadeManager, EventEmitter);

module.exports = FacadeManager;

/**
 * What facade manager does is manages a list of facades, reconnects them
 * if necessary for the user.  It is sort of a dependency manager.
 * @augments EventEmitter
 * @param {Api} api - references the Api class to call createFacade function.
 * @constructor
 */
function FacadeManager(api) {
    if (!(this instanceof FacadeManager)) { return new FacadeManager(api); }

    EventEmitter.call(this);

    this._facades = {};
    this._api = api;
    this._ready = false;
    this._closed = false;
    this._totalFacades = 0;
    this._facadesReady = 0;
}

/**
 * Returns the facade with the given name
 * @param name
 * @returns {*}
 */
FacadeManager.prototype.getFacade = function(name) {
    if (!this._facades[name]) {
        throw new Error('Do not know of that facade');
    }
    return this._facades[name];
};

/**
 * Return the api of the facade
 * @param name
 */
FacadeManager.prototype.getApi = function(name) {
    if (!this._ready) {
        throw new Error('Facade Manager isn\'t ready');
    }
    return this.getFacade(name).getApi();
};

/**
 * Return the events of the facade
 * @param name
 */
FacadeManager.prototype.getEvents = function(name) {
    if (!this._ready) {
        throw new Error('Facade Manager isn\'t ready');
    }
    return this.getFacade(name).getEvents();
};

/**
 * Manage a facade.
 * @param facade
 */
FacadeManager.prototype.addFacade = function(name, version, settings) {

    if (this._facades[name]) {
        throw new Error('Can only managed one facade of a specific type');
    }

    var facade = this._api.createFacade(name, version, settings);

    this._totalFacades += 1;
    this._facades[facade.getName()] = facade;

    facade.on('closed', function() {
        log.log(log.DEBUG2, 'Facade was closed for %s', facade.getId());
        delete this._facades[facade.getName()];
        this._totalFacades -= 1;
        if (facade.isReady()) {
            // Code below will add a new one.
            this._facadesReady -= 1;
        }
        if (!this._closed) {
            log.log(log.WARN, 'Facade was closed.  Re-creating for %s', facade.getId());
            this.addFacade(name, version, settings);
        }
    }.bind(this));

    facade.on('ready', function() {
        this._facadesReady += 1;
        if (this._facadesReady === this._totalFacades) {
            var wasReady = true;
            if (!this._ready) {
                wasReady = false;
                this._ready = true;
            }
            this.emit('reconnect');
            if (!wasReady) {
                this.emit('ready');
            }
        }
    }.bind(this));

};

/**
 * Close all the facades
 */
FacadeManager.prototype.close = function() {
    this._closed = true;
    var facades = Object.keys(this._facades);
    facades.forEach(function(facade) {
        this._facades[facade].close();
    }, this);
};

}).call(this,"/js\\app\\api\\facade-manager.js")
},{"../util/appUtils":54,"events":64,"util":92}],8:[function(require,module,exports){
(function (__filename){
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
    uuid = require('node-uuid'),
    constants = require('../../util/constants'),
    appUtils = require('../../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Call, Endpoint);

module.exports = Call;

/**
 * A call is an endpoint that exposes messenger interfaces in order to receive
 * and send information to client instances to execute calls.  It also periodically
 * checks to ensure that the call hasn't timed out.  It is currently hard coded to
 * allow calls to execute for about 15-20 seconds.
 * @augments Endpoint
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings
 * @constructor
 */
function Call(endpointManager, settings) {
    if (!(this instanceof Call)) {
        return new Call(endpointManager, settings);
    }

    // Call parent constructor
    Call.super_.call(this,
        endpointManager,
        {
            type: constants.EndpointType.CALL,
            id: uuid()
        }
    );

    this.getEndpointManager().registerPeriodic(this);

    this._readyToExecute = false;

    this._forwardStream = null;
    this._reverseStream = null;
    this._buffered = false;

    this._result = null;
    this._periodicCounter = 0;
}

/**
 * This is executed by endpoint manager to ensure that this call hasn't become
 * stale.
 * @private
 */
Call.prototype.performPeriodic = function() {
    this._periodicCounter++;
    if (this._periodicCounter == 6) {
        log.log(log.WARN, 'A call timed out for %s', this);
        this.emit('call-error', 'Call timed out');
    }
};

/**
 * Whether this is a call to an external facade
 */
Call.prototype.isFacadeCall = function() {
    return false;
};

/**
 * Whether this is a call to a local stream
 */
Call.prototype.isStreamCall = function() {
    return false;
};

/**
 * Whether this is a call to a function callback
 */
Call.prototype.isCallbackCall = function() {
    return false;
};

/**
 * Set the forward stream
 * @param stream
 */
Call.prototype.connectForwardStream = function(stream) {
    this._forwardStream = stream;
};

/**
 * Return the forward stream
 * @returns {*}
 */
Call.prototype.getForwardStream = function() {
    return this._forwardStream;
};

/**
 * Set the reverse stream
 * @param stream
 */
Call.prototype.connectReverseStream = function(stream) {
    this._reverseStream = stream;
};

/**
 * Return the reverse stream
 * @returns {*}
 */
Call.prototype.getReverseStream = function() {
    return this._reverseStream;
};

/**
 * Whether the stream is buffered
 */
Call.prototype.isBuffered = function() {
    return this._buffered;
};

/**
 * Sets the buffered status
 * @param buffered
 */
Call.prototype.setBuffered = function(buffered) {
    this._buffered = buffered;
};

/**
 * Set the result of the previous call
 * @param result
 */
Call.prototype.setResult = function(result) {
    this._result = result;
};

/**
 * Get the result of the previous call
 */
Call.prototype.getResult = function() {
    return this._result;
};

/**
 * Used to establish streaming pattern with another call in the
 * strategy
 * @param nextCall
 */
Call.prototype.pipe = function(nextCall) {

    // This function assumes that we have a local stream,
    // and it may be going to a facade, stream, or callback.

    // Pass the buffered status
    nextCall.setBuffered(this.isBuffered());

    // Forward the data
    if (nextCall.isFacadeCall()) {

        // Local Stream to Remote Stream.
        var stream = nextCall.establishInputStream(this.isBuffered());
        nextCall.connectForwardStream(stream);
        nextCall.connectReverseStream(stream);

        this.getForwardStream().pipe(stream);
        stream.pipe(this.getReverseStream());

    }
    else if (nextCall.isStreamCall() ||
        (nextCall.isCallbackCall() && nextCall.wantsStreams())) {

        // Local Stream to Local Stream
        nextCall.connectForwardStream(this.getForwardStream());
        nextCall.connectReverseStream(this.getReverseStream());

    }
    else if (nextCall.isCallbackCall()) {

        // jscs:disable disallowEmptyBlocks
        // No stream.

    }
    else {
        throw new Error('Unknown call type');
    }
};

/**
 * Execute this call
 */
Call.prototype.execute = function() {
    log.log(log.DEBUG2, 'Complete for %s', this);
    this.emit('complete');
};

}).call(this,"/js\\app\\api\\facade\\call.js")
},{"../../endpoint/endpoint":26,"../../util/appUtils":54,"../../util/constants":55,"node-uuid":69,"util":92}],9:[function(require,module,exports){
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

var FacadeCall = require('./facade-call'),
    inherits = require('util').inherits;

inherits(BaseCall, FacadeCall);

module.exports = BaseCall;

/**
 * A base call is the first call in a strategy.  It is so named because it is
 * the only call within a strategy that returns a value that we pass into
 * the 'then()', no matter how many other 'pipe()' calls are between.
 * @augments FacadeCall
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings - settings passed into {@link FacadeCall}
 * @constructor
 */
function BaseCall(endpointManager, settings) {
    if (!(this instanceof BaseCall)) {
        return new BaseCall(endpointManager, settings);
    }

    // Call parent constructor
    FacadeCall.call(this, endpointManager, settings);
}

/**
 * Whether this is a base call.(Meaning we care about the return
 * result)
 * @returns {boolean}
 */
BaseCall.prototype.isBaseCall = function() {
    return true;
};

/**
 * This function will create a stream to the external host
 * and store the stream locally.
 * @param useBuffered
 */
BaseCall.prototype.connectInputStream = function() {
    var stream = this.establishInputStream(this.isBuffered());
    this.connectForwardStream(stream);
    this.connectReverseStream(stream);
    return stream;
};

/**
 * Sets the result value.  Only the base call can have
 * a return value.
 * @param value
 * @private
 */
BaseCall.prototype._setResultValue = function(value) {
    this.setResult(value);
};

},{"./facade-call":11,"util":92}],10:[function(require,module,exports){
(function (__filename){
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

var Call = require('../call'),
    inherits = require('util').inherits,
    appUtils = require('../../../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(CallbackCall, Call);

module.exports = CallbackCall;

/**
 * CallbackCall represents the 'then()' call from a strategy.  It simply executes
 * the passed function with the previous return value and sets the new return value.
 * @augments Call
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings - settings passed into {@link Call}
 * @param {Function} settings.func - the callback function to execute
 * @constructor
 */
function CallbackCall(endpointManager, settings) {
    if (!(this instanceof CallbackCall)) {
        return new CallbackCall(endpointManager, settings);
    }

    // Call parent constructor
    Call.call(this, endpointManager, settings);

    // Cache the option
    this._func = settings.func;
    this._wantsStreams = settings.func.length > 1;
}

/**
 * @return {Function} - the function for this callback call
 */
CallbackCall.prototype.getFunc = function() {
    return this._func;
};

/**
 * If the function handler has a second and third argument, then
 * we will pass the output stream as the second argument.
 * @returns {*}
 */
CallbackCall.prototype.wantsStreams = function() {
    return this._wantsStreams;
};

/**
 * Whether this is a call to a function callback
 */
CallbackCall.prototype.isCallbackCall = function() {
    return true;
};

/**
 * Execute a callback event
 */
CallbackCall.prototype.execute = function() {
    try {
        var result = this._func(this.getResult(),
            this.getForwardStream(),
            this.getReverseStream());
        this.setResult(result);
        log.log(log.DEBUG2, 'Complete for callback %s', this);
        this.emit('complete');
    }
    catch (e) {
        log.log(log.WARN, 'Issue executing Callback call [exception: %s] [trace: %s]',
            e.toString(), e.stack);
        this.emit('call-error', e.message);
    }
};

}).call(this,"/js\\app\\api\\facade\\calls\\callback-call.js")
},{"../../../util/appUtils":54,"../call":8,"util":92}],11:[function(require,module,exports){
(function (__filename){
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

var Call = require('../call'),
    inherits = require('util').inherits,
    format = require('util').format,
    Facade, // defined below due to circular deps
    appUtils = require('../../../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(FacadeCall, Call);

module.exports = FacadeCall;

/**
 * A facade call is used to call a remote adapter function and return a result.  The
 * facade call also will create input, output, and remote streams in order to
 * choreograph the execution of a call.
 * @augments Call
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings - settings passed into {@link Call}
 * @param {Function} settings.func - the api facade function to execute
 * @param {Array} settings.args - the array of arguments to pass to the api function
 * @constructor
 */
function FacadeCall(endpointManager, settings) {
    if (!(this instanceof FacadeCall)) {
        return new FacadeCall(endpointManager, settings);
    }

    if (!Facade) {
        Facade = require('../facade');
    }

    // Call parent constructor
    Call.call(this, endpointManager, settings);

    // Register the messenger to receive messages from externals
    this.registerDefaultMessengerListener();

    this._pendingStreamsCount = 0;

    // Variables
    this._func = settings.func;
    this._args = settings.args;
    this._facade = this._func.getFacade();
    this._complete = false;
    this._executing = false;
    this._returnResult = false;
    this._returnFacade = false;
    this._facadeResult = null;
}

/**
 * Return the function
 * @returns {*}
 */
FacadeCall.prototype.getFunction = function() {
    return this._func;
};

/**
 * Return the arguments
 * @returns {*}
 */
FacadeCall.prototype.getArguments = function() {
    return this._args;
};

/**
 * Whether this is a call to an external facade
 */
FacadeCall.prototype.isFacadeCall = function() {
    return true;
};

/**
 * Whether this is a base call.(Meaning we care about the return
 * result)
 * @returns {boolean}
 */
FacadeCall.prototype.isBaseCall = function() {
    return false;
};

/**
 * Whether a call to the remote object instance will be treated
 * as a facade call, so that the returned object can be used to execute
 * additional calls
 * @param returnFacade
 */
FacadeCall.prototype.setReturnFacade = function(returnFacade) {
    this._returnFacade = returnFacade;
};

/**
 * This exists because if the user doesn't specify
 * 'then()', it doesn't make sense to waste bandwidth and performance
 * serializing a result that isn't going to be used.
 * @param returnResult
 */
FacadeCall.prototype.setReturnResult = function(returnResult) {
    this._returnResult = returnResult;
};

/**
 * This function will command an external client instance to
 * create a remote connection to another client instance.
 * @param buffered
 */
FacadeCall.prototype.establishRemoteStream = function(callId, remoteAddress, remoteId, buffered) {

    this._pendingStreamsCount += 1;

    this._sendMessage({
        type: 'remote-stream',
        callId: callId,
        remoteAddress: remoteAddress.getPathVector(),
        remoteId: remoteId,
        buffered: buffered
    });
};

/**
 * Allow others to increment the amount of expected streams
 */
FacadeCall.prototype.incrementExpectedStreamCount = function() {
    this._pendingStreamsCount += 1;
};

/**
 * Return the remote address of the facade (client instance that's connected)
 */
FacadeCall.prototype.getRemoteAddress = function() {
    return this._facade.getRemoteAddress();
};

/**
 * Return the remote id of the facade (client instance that's connected)
 */
FacadeCall.prototype.getRemoteId = function() {
    return this._facade.getRemoteId();
};

/**
 * Establish a stream from local call to remote context
 */
FacadeCall.prototype.establishInputStream = function(buffered) {
    this._pendingStreamsCount += 1;
    var stream = this.establishStream('input', buffered);
    this._facade.attachStream(stream);
    return stream;
};

/**
 * Establish a stream from remote context to local
 */
FacadeCall.prototype.establishOutputStream = function(buffered) {
    this._pendingStreamsCount += 1;
    var stream = this.establishStream('output', buffered);
    this._facade.attachStream(stream);
    return stream;
};

/**
 * Handle response from remote services about an established stream
 * @param message
 * @private
 */
FacadeCall.prototype._handleMessage = function(message) {
    switch (message.type) {

        case 'stream-connected':
            log.log(log.TRACE, 'Received stream connected message for %s', this);
            // If the execute method was already called, then re-call execute
            this._pendingStreamsCount -= 1;
            if (this._pendingStreamsCount === 0 && this._readyToExecute) {
                this.execute();
            }
            break;

        case 'result':
            this._complete = true;
            this._handleResult(message);
            break;

        case 'error':
            this._complete = true;
            log.log(log.ERROR, 'Error [%s] type [%s] for call %s', message.message,
                message.name, this);
            this.emit('call-error', message.message, message.name);
            break;

        default:
            log.log(log.WARN, 'Unknown message: %j for %s', message, this);
            break;
    }
};

/**
 * When the message comes back that a call has completed, determine if there
 * is post-processing that needs to be done because of a 'facade' being
 * returned
 * @param message
 * @private
 */
FacadeCall.prototype._handleResult = function(message) {

    if (this._returnFacade) {
        try {
            this._facadeResult.assignObject(message.value);
        }
        catch (e) {
            // Throw error
            log.log(log.ERROR, 'Object Error [%s] for call %s', e.message, this);
            this.emit('call-error', e.message, 'facade-object');
            return;
        }

        message.value = this._facadeResult;

        // Clear the facade result, so that it won't be closed when this call is closed
        this._facadeResult = null;
    }

    this._setResultValue(message.value);
    log.log(log.DEBUG2, 'Call complete for %s', this);
    this.emit('complete');
};

/**
 * Sets the result value.  Does nothing for facade call
 * @param value
 * @private
 */
FacadeCall.prototype._setResultValue = function(value) {
    // Do nothing
};

/**
 * Create a stream to the given remote Endpoint.js.
 * @returns {*}
 */
FacadeCall.prototype.establishStream = function(type, buffered) {
    var stream = this.getStreamer().createStream(
        this.getRemoteId(),
        this.getRemoteAddress(),
        {
            id: this.getId(),
            type: type
        },
        {
            objectMode: !buffered
        }
    );
    return stream;
};

/**
 * Special version of pipe which assumse that the stream
 * starts out remote (at a facade) and either goes to another
 * remote, or goes local.
 * @param nextCall
 */
FacadeCall.prototype.pipe = function(nextCall) {

    // Pass the buffered status
    nextCall.setBuffered(this.isBuffered());

    // Forward the data
    if (nextCall.isFacadeCall()) {

        nextCall.incrementExpectedStreamCount();

        // Remote Stream to Remote Stream
        this.establishRemoteStream(
            nextCall.getId(),
            nextCall.getRemoteAddress(),
            nextCall.getRemoteId(),
            this.isBuffered());
    }
    else if (nextCall.isStreamCall() ||
        (nextCall.isCallbackCall() && nextCall.wantsStreams())) {

        // Remote Stream to Local Stream
        var stream = this.establishOutputStream(this.isBuffered());
        nextCall.connectForwardStream(stream);
        nextCall.connectReverseStream(stream);

    }
    else if (nextCall.isCallbackCall()) {

        // jscs:disable disallowEmptyBlocks
        // No stream.

    }
    else {
        throw new Error('Unknown call type');
    }
};

/**
 * Execute the Facade call
 */
FacadeCall.prototype.execute = function() {
    if (this._pendingStreamsCount > 0) {
        this._readyToExecute = true;
    }
    else {
        // jscs:disable requireDotNotation
        // Convert arguments, looking for facades
        var xargs = [];
        var args = [];
        for (var i = 0; i < this._args.length; i++) {
            var item = this._args[i];
            if (item instanceof Facade) {
                xargs.push(i);
                args.push(item.getRemoteId());
            }
            /*jshint -W069 */
            else if (item['_facade'] && item['_facade'] instanceof Facade) {
                xargs.push(i);
                args.push(item['_facade'].getRemoteId());
            }
            /*jshint +W069 */
            else {
                args.push(this._args[i]);
            }
        }

        // Send the call
        log.log(log.DEBUG2, 'Sent call for %s', this);
        this._executing = true;
        var call = {
            type: 'call',
            func: this._func.getFacadeFunctionName(),
            args: args,
            xargs: xargs
        };
        if (!this._returnResult) {
            call.type = 'call-ignore';
        }
        else if (this._returnFacade) {
            // Derive the new name for the facade;
            var newName = format('%s.%s', this._facade.getName(), call.func);

            // Create the facade to be returned, which will have our facade as a parent.
            this._facadeResult = this._facade.getClient()
                .createFacadeInstance(newName, this._facade);

            call.type = 'call-facade';
            call.facadeId = this._facadeResult.getId();
        }
        this._sendMessage(call);
    }
};

/**
 * Send a message to the remote host
 * @param message
 * @private
 */
FacadeCall.prototype._sendMessage = function(message) {
    message.id = this.getId();
    this.getMessenger().sendMessage(
        this.getRemoteAddress(),
        this.getRemoteId(),
        message);
};

/**
 * Cancel the call
 * @private
 */
FacadeCall.prototype._handleClose = function() {
    if (!this._complete && this._executing) {
        this._sendMessage({
            type: 'cancel'
        });
    }
    // If there is an outstanding facade, then kill it
    if (this._facadeResult) {
        this._facadeResult.close();
    }
};

}).call(this,"/js\\app\\api\\facade\\calls\\facade-call.js")
},{"../../../util/appUtils":54,"../call":8,"../facade":15,"util":92}],12:[function(require,module,exports){
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

var Call = require('../call'),
    inherits = require('util').inherits,
    through2 = require('through2');

inherits(StreamCall, Call);

module.exports = StreamCall;

/**
 * StreamCall is a call that takes a forward and reverse stream and pipes data
 * into the stream.  It is meant to be called at the end of a pipe chain.
 * @augments Call
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings - settings passed into {@link Call}
 * @param {Stream} settings.forwardStream - forward flowing data
 * @param {Stream} settings.reverseStream - reverse flowing data
 * @constructor
 */
function StreamCall(endpointManager, settings) {
    if (!(this instanceof StreamCall)) {
        return new StreamCall(endpointManager, settings);
    }

    // Call parent constructor
    Call.call(this, endpointManager, settings);

    this._forwardStream = settings.forwardStream || through2.obj();
    this._reverseStream = settings.reverseStream || through2.obj();
}

/**
 * Whether this is a call to a local stream
 */
StreamCall.prototype.isStreamCall = function() {
    return true;
};

/**
 * This function will set the forward stream;
 * @param stream
 */
StreamCall.prototype.setForwardStream = function(stream) {
    this._forwardStream = stream;
};

/**
 * This function will set the reverse stream
 * @param stream
 */
StreamCall.prototype.setReverseStream = function(stream) {
    this._reverseStream = stream;
};

/**
 * Set the forward stream
 * @param stream
 */
StreamCall.prototype.connectForwardStream = function(stream) {

    // Piping
    stream.pipe(this._forwardStream);

    // Call parent
    Call.prototype.connectForwardStream.call(this, this._forwardStream);
};

/**
 * Set the reverse stream
 * @param stream
 */
StreamCall.prototype.connectReverseStream = function(stream) {

    // Piping
    this._reverseStream.pipe(stream);

    // Call Parent
    Call.prototype.connectReverseStream.call(this, this._reverseStream);
};

},{"../call":8,"through2":89,"util":92}],13:[function(require,module,exports){
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

var StreamCall = require('./stream-call'),
    inherits = require('util').inherits,
    through2 = require('through2');

inherits(TransformCall, StreamCall);

module.exports = TransformCall;

/**
 * A TransformCall is a stream call where transform functions are specified on
 * the data.
 * @augments StreamCall
 * @param {EndpointManager} endpointManager - used to track the endpoint
 * @param {Object} settings - settings passed into {@link StreamCall}
 * @param {Stream} settings.inputFunc - forward flowing data transform
 * @param {Stream} settings.outputFunc - reverse flowing data transform
 * @constructor
 */
function TransformCall(endpointManager, settings) {
    if (!(this instanceof TransformCall)) {
        return new TransformCall(endpointManager, settings);
    }

    // Call parent constructor
    StreamCall.call(this, endpointManager, settings);

    this._inputFunc = settings.inputFunc;
    this._outputFunc = null;

    if (settings.hasOwnProperty('outputFunc')) {
        this._outputFunc = settings.outputFunc;
    }

    // Setup the transform stream
    var transformStream = this._setupTransform(this._inputFunc);
    this.setForwardStream(transformStream);

    // Setup the transform stream
    if (this._outputFunc !== null) {
        transformStream = this._setupTransform(this._outputFunc);
        this.setReverseStream(transformStream);
    }
}

/**
 * Create a transform stream
 * @param func
 * @private
 */
TransformCall.prototype._setupTransform = function(func) {
    if (this.isBuffered()) {
        return through2(func);
    }
    else {
        return through2.obj(func);
    }
};

},{"./stream-call":12,"through2":89,"util":92}],14:[function(require,module,exports){
(function (__filename){
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
    uuid = require('node-uuid'),
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

}).call(this,"/js\\app\\api\\facade\\client.js")
},{"../../endpoint/endpoint":26,"../../util/appUtils":54,"../../util/constants":55,"./facade":15,"events":64,"node-uuid":69,"util":92}],15:[function(require,module,exports){
(function (__filename){
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

}).call(this,"/js\\app\\api\\facade\\facade.js")
},{"../../endpoint/endpoint":26,"../../util/appUtils":54,"../../util/constants":55,"./strategy":17,"node-uuid":69,"util":92}],16:[function(require,module,exports){
(function (__filename){
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
    uuid = require('node-uuid'),
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

}).call(this,"/js\\app\\api\\facade\\query.js")
},{"../../endpoint/endpoint":26,"../../routing/address":36,"../../util/appUtils":54,"../../util/constants":55,"node-uuid":69,"util":92,"xtend":93}],17:[function(require,module,exports){
(function (__filename){
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
    uuid = require('node-uuid'),
    baseCall = require('./calls/base-call'),
    callbackCall = require('./calls/callback-call'),
    facadeCall = require('./calls/facade-call'),
    streamCall = require('./calls/stream-call'),
    transformCall = require('./calls/transform-call'),
    appUtils = require('../../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Strategy, EventEmitter);

module.exports = Strategy;

/**
 * A Strategy is meant to execute intelligent routing within Endpoint.js.  You can
 * use it to route messages throughout the Endpoint.js network.  It operates similar to a
 * 'promise' in that it allows you to use .then() syntax, as well as .catch() syntax
 * if there is an error, but it will allow two types of values to be specified.  You
 * can use a normal javascript function, or an instance of an Endpoint.js facade function.
 * If you use a facade function, then the 'route' that you want the data to take
 * will be embedded in your initial function call.  When that call finishes, it will
 * stream its data to the next location in your route (or multiple locations), before
 * finally coming back to you.  It will also allow you to specify a stream.
 * @augments EventEmitter
 * @example
 * <caption>You have three Endpoint.js modules connected, X to Y to Z.
 * Your request will be executed at Y, then forwarded to Z, before coming back to
 * you, to execute in your callback function.  Every chunk of data will execute
 * your callback function, until EOF.
 * You, at X, execute:</caption>
 * Y.func1(arguments)
 *  .pipe(Z.func2)
 *  .then(function(data) {
 *    doAction()
 *  });
 * @example <caption>Example 2:
 * Your call will be executed on Y, then the results returned to X and piped to streamA.
 * </caption>
 * Y.func1(arguments)
 *  .pipe(Z.func2)
 *  .pipe(streamA);
 * @param {EndpointManager} endpointManager - used to track the {@link Call} objects
 *   created by this endpoint.
 * @constructor
 */
function Strategy(endpointManager) {
    if (!(this instanceof Strategy)) { return new Strategy(endpointManager); }

    EventEmitter.call(this);

    this._route = [];
    this._id = uuid();
    this._catch = null;
    this._executing = false;
    this._endpointManager = endpointManager;
    this._currentCall = null;
}

/**
 * Simple identifier to identify this specific strategy.
 */
Strategy.prototype.getId = function() {
    return this._id;
};

/**
 * This is an ordered list of calls/pipes, and thens with
 * the functions (and thus the facades) needed in order to
 * execute the function remotely.
 * @returns {Array}
 */
Strategy.prototype.getRoute = function() {
    return this._route.slice(0);
};

/**
 * Clear the route without closing each call.
 */
Strategy.prototype.clearRoute = function() {
    this._route = [];
};

/**
 * Whether this strategy is currently executing
 * @return boolean
 */
Strategy.prototype.isExecuting = function() {
    return this._executing;
};

/**
 * This function is called whenever there is an error executing
 * this Strategy
 * @returns {*}
 */
Strategy.prototype.getCatch = function() {
    return this._catch;
};

/**
 * Call the remote facade function.
 * @param facadeFunction
 */
Strategy.prototype.call = function(facadeFunction, argsObj) {

    if (this._executing) {
        this.cancel();
        throw new Error('Cannot add to an executing strategy');
    }

    if (this._route.length > 0) {
        this.cancel();
        throw new Error('Can only make one base call per strategy');
    }

    if (!(facadeFunction.hasOwnProperty('isFacadeFunction') &&
        facadeFunction.isFacadeFunction())) {
        this.cancel();
        throw new Error('Must use a facade function');
    }

    var settings = {
        func: facadeFunction,
        args: this._cacheArguments(argsObj, 0),
        instanceId: this._endpointManager.getInstanceId()
    };

    this._route.push(baseCall(this._endpointManager, settings));

    return this;
};

/**
 * Pipe the result to a stream, facade function, or function.
 * If a facade function, it will be in the context input stream.  If
 * a function, then it will call the function until EOF (where it will
 * send null)
 * @param stream
 */
Strategy.prototype.pipe = function(stream) {
    if (this._executing) {
        this.cancel();
        throw new Error('Cannot add to an executing strategy');
    }

    var settings;
    if (stream.hasOwnProperty('isFacadeFunction') && stream.isFacadeFunction()) {

        settings = {
            func: stream,
            args: this._cacheArguments(arguments, 1),
            instanceId: this._endpointManager.getInstanceId()
        };

        this._route.push(facadeCall(this._endpointManager, settings));

    }
    else if (stream instanceof Strategy) {
        log.log(log.DEBUG2, 'Concatenating passed strategy with this strategy [passed: %s] [this: %s]',
            stream.getId(), this.getId());
        var route = stream.getRoute();

        // If there are any route items, then concat them onto my
        // strategy.
        if (route.length > 0) {
            // Convert the base to a facade call.
            var base = route.shift();
            if (base.isFacadeCall() && base.isBaseCall()) {
                settings = {
                    func: base.getFunction(),
                    args: base.getArguments()
                };
                var newBase = facadeCall(this._endpointManager, settings);
                this._route.push(newBase);
                base.close();
            }
            else {
                this._route.push(base);
            }

            // Concat the rest
            this._route = this._route.concat(route);

            // Clear the concatenated route, so it will end.
            stream.clearRoute();
        }
    }
    else if (stream.pipe && typeof (stream.pipe) == 'function') {

        settings = {
            forwardStream: stream
        };

        if (arguments.length >= 2 &&
            arguments[1].pipe && typeof (arguments[1].pipe) == 'function') {
            settings.reverseStream = arguments[1];
        }

        this._route.push(streamCall(this._endpointManager, settings));

    }
    else if (typeof (stream) == 'function') {

        settings = {
            inputFunc: stream
        };

        if (arguments.length >= 2 && typeof (arguments[1]) == 'function') {
            settings.outputFunc = arguments[1];
        }

        this._route.push(transformCall(this._endpointManager, settings));

    }
    else {
        this.cancel();
        throw new Error('Must use a stream, facade function, or callback for pipe');
    }

    return this;
};

/**
 * Send the result to a local function callback.  This is always
 * the return value of the previous function, if there is one.
 * @param thenFunc
 */
Strategy.prototype.then = function(thenFunc) {

    if (this._executing) {
        this.cancel();
        throw new Error('Cannot add to an executing strategy');
    }

    if (thenFunc.hasOwnProperty('isFacadeFunction') && thenFunc.isFacadeFunction()) {
        this.cancel();
        throw new Error('Cannot use a facade function on then, use pipe');
    }
    else if (typeof (thenFunc) != 'function') {
        this.cancel();
        throw new Error('Must use a callback for then');
    }

    var settings = {
        func: thenFunc
    };

    this._route.push(callbackCall(this._endpointManager, settings));

    // Special case where the catch is specified as the second argument to then.
    if (arguments.length >= 2 &&
        typeof (arguments[1]) == 'function') {
        this['catch'](arguments[1]);
    }

    return this;
};

/**
 * Error handler.  Forward all errors to the given function
 * IE8 requires this to be defined with property indexing
 * @param catchFunc
 */
Strategy.prototype['catch'] = function(catchFunc) {
    if (this._catch === null) {
        this._catch = catchFunc;
    }
    else {
        this.cancel();
        throw new Error('Cannot catch a Strategy twice');
    }
    return this;
};

/**
 * Return a new stream to be passed to the API function.
 */
Strategy.prototype.stream = function() {
    if (this._executing) {
        this.cancel();
        throw new Error('Cannot add to an executing strategy');
    }

    // Connect a stream
    var base = this._route[0];
    var stream = base.connectInputStream();

    // Execute the strategy.
    this.execute();

    // Return the stream
    return stream;
};

/**
 * Treat the response from the facade call as a facade, so that I can call
 * methods on it and pass it to facade methods as if it was a local object.
 */
Strategy.prototype.facade = function() {
    var base = this._route[0];
    base.setReturnFacade(true);
    return this;
};

/**
 * This is used to set the buffered status of streams generated in this
 * strategy.
 */
Strategy.prototype.buffered = function() {
    if (this._executing) {
        this.cancel();
        throw new Error('Cannot add to an executing strategy');
    }
    var base = this._route[0];
    var setting = true;
    if (arguments.length >= 1 && arguments[0] === false) {
        setting = false;
    }
    base.setBuffered(setting);
    return this;
};

/**
 * Immediately execute this strategy.
 */
Strategy.prototype.execute = function() {
    if (this._executing) {
        return;
    }
    this._executing = true;

    // Perform piping
    var base = this._route[0];
    var prevItem = null;
    for (var i = 0; i < this._route.length; i++) {
        var item = this._route[i];
        if (prevItem !== null) {
            prevItem.pipe(item);
        }
        prevItem = item;
        // Break on a 'then'.  Any further piping will be handled
        // by the next strategy returned from the then() if there is one.
        if (item.isCallbackCall()) {
            // Tell the base call to return a result, because then was specified
            // This exists because it's pointless to return a value from the
            // remote function if there's no 'then()' to handle it.
            if (item.getFunc().length > 0) {
                base.setReturnResult(true);
            }

            // Don't process more items, because any further route items
            // will be tacked onto the strategy returned from the callback
            // call, if there are any.
            break;
        }
    }

    // Execute the strategy.
    var _this = this;
    var result = null;
    var executeNext = function() {

        if (_this._route.length > 0) {

            var currentCall = _this._currentCall = _this._route.shift();
            currentCall.setResult(result);

            currentCall.on('call-error', function(message, name) {
                currentCall.close();
                _this._callCatch(message, name);
                _this.cancel();
            });

            currentCall.on('complete', function() {
                currentCall.close();
                result = currentCall.getResult();

                // If the result is another strategy, then tack on
                // all the items after .then().
                if (currentCall.isCallbackCall()) {
                    if (result instanceof Strategy) {
                        // This will clear our route and append it
                        // onto the 'result' strategy, meaning this
                        // call will be complete.
                        result.pipe(_this);
                    }
                    else {
                        if (_this._route.length > 0) {
                            // Don't execute any further calls
                            log.log(log.ERROR, 'Additional items after then(), but strategy not returned');
                            _this.cancel();
                        }
                    }
                }

                executeNext();
            });

            currentCall.execute();

        }
        else {
            log.log(log.DEBUG2, 'Strategy Complete for %s', _this.getId());
            _this.emit('complete');
        }
    };

    log.log(log.DEBUG2, 'Executing Strategy for %s', this.getId());
    executeNext();
};

/**
 * Convert the arguments into an array, and determine
 * which are streams.
 * @private
 */
Strategy.prototype._cacheArguments = function(args, start) {
    var argArray = [];
    for (var i = start; i < args.length; i++) {
        argArray.push(args[i]);
    }
    return argArray;
};

/**
 * Cancel the current call and all pending calls.
 */
Strategy.prototype.cancel = function() {
    if (this._currentCall !== null) {
        this._currentCall.close();
    }
    this._route.forEach(function(call) {
        call.close();
    });
    this._route = [];
    this.emit('complete');
};

/**
 * Call the catch method
 * @param message
 * @private
 */
Strategy.prototype._callCatch = function(message, name) {
    try {
        if (this._catch !== null) {
            this._catch(message, name);
        }
    }
    catch (e) {
        log.log(log.WARN, 'Issue executing catch method [exception: %s] [trace: %s]',
            e.toString(), e.stack);
    }
};

}).call(this,"/js\\app\\api\\facade\\strategy.js")
},{"../../util/appUtils":54,"./calls/base-call":9,"./calls/callback-call":10,"./calls/facade-call":11,"./calls/stream-call":12,"./calls/transform-call":13,"events":64,"node-uuid":69,"util":92}],18:[function(require,module,exports){
(function (__filename){
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

/* globals __filename */
/* jshint -W097 */
'use strict';

// Polyfills for basic EMCAScript tech (for IE8 and Firefox 3.6)
require('./util/polyfills');

var appUtils = require('./util/appUtils'),
    logManager = require('./util/logger'),
    loader = require('./loader'),
    linkDirectory = require('./switching/link-directory'),
    configurationFactory = require('./config/configuration-factory'),
    log = appUtils.getLogger(__filename);

/**
 * This file initializes all the individual pieces of Endpoint.js
 * and connects them together for a web browser.
 * @module browser
 */

// If a manual log level is set, then set the log.
if (appUtils.getGlobalObject().endpointLogLevel) {
    logManager.logLevel = appUtils.getGlobalObject().endpointLogLevel;
}

// What is the name of this script?
appUtils.initScriptName();

// If we're already initialized, then don't do anything.
if (!appUtils.getGlobalObject().endpoint) {

    var linkDirectoryInstance = linkDirectory();

    var configJson = {};
    if (appUtils.getGlobalObject().endpointConfig) {
        configJson = appUtils.getGlobalObject().endpointConfig || {};
    }

    // Default configuration based on being in a web browser.
    var config = configurationFactory(linkDirectoryInstance)
        .createDefaultBrowserConfiguration(configJson);

    // Get an instance of the API
    var apiInstance = loader(linkDirectoryInstance, config);

    // Set the api instance on the window.
    appUtils.getGlobalObject().endpoint = apiInstance;

    // We're done!
    log.log(log.INFO, 'Endpoint.js Initialized [Instance ID: %s]', apiInstance.getInstanceId());
}
else {
    log.log(log.INFO, 'Endpoint.js Already Initialized');
}


}).call(this,"/js\\app\\browser.js")
},{"./config/configuration-factory":19,"./loader":35,"./switching/link-directory":46,"./util/appUtils":54,"./util/logger":57,"./util/polyfills":59}],19:[function(require,module,exports){
(function (__filename){
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
/* globals __filename, SharedWorker */

'use strict';

var support = require('./link-support'),
    configuration = require('./configuration'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

module.exports = ConfigurationFactory;

/**
 * Configuration Factory is used to create default configurations used with
 * Endpoint.js.  An example would be a web-browser specific one, where
 * a web worker is used for all communication unless it isn't supported,
 * in which case local storage is used.  Another example is a Web Worker,
 * which only uses a worker link by default, but might use a Web Socket to
 * connect to a server.
 * @constructor
 */
function ConfigurationFactory(linkDirectory) {
    if (!(this instanceof ConfigurationFactory)) return new ConfigurationFactory(linkDirectory);
    this._linkDirectory = linkDirectory;
}

/**
 * This configuration is used if we're running out of browserify, meaning
 * the application has been loaded via a web application
 * @param {LinkDirectory} linkDirectory - the link directory the configuration adds to
 */
ConfigurationFactory.prototype.createDefaultBrowserConfiguration = function(configJson) {

    var wnd = appUtils.getGlobalObject();

    // Determine if we're a web worker.
    if (support.isWorkerHub(wnd) ||
        support.isWorker(wnd)) {
        log.log(log.DEBUG, 'Creating default web worker configuration');

        return this.createWebWorkerConfiguration(configJson);
    }
    else {
        log.log(log.DEBUG, 'Creating default browser configuration');

        var config = configuration(this._linkDirectory, configJson);
        if (!configJson.links) {
            // Assume we're a 'window' object, and add all applicable links
            var links = [];

            // Always add the window link.  location.origin is polyfilled via
            // ../util/polyfills.
            var windowLinkConfig = {
                linkId: 'default-window',
                type: 'window',
                settings: {
                    origin: wnd.location.origin,
                    external: false
                }
            };
            links.push(windowLinkConfig);

            // Add worker support by default
            var workerLinkConfig = {
                linkId: 'default-worker',
                type: 'worker',
                settings: {}
            };
            links.push(workerLinkConfig);

            var sharedWorkerSupport = support.supportsSharedWorker();

            // If we don't support shared worker, then add
            // local storage so tabs can communicate (eww)
            if (!sharedWorkerSupport && support.supportsLocalStorage()) {
                log.log(log.DEBUG, 'Adding tab link to configuration');
                var tabLinkConfig = {
                    linkId: 'default-tab',
                    type: 'tab',
                    settings: {
                        channel: 'endpointjs-default'
                    }
                };
                links.push(tabLinkConfig);
            }

            // Create the configuration
            log.log(log.DEBUG, 'Adding %s links to configuration', links.length);
            config.addLinks(links);

            // If we support shared worker, then create the worker & add it.
            if (config.get('createSharedWorker') && sharedWorkerSupport) {
                var worker = this._createSharedWorker(config.get('sharedWorkerUrl'));
                var workerLink = this._linkDirectory.getLink('default-worker');
                workerLink.addWorker(worker);
            }

            // If we're an Iframe, then tell our parent that we're here.
            var parentWindow = wnd.parent;
            if (parentWindow && parentWindow !== wnd) {
                // If the document referrer is set, see if our origin matches, if not
                // then don't announce to the parent (since default-window is for same
                // origin only)
                var announce = true;
                if (wnd.document && typeof (wnd.document.referrer) == 'string') {
                    if (wnd.document.referrer.indexOf(wnd.location.origin) == -1) {
                        announce = false;
                    }
                }
                if (announce) {
                    var window = this._linkDirectory.getLink('default-window');
                    window.announceWindow(parentWindow);
                }
            }
        }

        // Setup a listener so that if the window is closed, close all links in the
        // link directory.
        var _this = this;
        appUtils.addEventListener(wnd, 'beforeunload', function() {
            _this._linkDirectory.close();
        });

        return config;
    }
};

/**
 * This configuration is used if we're running out of node.js
 * @param {LinkDirectory} linkDirectory - the link directory the configuration adds to
 */
ConfigurationFactory.prototype.createDefaultServerConfiguration = function(configJson) {
    log.log(log.DEBUG, 'Creating default server configuration');

    if (!configJson.links) {
        // Create the configuration with the 'server' link only.
        var serverLinkConfig = {
            linkId: 'default-server',
            type: 'server',
            settings: {
                channel: 'endpointjs-default'
            }
        };

        // Create the configuration
        configJson.links = [serverLinkConfig];
    }

    return configuration(this._linkDirectory, configJson);
};

/**
 * This configuration is used when we detect that we're in a web worker.
 * It will create a worker link only.
 * @param {LinkDirectory} linkDirectory - the link directory the configuration adds to
 */
ConfigurationFactory.prototype.createWebWorkerConfiguration = function(configJson) {

    var config = configuration(this._linkDirectory, configJson);
    if (!configJson.links) {
        // Web worker by default only has one link, a worker link.
        var workerLinkConfig = {
            linkId: 'default-worker',
            type: 'worker',
            settings: {
                channel: 'endpointjs-default'
            }
        };

        // Create the configuration
        config.addLinks([workerLinkConfig]);

        // Add myself as a listener
        var workerLink = this._linkDirectory.getLink('default-worker');
        workerLink.addHub(appUtils.getGlobalObject());
    }

    return config;
};

/**
 * Detect the 'endpoint' script location, and create a shared worker to
 * the Endpoint.js script, thereby creating an Endpoint.js hub.
 * @private
 */
ConfigurationFactory.prototype._createSharedWorker = function(scriptName) {
    if (!scriptName) {
        scriptName = appUtils.getScriptName();
    }
    log.log(log.DEBUG, 'Creating shared worker hub: [URL: %s]', scriptName);
    try {
        return new SharedWorker(scriptName);
    }
    catch (e) {
        log.log(log.WARN, 'Issue creating shared worker [message: %s]', e.message);
    }
};

}).call(this,"/js\\app\\config\\configuration-factory.js")
},{"../util/appUtils":54,"./configuration":20,"./link-support":23}],20:[function(require,module,exports){
(function (__filename){
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

var appUtils = require('../util/appUtils'),
    uuid = require('node-uuid'),
    isArray = require('util').isArray,
    workerLink = require('../link/worker'),
    tabLink = require('../link/tab'),
    windowLink = require('../link/window'),
    serverLink = require('../link/server'),
    constants = require('../util/constants'),
    linkAssociation = require('./link-association'),
    log = appUtils.getLogger(__filename);

module.exports = Configuration;

/**
 * Configuration is used by the client to add and remove links from
 * an executing instance of Endpoint.js.
 * @param {Object} settings - List of default links
 * @param {Number} settings.instanceId - unique identifier used to identify this endpoint.js
 * @param {Number} settings.maxHops - maximum hops that can be specified in a route
 * @param {Number} settings.maxHostAffinities - maximum affinities allowed between an external host and local hosts
 * @param {Number} settings.maxAdapterInstances - maximum instances that can be created for a specific adapter
 * @param {Array} settings.links - default links to add to the system
 * @constructor
 */
function Configuration(linkDirectory, settings) {
    if (!(this instanceof Configuration)) return new Configuration(linkDirectory, settings);

    // Parse the configuration
    var configOptions = [
        ['instanceId', uuid()],
        ['maxHops', 10],
        ['maxHostAffinities', 25],
        ['maxAdapterInstances', 1000],
        ['maxClientObjects', 100],
        ['createSharedWorker', true],
        ['sharedWorkerUrl', null]
    ];

    // Set options.
    this._options = {};
    configOptions.forEach(function(option) {
        this._options[option[0]] = settings && settings.hasOwnProperty(option[0]) ? settings[option[0]] : option[1];
    }, this);

    // Used to add/remove links from the link directory.
    this._linkDirectory = linkDirectory;
    this._linkAssociation = linkAssociation();

    // Used to create a custom link type.
    this._customLinkTypes = {};

    // Generic link counter used when the link id isn't specified
    this._linkCounter = 1;

    // Add the links, if any are specified.
    if (settings.links) {
        this.addLinks(settings.links);
    }
}

/**
 * Add the given links to Endpoint.js
 * @param linksJson
 */
Configuration.prototype.addLinks = function(linksJson) {
    // Add each link given in settings if there are any
    if (linksJson && linksJson.length > 0) {
        log.log(log.DEBUG2, 'Adding: %s default links', linksJson.length);
        linksJson.forEach(function(link) {
            this.addLink(link);
        }, this);
    }
};

/**
 * Return the given option
 * @returns {*}
 */
Configuration.prototype.get = function(option) {
    return this._options[option];
};

/**
 * This will allow developers to add their own custom link type.
 * @param {String} linkType - name
 * @param {Function} linkFunction - a function which will be called with three parameters, instanceId,
 *   linkId and 'settings'.  Should return a class which implements the same interface as 'Link'
 */
Configuration.prototype.addCustomLinkType = function(linkType, linkFunction) {
    this._customLinkTypes[linkType] = linkFunction;
};

/**
 * This function is used to add a new link to Endpoint.js.  It contains the link type
 * as well as an identifier to retrieve the link if desired at another time
 * @param {Object} linkConfig
 * @param {String} linkConfig.linkId - unique link identifier (automatically assigned if not set)
 * @param {String} linkConfig.type - the type of the link
 * @param {String} linkConfig.settings - unique options for this link, passed to constructor
 * @todo leader election for specific links
 */
Configuration.prototype.addLink = function(linkConfig) {
    var msg;

    if (!linkConfig.type) {
        msg = 'No link type specified';
        log.log(log.ERROR, msg);
        throw new Error(msg);
    }

    var linkId = linkConfig.linkId || this._linkCounter++;
    var linkInstanceId = this.get('instanceId');
    var linkSettings = linkConfig.settings || {};

    var link;
    switch (linkConfig.type) {
        case constants.LinkType.SERVER:
            link = serverLink(linkInstanceId, linkId, linkSettings);
            break;

        case constants.LinkType.WORKER:
            link = workerLink(linkInstanceId, linkId, linkSettings);
            break;

        case constants.LinkType.WINDOW:
            link = windowLink(linkInstanceId, linkId, linkSettings);
            break;

        case constants.LinkType.TAB:
            link = tabLink(linkInstanceId, linkId, linkSettings);
            break;

        default:
            // See if it's a custom link type.
            if (this._customLinkTypes[linkConfig.type]) {
                link = this._customLinkTypes[linkConfig.type](linkInstanceId, linkId, linkSettings);
            }
            else {
                msg = 'Link type unknown: ' + linkConfig.type;
                log.log(log.ERROR, msg);
                throw new Error(msg);
            }
    }

    // Add the link to the link directory and return it.
    this._linkDirectory.addLink(link);
    return link;
};

/**
 * Return the given link if it is registered.
 * @param linkId
 */
Configuration.prototype.getLink = function(linkId) {
    return this._linkDirectory.getLink(linkId);
};

/**
 * Used to remove a specific link by id, closing all the connections maintained in the
 * link
 * @param {String} linkId
 */
Configuration.prototype.removeLink = function(linkId) {
    this._linkDirectory.removeLink(this.getLink(linkId));
};

/**
 * Return the link association object
 * @returns {*}
 */
Configuration.prototype.getLinkAssociation = function() {
    return this._linkAssociation;
};

/**
 * Create a bridge between the given link ids to allow relay.
 * @param links - a link id, or an array of link ids.
 * @param selfRelay - allow links on one link to communicate through this instance (default false)
 * @return {LinkBridge}
 */
Configuration.prototype.createBridge = function(links, selfRelay) {
    if (!isArray(links)) {
        if (typeof (links) != 'undefined') {
            links = [links];
        }
        else {
            links = [];
        }
    }
    var grp = this._linkAssociation.createBridge(!!selfRelay);
    links.forEach(function(link) {
        grp.addLinkId(link);
    });
    return grp;
};

}).call(this,"/js\\app\\config\\configuration.js")
},{"../link/server":31,"../link/tab":32,"../link/window":33,"../link/worker":34,"../util/appUtils":54,"../util/constants":55,"./link-association":21,"node-uuid":69,"util":92}],21:[function(require,module,exports){
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

'use strict';

var linkBridgeFactory = require('./link-bridge');

module.exports = LinkAssociation;

/**
 * Link Association maintains the associations of links within
 * {LinkBridge} objects.  Link Bridges are created and maintained in
 * this class.  When they close, the associations are removed. Link
 * Associations are maintained even if the link they represent doesn't
 * exist.  The associations allow for secure Bus traffic by ensuring that
 * events are only passed to desired links.
 * @constructor
 */
function LinkAssociation() {
    if (!(this instanceof LinkAssociation)) return new LinkAssociation();

    // This is a list of link bridges indexed by link bridge id.
    this._linkBridges = {};

    // A list of associations between links
    this._linkAssociations = {};

    // Pointers for add/remove association functions
    this._addLinkAssociationPtr = this._addLinkAssociation.bind(this);
    this._removeLinkAssociationPtr = this._removeLinkAssociation.bind(this);
    this._removeBridgePtr = this._removeBridge.bind(this);
}

/**
 * Add an association between link1 and link2.
 * @param link1
 * @param link2
 * @private
 */
LinkAssociation.prototype._addLinkAssociation = function(link1, link2) {
    var assocA = this._linkAssociations[link1];
    if (!assocA) {
        assocA = this._linkAssociations[link1] = {
            _assoc: {},
            _count: 0
        };
    }
    var assocB = assocA._assoc[link2];
    if (!assocB) {
        assocA._count += 1;
        assocA._assoc[link2] = 0;
    }
    assocA._assoc[link2] += 1;
};

/**
 * Remove the association between link1 and link2.
 * @param link1
 * @param link2
 * @private
 */
LinkAssociation.prototype._removeLinkAssociation = function(link1, link2) {
    var assocA = this._linkAssociations[link1];
    if (assocA) {
        var assocB = assocA._assoc[link2];
        if (assocB) {
            assocA._assoc[link2] -= 1;
            if (assocA._assoc[link2] === 0) {
                delete assocA._assoc[link2];
                assocA._count -= 1;
            }
            if (assocA._count === 0) {
                delete this._linkAssociations[link1];
            }
        }
    }
};

/**
 * Returns the bridge if it exists
 * @param bridgeId
 */
LinkAssociation.prototype.getBridge = function(bridgeId) {
    return this._linkBridges[bridgeId];
};

/**
 * Create a new link bridge and return it.
 * @param selfRelay - allow sending of data
 */
LinkAssociation.prototype.createBridge = function(selfRelay) {
    var linkBridge = linkBridgeFactory(selfRelay);
    this._linkBridges[linkBridge.getId()] = linkBridge;
    linkBridge.on('add-association', this._addLinkAssociationPtr);
    linkBridge.on('remove-association', this._removeLinkAssociationPtr);
    linkBridge.on('closed', this._removeBridgePtr);
    return linkBridge;
};

/**
 * When a link bridge is closed, then remove the listeners.
 * @param id
 * @private
 */
LinkAssociation.prototype._removeBridge = function(id) {
    var linkBridge = this._linkBridges[id];
    if (linkBridge) {
        delete this._linkBridges[id];
        linkBridge.removeListener('add-association', this._addLinkAssociationPtr);
        linkBridge.removeListener('remove-association', this._removeLinkAssociationPtr);
        linkBridge.removeListener('closed', this._removeBridgePtr);
    }
};

/**
 * Given a linkA, see if it's associated with linkB.
 * @param linkId
 */
LinkAssociation.prototype.isAssociated = function(linkA, linkB) {
    var data = this._linkAssociations[linkA];
    if (data && data._assoc[linkB]) {
        return true;
    }
    return false;
};

},{"./link-bridge":22}],22:[function(require,module,exports){
(function (__filename){
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
    uuid = require('node-uuid'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(LinkBridge, EventEmitter);

module.exports = LinkBridge;

/**
 * A link bridge describes which links should participate in a bus
 * transaction.  The purpose is to limit the hosts we send bus
 * requests to.  For example, assume we have the following layout:
 * default-server (link for client/server)
 * cross-domain-xyz.com (link for cross domain web application)
 * We want our application to access services on both of these
 * Endpoint.js instances, but we don't want specific requests going
 * from client to server to be intercepted and overridden by ones from
 * cross-domain-xyz.com.
 * By default, the bus operates in a fully open mode.
 * @augments EventEmitter
 * @param selfRelay - whether links are associated / relay to themselves in this bridge.
 * @returns {LinkBridge}
 * @constructor
 */
function LinkBridge(selfRelay) {
    if (!(this instanceof LinkBridge)) return new LinkBridge(selfRelay);
    EventEmitter.call(this);
    this._id = uuid();
    this._selfRelay = !!selfRelay;
    this._links = {};
}

/**
 * Return a unique identifier for storing in a hash table
 */
LinkBridge.prototype.getId = function() {
    return this._id;
};

/**
 * Return whether the link id is in the bridge.
 * @param linkId
 */
LinkBridge.prototype.hasLinkId = function(linkId) {
    return !!this._links[linkId];
};

/**
 * Add a specific link from this bridge, emit events
 * @param linkId
 */
LinkBridge.prototype.addLinkId = function(linkId) {
    var id = this._links[linkId];
    if (!id) {
        this._event('add-association', linkId);
        this._links[linkId] = true;
    }
};

/**
 * Remove a specific link from this bridge, emit events
 * @param linkId
 */
LinkBridge.prototype.removeLinkId = function(linkId) {
    var id = this._links[linkId];
    if (id) {
        delete this._links[linkId];
        this._event('remove-association', linkId);
    }
};

/**
 * Emit bi-directional events to the link-associations
 * @param type
 * @param linkId
 * @private
 */
LinkBridge.prototype._event = function(type, linkId) {
    if (this._selfRelay) {
        log.log(log.DEBUG3, 'Emitting self relay %s for %s', type, linkId);
        this.emit(type, linkId, linkId);
    }
    Object.keys(this._links).forEach(function(existingLink) {
        log.log(log.DEBUG3, 'Emitting %s for %s <-> %s', type, linkId, existingLink);
        this.emit(type, existingLink, linkId);
        this.emit(type, linkId, existingLink);
    }, this);
};

/**
 * Emit event to remove all associations added by this bridge
 */
LinkBridge.prototype.close = function() {
    Object.keys(this._links).forEach(function(linkId) {
        this._event('remove-association', linkId);
    }, this);
    this.emit('closed', this.getId());
};

}).call(this,"/js\\app\\config\\link-bridge.js")
},{"../util/appUtils":54,"events":64,"node-uuid":69,"util":92}],23:[function(require,module,exports){
(function (__filename){
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
/* globals __filename, WorkerGlobalScope, SharedWorker */

'use strict';

var appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

/**
 * This namespace has functions to test for support of various
 * transports
 * @namespace link-support
 */
module.exports = {

    /**
     * This function can be used to detect if we're a worker hub.
     */
    isWorkerHub: function(worker) {
        if ('onconnect' in worker) {
            return true;
        }
        return false;
    },

    /**
     * This function can be used to detect if we're a worker.
     */
    isWorker: function(worker) {
        if (typeof (WorkerGlobalScope) != 'undefined' && worker instanceof WorkerGlobalScope) {
            return true;
        }
        return false;
    },

    /**
     * Test whether this browser supports local storage
     * @returns {boolean}
     */
    supportsLocalStorage: function() {
        var globalObject = appUtils.getGlobalObject();
        var localStorage = globalObject.localStorage;

        var setItemAllowed = true;
        try {
            localStorage.setItem('__test_support', '');
            localStorage.removeItem('__test_support');
        } catch (e) {
            setItemAllowed = false;
        }

        var supported = localStorage && setItemAllowed &&
            (typeof (globalObject.addEventListener) == 'function' ||
                typeof (globalObject.attachEvent) == 'function');

        log.log(log.DEBUG3, 'Local Storage Supported: %s', supported);

        return supported;
    },

    /**
     * Whether the 'shared worker' class exists, and whether we can create
     * a shared worker.  This also requires the 'script name' to be set,
     * which is determined in the 'browser.js' bootstrap code
     */
    supportsSharedWorker: function() {
        if (typeof (SharedWorker) !== 'function') {
            return false;
        }
        var scriptName = appUtils.getScriptName();
        if (scriptName) {
            if (!(/endpoint/.test(scriptName))) {
                log.log(log.ERROR, 'Endpoint.js Script must be synchronously loaded and have endpoint in the ' +
                    'name to use Shared Worker transport');
                return false;
            }
            // We know we're in a window, so we're going to use HREF tag to parse urls.
            // Node.js URL library is too large for browser.
            var scriptLink = appUtils.getGlobalObject().document.createElement('a');
            scriptLink.href = scriptName;
            // Get the window origin.
            var obj = appUtils.getGlobalObject().location;
            if (obj.protocol == scriptLink.protocol &&
                obj.hostname == scriptLink.hostname &&
                obj.port == scriptLink.port) {
                return true;
            }
        }

        log.log(log.WARN, 'Cannot create shared worker, unknown script name or cross-domain issue.');
        return false;
    }

};

}).call(this,"/js\\app\\config\\link-support.js")
},{"../util/appUtils":54}],24:[function(require,module,exports){
(function (__filename){
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

var appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    address = require('../routing/address'),
    constants = require('../util/constants'),
    isArray = require('util').isArray,
    xtend = require('xtend'),
    inherits = require('util').inherits,
    EventEmitter = require('events').EventEmitter;

inherits(Bus, EventEmitter);

module.exports = Bus;

/**
 * The bus uses EventEmitter to create a global message bus.  It also uses
 * the router to propagate messages to all other nodes in the
 * network using a controlled flooding algorithm.
 * https://en.wikipedia.org/wiki/Flooding_(computer_networking)
 * @augments EventEmitter
 * @fires Bus#X - where X is the global event to fire
 * @param {Router} routerInstance - an instance of the Router class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function Bus(routerInstance, config) {
    if (!(this instanceof Bus)) { return new Bus(routerInstance, config); }

    this._id = config.get('instanceId');
    this._sequence = 1;

    // Call parent Constructor
    EventEmitter.call(this);
    this.setMaxListeners(0);

    // This is the host information
    this._hosts = {};

    // This allows us to look up bridges to ensure that the link is in the bridge
    this._linkAssociation = config.getLinkAssociation();

    // Register with the router
    this._routerInstance = routerInstance;
    this._routerInstance.addHandler('bus');
    this._routerInstance.on('route-available', this._handleRouteAvailable.bind(this));
    this._routerInstance.on('route-change', this._handleRouteChange.bind(this));
    this._routerInstance.on('route-unavailable', this._handleRouteLost.bind(this));
    this._routerInstance.on('bus', this._handleBusPacket.bind(this));
}

/**
 * When a new host is available, then register it.
 * @param address
 * @param cost
 * @private
 */
Bus.prototype._handleRouteAvailable = function(address, route) {

    this._hosts[address] = {
        address: address,
        linkId: route.linkId,
        adjacent: route.adjacent,
        external: route.external,
        sequence: -1
    };

    if (route.adjacent) {
        log.log(log.DEBUG, 'Discovered new adjacent host ' +
            '[id: %s]', address);
    }
    else {
        log.log(log.DEBUG, 'Discovered new non-adjacent host ' +
            '[id: %s]', address);
    }
};

/**
 * When the adjacency of a route changes
 * @param address
 * @param adjacent
 * @private
 */
Bus.prototype._handleRouteChange = function(address, route) {
    this._hosts[address].adjacent = route.adjacent;
    this._hosts[address].linkId = route.linkId;
};

/**
 * Remove the host from the registry.
 * @param address
 * @private
 */
Bus.prototype._handleRouteLost = function(address) {
    // Remove the host
    delete this._hosts[address];
};

/**
 * Read a packet from the given address
 * @param envelope
 * @param address - the immediate link we received the message from
 * @private
 */
Bus.prototype._handleBusPacket = function(packet, fromUuid, source) {

    // Is the immediate packet sender external?
    var fromInfo = this._hosts[fromUuid];
    if (!fromInfo) {
        log.log(log.WARN, 'Received bus packet from unknown host (ignoring): %s', fromUuid);
        return;
    }

    if (!isArray(packet.path) || !isArray(packet.event)) {
        log.log(log.WARN, 'Invalid packet from %s: %j', fromUuid, packet);
        return;
    }

    // Process the packet based on whether it originated internally or
    // externally.  This 'sequenceHost' is either the internal network
    // originator, or the external uuid if external.
    var sequenceHost;
    if (fromInfo.external) {
        sequenceHost = this._handleExternalBusPacket(packet, fromInfo);
    }
    else {
        sequenceHost = this._handleInternalBusPacket(packet, fromUuid);
    }

    if (!sequenceHost) {
        return;
    }

    // Cleanup the sequence number
    packet.seq = parseInt(packet.seq);

    // Update the sequence information
    if (packet.seq <= sequenceHost.sequence) {
        log.log(log.TRACE, 'Ignored duplicate event packet: %j', packet);
        return;
    }
    sequenceHost.sequence = packet.seq;

    if (fromInfo.external) {
        // Fake the message as having come from us within our
        // little internal network.  I will be the 'originator' within
        // the internal network.
        packet.seq = this._sequence++;
    }

    // I don't want to send this packet along if I've already seen it.
    // Check the 'path' value to see if it has the given sequenceHost in
    // it already (more than once, since I just appended it), or
    // if it has my id.
    if (this._hasAlreadySeenPacket(packet, sequenceHost)) {
        log.log(log.TRACE, 'Already seen that packet (path violation)');
        return;
    }

    // Log
    log.log(log.TRACE, 'Read event packet: %j', packet);

    this._emitPacket(packet, source);
    this._forwardPacket(packet, fromInfo, null);
};

/**
 * This function will attempt to find more than two instances of the originator host,
 * or at least one instance of myself.  If it finds either, then it will return
 * true, otherwise false.
 * @param packet
 * @param originatorHost
 * @private
 */
Bus.prototype._hasAlreadySeenPacket = function(packet, originatorHost) {
    var count = 0;
    for (var i = 0; i < packet.path.length; i++) {
        if (packet.path[i] == originatorHost.address) {
            count += 1;
        }
        if (packet.path[i] == this._id || count >= 2) {
            return true;
        }
    }
    return false;
};

/**
 * Received the packet from internal. Just ensure we know who it came from.
 * @param packet
 * @returns {*}
 * @private
 */
Bus.prototype._handleInternalBusPacket = function(packet, fromUuid) {

    if (packet.path.length === 0) {
        log.log(log.WARN, 'Empty path from %s: %j', fromUuid, packet);
        return false;
    }

    // Take the most recent host in the path vector.  This was the host in our
    // group that decided to re-send the message to me (or it was the external
    // host that sent the message to me)
    var originatorUuid = packet.path[packet.path.length - 1];

    // Do we know about the originator? If not, ignore
    // Is the immediate packet sender external?
    var originatorInfo = this._hosts[originatorUuid];
    if (!originatorInfo) {
        log.log(log.WARN, 'Received bus packet from unknown originator (ignoring): %s', originatorUuid);
        return false;
    }

    return originatorInfo;
};

/**
 * Received the message from an external host. Set the src and mode,
 * and update the path to include the external link id.
 * @param packet
 * @param fromInfo
 * @private
 */
Bus.prototype._handleExternalBusPacket = function(packet, fromInfo) {

    // Append the sending host
    packet.path = packet.path.concat(fromInfo.address);

    // If global, then we've gotten the message through an
    // external link.  We don't want to send it through any more external
    // links, so change it to 'group' mode.
    if (packet.mode === constants.Neighborhood.GLOBAL) {
        packet.mode = constants.Neighborhood.GROUP;
    }

    return fromInfo;
};

/**
 * Handles EventEmitter messages
 * @param packet - the packet containing the event to emit
 * @param source - the source of the packet, @see{constants.Neighborhood}
 * @private
 */
Bus.prototype._emitPacket = function(packet, source) {
    try {
        if (EventEmitter.listenerCount(this, packet.event[0])) {
            var deliveryAddress = address(packet.path.concat(this._id));
            var eventCopy = packet.event.slice(0);
            eventCopy.splice(1, 0, deliveryAddress, source);
            EventEmitter.prototype.emit.apply(this, eventCopy);
        }
    }
    catch (e) {
        log.log(log.ERROR, 'Exception executing event: %s %s', e.message, e.stack);
    }
};

/**
 *
 * @param envelope
 * @param fromExternal
 * @private
 */
Bus.prototype._forwardPacket = function(envelope, fromInfo, destinationBridgeId, destinationHostId) {

    // Only send if we're in something greater than local mode!
    if (envelope.mode <= constants.Neighborhood.LOCAL) {
        return;
    }

    var fromSelf = envelope.path.length === 0;
    var fromExternal = fromInfo ? fromInfo.external : false;
    var fromUuid = fromInfo ? fromInfo.address : 'local';

    // Special envelope that has myself appended to the path.
    var envelopeWithPathSequence;
    var envelopeWithPath;

    // Do not re-send the message to any host in the path vector
    // Using a hash here even though the array size is small because
    // indexOf isn't supported in IE8
    var ignoreHosts = {};
    for (var j = 0; j < envelope.path.length; j++) {
        ignoreHosts[envelope.path[j]] = true;
    }
    ignoreHosts[fromUuid] = true;

    log.log(log.TRACE, 'Relay event packet to hosts: %j', envelope);

    // Lookup the bridge
    var bridge;
    if (destinationBridgeId) {
        bridge = this._linkAssociation.getBridge(destinationBridgeId);
    }

    for (var host in this._hosts) {
        if (!ignoreHosts || !ignoreHosts[host]) {
            var hostInfo = this._hosts[host];

            // If this is a bridge destination, then get the link id and ensure it's in
            // the bridge.
            if (bridge) {
                if (!bridge.hasLinkId(hostInfo.linkId)) {
                    continue;
                }
            }

            // If the user has specified a host, then only emit to that host.
            if (destinationHostId) {
                if (host !== destinationHostId) {
                    continue;
                }
            }

            // Only send to adjacent hosts
            if (hostInfo.adjacent) {

                // Only send if we're sending internal or we're sending to external
                // and we have at least Neighborhood.GLOBAL
                if (!hostInfo.external ||
                    (hostInfo.external &&
                        envelope.mode > constants.Neighborhood.GROUP)) {

                    // Append my id to the path in special circumstances (outlined below).
                    // When sending external, we don't append, because the external host will
                    // append me in the appropriate circumstances.
                    var envelopeToSend = envelope;
                    if ((fromExternal && !hostInfo.external) || // from external to internal
                        (fromSelf && !hostInfo.external) || // from self to internal
                        (!fromSelf && !fromExternal && hostInfo.external)) { // from internal to external
                        // append path
                        if (!envelopeWithPath) {
                            envelopeWithPath = xtend(envelope, {
                                path: envelope.path.concat(this._id)
                            });
                        }
                        envelopeToSend = envelopeWithPath;
                    }

                    // If we're sending external, and it's not from ourself, then
                    // we need to increment the sequence number.
                    if (!fromSelf && hostInfo.external) {
                        // append path
                        if (!envelopeWithPathSequence) {
                            envelopeWithPathSequence = xtend(envelope, {
                                path: envelope.path.concat(this._id),
                                seq: this._sequence++
                            });
                        }
                        envelopeToSend = envelopeWithPathSequence;
                    }

                    this._routerInstance.sendPacket(host, 'bus', envelopeToSend, fromUuid);
                }
            }
        }
    }
};

/**
 * Create the packet to send to external hosts
 * @param neighborhood
 * @param arguments
 * @private
 */
Bus.prototype._createPacket = function(neighborhood, event) {
    var packet = {
        event: event,
        seq: this._sequence++,
        mode: neighborhood,
        path: []
    };
    return packet;
};

/**
 * Send to given host and neighborhood only
 * @param destinationBridgeId - only send to all links in this bridge
 * @param destinationHostId - only send to this host (as long as it's in the destination bridge)
 * @param neighborhood
 */
Bus.prototype.emitDirect = function(destinationBridgeId, destinationHostId, neighborhood) {
    var packet = this._createPacket(neighborhood, this._convertArgs(arguments, 3));
    this._forwardPacket(packet, null, destinationBridgeId, destinationHostId);
};

/**
 * Send to given neighborhood
 * @param neighborhood
 */
Bus.prototype.emit = function(neighborhood) {
    var packet = this._createPacket(neighborhood, this._convertArgs(arguments, 1));
    this._emitPacket(packet, constants.Neighborhood.LOCAL);
    this._forwardPacket(packet, null, null, null);
};

/**
 * Convert the given arg array into an array
 * @param args
 * @returns {Array}
 * @private
 */
Bus.prototype._convertArgs = function(args, start) {
    var event = [];
    for (var i = start; i < args.length; i++) {
        event.push(args[i]);
    }
    return event;
};

}).call(this,"/js\\app\\endpoint\\bus.js")
},{"../routing/address":36,"../util/appUtils":54,"../util/constants":55,"events":64,"util":92,"xtend":93}],25:[function(require,module,exports){
(function (__filename){
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


}).call(this,"/js\\app\\endpoint\\endpoint-manager.js")
},{"../util/appUtils":54,"../util/periodic-timer":58,"./endpoint":26,"node-uuid":69}],26:[function(require,module,exports){
(function (__filename){
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

}).call(this,"/js\\app\\endpoint\\endpoint.js")
},{"../util/appUtils":54,"events":64,"util":92}],27:[function(require,module,exports){
(function (__filename){
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

var appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

module.exports = Messenger;

/**
 * The messenger is a simple point to point system that uses addressing
 * and the router to send messages
 * @augments EventEmitter
 * @param {PathVector} pathInstance - an instance of the PathVector class
 * @param {Router} routerInstance - an instance of the Router class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function Messenger(pathInstance, routerInstance, config) {
    if (!(this instanceof Messenger)) return new Messenger(pathInstance, routerInstance, config);

    this._id = config.get('instanceId');

    this._listeners = {};

    // Save a reference to the path vector
    this._pathInstance = pathInstance;

    // Subscribe to router events.
    this._routerInstance = routerInstance;
    this._routerInstance.addHandler('message');
    this._routerInstance.on('message', this._handleMessagePacket.bind(this));
    this._routerInstance.on('message-error', this._handleMessageError.bind(this));
}

/**
 * Register a listener with the messenger.  This should be unique across the
 * Endpoint.js.
 * @param id
 * @param callback
 * @return address
 */
Messenger.prototype.register = function(id, callback) {
    if (!this._listeners[id]) {
        if (typeof (callback) == 'function') {
            this._listeners[id] = callback;
        }
        else {
            var error = new Error('Must register a function callback');
            log.log(log.ERROR, error.message);
            throw error;
        }
    }
    else {
        log.log(log.WARN, 'The listener [id: %s] cannot be registered because ' +
            'it is already registered', id);
    }
};

/**
 * Stop listening for messages for this id.
 * @param id
 */
Messenger.prototype.unRegister = function(id) {
    if (this._listeners[id]) {
        delete this._listeners[id];
    }
    else {
        log.log(log.WARN, 'The listener [id: %s] cannot be removed because ' +
            'it is not registered', id);
    }
};

/**
 * Send a message to a specific host
 * @param remoteAddress - address of remote endpoint.js instance
 * @param remoteId - endpoint id
 * @param message
 */
Messenger.prototype.sendMessage = function(remoteAddress, remoteId, message) {
    var msg = {
        id: remoteId,
        msg: message
    };
    log.log(log.TRACE, 'Outbound Messenger Packet: %j', message);
    this._pathInstance.sendPacket(remoteAddress, 'message', msg);
};

/**
 * Local delivery for remote packet.
 * @param packet
 * @private
 */
Messenger.prototype._handleMessagePacket = function(packet, fromUuid, source) {
    if (packet.id) {
        if (this._listeners[packet.id]) {
            log.log(log.TRACE, 'Inbound Messenger Packet: %j', packet);
            // Local delivery.
            try {
                this._listeners[packet.id](packet.msg, source);
            }
            catch (e) {
                log.log(log.WARN, 'Issue delivering message packet [id: %s] [exception: %s] [trace: %s]',
                    packet.id, e.toString(), e.stack);
            }
        }
        else {
            log.log(log.WARN, 'Unknown messenger id: %j', packet);
        }
    }
    else {
        log.log(log.ERROR, 'Malformed messenger packet: %j', packet);
    }
};

/**
 * If there is an issue in the router routing the message, then
 * log the issue.
 * @param fromUuid
 * @param toUuid
 * @param packet
 * @private
 */
Messenger.prototype._handleMessageError = function(packet, toUuid) {
    log.log(log.ERROR, 'Couldn\'t route message for %j: %j', toUuid, packet);
};

}).call(this,"/js\\app\\endpoint\\messenger.js")
},{"../util/appUtils":54}],28:[function(require,module,exports){
(function (__filename){
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
    address = require('../routing/address'),
    muxStream = require('../streams/mux-stream'),
    uuid = require('node-uuid'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Streamer, EventEmitter);

module.exports = Streamer;

/**
 * This handler handles streams which can be routed throughout the Endpoint.js network.
 * @augments EventEmitter
 * @fires Streamer#stream-X when a new stream is available
 * @param {PathVector} pathInstance - an instance of the PathVector class
 * @param {Router} routerInstance - an instance of the Router class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function Streamer(pathInstance, routerInstance, config) {
    if (!(this instanceof Streamer)) return new Streamer(pathInstance, routerInstance, config);

    EventEmitter.call(this);
    this.setMaxListeners(0);

    this._id = config.get('instanceId');

    // Stream metadata needed by the streamer to route the message
    this._streamInfo = {};

    // A list of streamhandlers indexed by name.
    this._handlers = {};

    // Setup the global multiplexer for this endpoint.
    this._multiplexer = muxStream();
    this._multiplexer.on('readable', this._handleMultiplexerOutbound.bind(this));

    // This listener happens when a new stream has been routed to use for relay to
    // the parent api level.
    this._multiplexer.on('stream', this._handleMultiplexerStream.bind(this));

    // Save a reference to the path vector
    this._pathInstance = pathInstance;

    // Subscribe to router events.
    this._routerInstance = routerInstance;
    this._routerInstance.addHandler('stream');
    this._routerInstance.on('stream', this._handleStreamPacket.bind(this));
    this._routerInstance.on('stream-error', this._handleStreamError.bind(this));
}

/**
 * Data is ready to be send to the router.
 * @private
 */
Streamer.prototype._handleMultiplexerOutbound = function() {
    var msg;
    while ((msg = this._multiplexer.read()) !== null) {
        var streamInfo = this._streamInfo[msg.id];
        if (streamInfo) {
            if (streamInfo.local) {
                msg.id = streamInfo.localId;
            }
            this._pathInstance.sendPacket(streamInfo.remoteAddress, 'stream', msg);
        }
    }
};

/**
 * Forward the unwrapped packet from the router to the multiplexer.
 * @param packet
 * @private
 */
Streamer.prototype._handleStreamPacket = function(packet, fromUuid, source) {
    var id = packet.id;

    var info = this._streamInfo[id];
    if (!info) {
        // New stream we haven't seen before.
        this._streamInfo[id] = {
            local: fromUuid == 'local',
            source: source,
            remoteAddress: null
        };
    }
    else {
        // If we haven't gotten a source packet before, get the first one
        if (!info.source) {
            info.source = source;
        }
        else if (source !== info.source) {
            log.log(log.WARN, 'Packet does not match original source %s: %j', source, packet);
            // Ensure source matches the last source.
            return;
        }
    }
    this._multiplexer.write(packet);
};

/**
 * Tell the multiplexer that we couldn't route a certain packet.
 * @param fromUuid
 * @param toUuid
 * @param packet
 * @private
 */
Streamer.prototype._handleStreamError = function(packet) {
    // Get the id, and if I know about this stream in my multiplexer,
    // then kill it.
    var id = packet.id;
    var str = this._multiplexer.getStream(id);
    if (str) {
        str.end();
    }
};

/**
 * Emit the new stream to the API layer.
 * @private
 */
Streamer.prototype._handleMultiplexerStream = function(stream, opts) {

    if (!stream.meta || !stream.meta.type) {
        log.log(log.ERROR, 'Unknown stream type: %j', stream.meta);
        stream.end();
        return;
    }

    if (!this.hasHandler(stream.meta.type)) {
        log.log(log.ERROR, 'No handler for stream type: %s', stream.meta.type);
        stream.end();
        return;
    }

    var streamInfo = this._streamInfo[stream.id];

    // This lets us create streams to ourself
    var remoteAddress;
    if (streamInfo.local) {
        streamInfo.localId = stream.id.substring(0, stream.id.length - 6);
        remoteAddress = address('local');
    }
    else {
        // Update the streamInfo with the originator
        remoteAddress = address(stream.meta.address);
    }
    streamInfo.remoteAddress = remoteAddress;

    var type = stream.meta.type;
    stream.meta = stream.meta.meta;

    // If the stream ends, then clean-up
    var _this = this;
    stream.on('finish', function() {
        log.log(log.DEBUG2, 'Cleaning up old stream after end: %s', stream.id);
        delete _this._streamInfo[stream.id];
    });

    log.log(log.DEBUG2, 'Received new stream: [local: %s] [id: %s]', streamInfo.local, stream.id);

    // Emit it to the higher layer.
    this.emit('stream-' + type, stream, opts);

};

/**
 * Create a stream to the given destination
 * @param type
 * @param remoteAddress
 * @param meta
 * @param opts
 */
Streamer.prototype.createStream = function(type, remoteAddress, meta, opts) {

    var address = remoteAddress.getPathVector();

    var newStreamId = uuid();
    var streamInfo = this._streamInfo[newStreamId] = {
        local: address.length === 0 || address[address.length - 1] == this._id,
        localId: newStreamId + '.local',
        remoteAddress: remoteAddress
    };

    var wrappedMeta = {
        address: address,
        type: type,
        meta: meta
    };

    // Create the stream, or clean up if it fails.
    var stream;
    try {
        stream = this._multiplexer.createStream(wrappedMeta, opts, newStreamId);
    }
    catch (e) {
        delete this._streamInfo[newStreamId];
        throw e;
    }

    // If the stream ends, then clean-up
    var _this = this;
    stream.on('finish', function() {
        log.log(log.DEBUG2, 'Cleaning up old stream after end: %s', newStreamId);
        delete _this._streamInfo[newStreamId];
    });

    log.log(log.DEBUG2, 'Created new stream [local: %s] [id: %s]', streamInfo.local, newStreamId);

    return stream;
};

/**
 * Return information about a given stream
 * @param streamId
 */
Streamer.prototype.getStreamInfo = function(streamId) {
    return this._streamInfo[streamId];
};

/**
 * Add the given handler to the streamer.
 * @param name
 */
Streamer.prototype.addHandler = function(name) {
    this._handlers[name] = true;
    log.log(log.DEBUG3, 'Added stream handler [name: %s]', name);
};

/**
 * This function removes a valid handler from the streamer.
 * @param name
 */
Streamer.prototype.removeHandler = function(name) {
    if (this._handlers[name]) {
        delete this._handlers[name];
        log.log(log.DEBUG3, 'Removed stream handler [name: %s]', name);
    }
    else {
        log.log(log.WARN, 'That handler isn\'t registered [name: %s]', name);
    }
};

/**
 * Whether the given handler is registered
 * @param name
 */
Streamer.prototype.hasHandler = function(name) {
    if (this._handlers[name]) {
        return true;
    }
    return false;
};

}).call(this,"/js\\app\\endpoint\\streamer.js")
},{"../routing/address":36,"../streams/mux-stream":44,"../util/appUtils":54,"events":64,"node-uuid":69,"util":92}],29:[function(require,module,exports){
(function (__filename){
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
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Link, EventEmitter);

module.exports = Link;

/**
 * Abstract base class for links. This class uses an incrementing
 * value to identify links, and subscribes to the window object
 * to close each link before the window closes
 * @param {Number} linkId - the unique identifier for this link
 * @param {Object} settings
 * @param {Object} settings.transformFactory - a function for adding/removing transforms to a link stream
 * @param {Number} settings.heartbeatTimeout - amount of time to wait before killing link
 * @constructor
 */
function Link(linkId, settings) {
    if (!(this instanceof Link)) { return new Link(linkId, settings); }

    this._linkId = linkId;
    this._settings = settings;

    log.log(log.DEBUG, 'Link initialized: [Type: %s] [ID: %s]', this.getType(), this.getId());
}

/**
 * Returns the heartbeat timeout for this link. If no information is received in this
 * interval, then the link will timeout.  Default to 1.5 minutes
 */
Link.prototype.getHeartbeatTimeout = function() {
    return this._settings.heartbeatTimeout;
};

/**
 * A transform factory is a function that takes a {LinkTransform} interface and adds
 * additional read/write transforms to the link after a connection is made
 */
Link.prototype.getTransformFactory = function() {
    return this._settings.transformFactory;
};

/**
 * Returns the type of link this is
 * @returns {Error}
 */
Link.prototype.getType = function() {
    return new Error('not implemented');
};

/**
 * Return the unique id of this link.
 * @returns {*}
 */
Link.prototype.getId = function() {
    return this._linkId;
};

/**
 * The cost to transmit to this link
 * @returns {number}
 */
Link.prototype.getCost = function() {
    return 0;
};

/**
 * If true, routing information from this host should be treated as
 * 'external', meaning it cannot affect the internal routing table
 */
Link.prototype.isExternal = function() {
    return false;
};

/**
 * Close all open streams
 */
Link.prototype.close = function() {
    log.log(log.DEBUG, 'Link closed: [Type: %s] [ID: %s]', this.getType(), this.getId());
};

}).call(this,"/js\\app\\link\\link.js")
},{"../util/appUtils":54,"events":64,"util":92}],30:[function(require,module,exports){
(function (__filename){
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

var Link = require('./link'),
    inherits = require('util').inherits,
    uuid = require('node-uuid'),
    expHash = require('../util/expirable-hash'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    through2 = require('through2');

inherits(ProtocolLink, Link);

module.exports = ProtocolLink;

/**
 * Abstract base class for links which require a protocol to establish
 * a link.  The protocol is based on a simple 3-step process:
 * - greetings - broadcast existence
 * - hi - reply to greetings
 * - ready - can start receiving data
 * @augments Link
 * @param instanceId - unique identifier for the endpoint.js instance
 * @param linkId - unique identifier for this link
 * @param {Object} settings
 * @constructor
 */
function ProtocolLink(instanceId, linkId, settings) {
    if (!(this instanceof ProtocolLink)) { return new ProtocolLink(instanceId, linkId, settings); }

    this._instanceId = instanceId;

    Link.call(this, linkId, settings);

    // Allow 15 seconds for hosts to establish a stream
    this._handshakes = expHash(15, 'Protocol link: ' + linkId);
    this._handshakes.on('expired', function(key, value) {
        log.log(log.WARN, 'Host exchange expired');
        value.closeFn();
    });

    // List of streamInfo, indexed by uuid.
    this._streams = {};
}

/**
 * In response to a greetings message, allocate a link
 * stream for this sender
 * @param fromUuid
 * @param [metadata]
 * @private
 */
ProtocolLink.prototype._handleGreeting = function(msg, edgeId, instanceId) {

    // This is the host we will report to our upper level/layer if this
    // is an external connection. We also use this as the 'sender' in
    // future messages
    var streamId = uuid();
    instanceId = instanceId || msg.s;
    edgeId = edgeId || uuid();

    // Ensure the values are valid.
    if (!appUtils.isUuid(instanceId) || !appUtils.isUuid(edgeId)) {
        throw new Error('Invalid instance or edge id');
    }

    // Destination information for the initial greeting
    var inject = {
        d: msg.s, // send initial replies to opposite greetings id.
        s: streamId
    };

    // Create the sender for this destination, as well as
    // the client side user stream.
    // Use a unique value for edgeId in case we have to
    // re-establish this link in the future (prevent collisions)
    var streamInfo = {
        streamId: streamId,
        instanceId: instanceId || msg.s,
        edgeId: this.isExternal() ? edgeId : instanceId,
        ready: false,
        readTransport: through2.obj(),
        sendTransport: this._createInjectStream(inject, msg),
        closeFn: endFunc
    };

    // When the stream ends, remove it
    var ended = false;
    var _this = this;
    function endFunc() {
        if (!ended) {
            log.log(log.DEBUG, 'Lost connection: [Link Type: %s] [Link ID: %s] [Edge ID: %s] [From: %s]',
                _this.getType(),
                _this.getId(),
                streamInfo.edgeId,
                streamInfo.instanceId);

            // Do not re-execute this code.
            ended = true;

            // Make sure both streams are ended
            streamInfo.readTransport.push(null);
            streamInfo.readTransport.end();

            // Remove from the cache (if it's there)
            if (streamInfo.ready) {
                delete _this._streams[streamId];
                // Tell anyone listening
                _this.emit('connection-close', _this, streamInfo.edgeId);
            }
            else {
                _this._handshakes.remove(streamId);
                // Need to force end the sendTransport, since link stream hasn't
                // been created yet, meaning it won't propagate the close.
                streamInfo.sendTransport.push(null);
                streamInfo.sendTransport.end();
            }
        }
    }

    streamInfo.sendTransport.on('finish', endFunc);
    streamInfo.sendTransport.on('end', endFunc);

    // Save the data for later
    this._handshakes.add(streamId, streamInfo);

    log.log(log.DEBUG, 'New connection: [Link Type: %s] [Link ID: %s] [Edge ID: %s] [From: %s]',
        this.getType(),
        this.getId(),
        streamInfo.edgeId,
        streamInfo.instanceId);

    return streamInfo;
};

/**
 * When a sender disconnects, then kill his link stream
 * @param destinationUuid
 * @param [metadata]
 * @private
 */
ProtocolLink.prototype._handleGoodbye = function(msg) {
    var streamInfo = this._streams[msg.d];
    if (streamInfo) {
        // This will trigger the link close.
        streamInfo.readTransport.push(null);
        streamInfo.readTransport.end();
    }
};

/**
 * Creates a writer that can send protocol messages via the 'sendProtocolCommand'
 * and sends the message
 * @param command
 * @param [message]
 * @returns {Error}
 * @private
 */
ProtocolLink.prototype._sendProtocolCommand = function(toUuid, command, message) {
    var streamInfo = this._streams[toUuid] || this._handshakes.get(toUuid);
    if (streamInfo) {
        this._sendProtocolCommandTo(streamInfo.sendTransport, command, message);
    }
};

/**
 * Send a protocol command to a specific host (transport)
 * @param transport
 * @param command
 * @param message
 * @private
 */
ProtocolLink.prototype._sendProtocolCommandTo = function(transport, command, message) {
    transport.write({
        p: command,
        m: message
    });
};

/**
 * This function will create a writer stream to the given destination
 */
ProtocolLink.prototype._createInjectStream = function(inject, metadata) {
    // Add the destination, only if the 'p' protocol flag isn't
    // set.
    var writeStream = through2.obj(
        function(chunk, encoding, cb) {
            for (var prop in inject) {
                chunk[prop] = inject[prop];
            }
            this.push(chunk);
            cb();
        });
    writeStream.updateInject = function(data) {
        inject = data;
    };

    // Pipe the write stream through a sender stream
    writeStream.pipe(this._createSenderStream(metadata));
    return writeStream;
};

/**
 * Happens as soon as the destination has created its buffer streams
 * and is ready for me to start sending messages
 * @param msg
 * @private
 */
ProtocolLink.prototype._handleReady = function(msg, hisInstanceId) {

    var streamId = msg.d;

    var streamInfo = this._handshakes.get(streamId);
    if (streamInfo && !streamInfo.ready) {

        // Update his instance id if he specified it
        if (hisInstanceId) {
            // Ensure the values are valid.
            if (!appUtils.isUuid(hisInstanceId)) {
                throw new Error('Invalid instance id');
            }
            streamInfo.instanceId = hisInstanceId;
        }

        // Address messages the way he wants them.
        streamInfo.sendTransport.updateInject({
            d: msg.s
        });

        streamInfo.ready = true;

        // Move the stream to this._streams
        this._streams[streamInfo.streamId] = streamInfo;
        this._handshakes.remove(streamInfo.streamId);

        // Tell listeners
        this.emit('connection',
            this,
            streamInfo.edgeId,
            {
                read: streamInfo.readTransport,
                write: streamInfo.sendTransport
            },
            streamInfo.instanceId);

        return true;
    }

    return false;
};

/**
 * This is a message chunk from an external source (fromUuid)
 * directed at me
 * @param fromUuid
 * @param message
 * @private
 */
ProtocolLink.prototype._handleReader = function(reader) {

    var assignedReaders = {};

    // This will keep track of this messenger locally in this closure, so
    // that if the reader transport fails, we can kill all the dependent
    // streams
    var registerReader = function(streamId) {
        if (!assignedReaders[streamId]) {
            assignedReaders[streamId] = this._streams[streamId].readTransport;
            assignedReaders[streamId].once('end', function() {
                delete assignedReaders[streamId];
            });
        }
    }.bind(this);

    var handle = function() {
        var msg;
        while ((msg = reader.read()) !== null) {

            if (!msg || !msg.d) {
                continue;
            }

            try {

                var streamInfo;
                if (msg.p) {
                    // Respond to protocol events.  Mostly from hello's and goodbyes.
                    switch (msg.p) {
                        case 'greetings':
                            if (msg.d == 'broadcast') {

                                // Make sure it's not from myself.  IE bug!
                                if (msg.s != this._instanceId) {

                                    // Message sent that says 'Hi, I'm new here!'
                                    streamInfo = this._handleGreeting(msg);

                                    // Reply to destination that we're here.
                                    this._sendProtocolCommand(streamInfo.streamId, 'hi',
                                        {
                                            i: this._instanceId,
                                            e: streamInfo.edgeId
                                        });
                                }
                            }
                            break;

                        case 'hi':
                            if (msg.d == this._instanceId && msg.m) {
                                // Message sent that says 'Hi, I'm new here!'
                                streamInfo = this._handleGreeting(msg, msg.m.e, msg.m.i);

                                // Reply to destination that we're ready.
                                this._sendProtocolCommand(streamInfo.streamId, 'ready');

                                // Seamlessly transition our destination id to the
                                // newly generated id.
                                msg.d = streamInfo.streamId;

                                // Create streams for the destination
                                this._handleReady(msg, msg.m.i);
                                registerReader(msg.d);
                            }
                            break;

                        case 'ready':
                            if (this._handleReady(msg)) {
                                registerReader(msg.d);
                            }
                            break;

                        case 'goodbye':
                            // Message sent that says 'Goodbye, I'm leaving!'
                            this._handleGoodbye(msg);
                            break;
                    }
                }
                else {
                    // Not a protocol message, send to the next layer.
                    streamInfo = this._streams[msg.d];
                    if (streamInfo) {
                        streamInfo.readTransport.push(msg);
                    }
                }
            }
            catch (e) {
                log.log(log.ERROR, 'Exception reading: %s', e.stack);
            }
        }
    }.bind(this);

    var terminate = function() {
        reader.removeListener('readable', handle);
        for (var streamId in assignedReaders) {
            assignedReaders[streamId].push(null);
        }
        assignedReaders = {};
    }.bind(this);

    reader.once('end', terminate);
    reader.on('readable', handle);
};

/**
 * Send the protocol message to the given destination
 * @param metadata
 * @private
 */
ProtocolLink.prototype._announce = function(metadata) {
    var inject = {
        d: 'broadcast',
        s: this._instanceId
    };
    var writeStream = this._createInjectStream(inject, metadata);
    this._sendProtocolCommandTo(writeStream, 'greetings');
    writeStream.end();
};

/**
 * Will manually create a 'send' transport stream for the specific destination
 * @param destinationUuid
 * @param [metadata]
 * @returns {*}
 * @private
 */
ProtocolLink.prototype._createSenderStream = function(metadata) {
    return new Error('not implemented');
};

/**
 * Close the specific stream key.
 * @param streamKey
 */
ProtocolLink.prototype.closeLink = function(streamKey) {
    // This will trigger the close of this stream
    var streamInfo = this._streams[streamKey];
    if (streamInfo) {
        this._sendProtocolCommandTo(streamInfo.sendTransport, 'goodbye');
        streamInfo.closeFn();
    }
};

/**
 * Close all open streams
 */
ProtocolLink.prototype.close = function() {

    // Close all streams
    var streamKeys = Object.keys(this._streams);
    streamKeys.forEach(function(streamKey) {
        this.closeLink(streamKey);
    }, this);

    // Tell parent
    Link.prototype.close.call(this);
};

}).call(this,"/js\\app\\link\\protocol-link.js")
},{"../util/appUtils":54,"../util/expirable-hash":56,"./link":29,"node-uuid":69,"through2":89,"util":92}],31:[function(require,module,exports){
(function (__filename){
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

var ProtocolLink = require('./protocol-link'),
    inherits = require('util').inherits,
    socketio = require('../transport/socketio'),
    through2 = require('through2'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(ServerLink, ProtocolLink);

module.exports = ServerLink;

/**
 * This link class handles connections for socket.io.  It will detect
 * whether it is in the browser or not and then add the appropriate link.
 * @augments ProtocolLink
 * @param {String} instanceId - unique identifier for this endpoint.js instance
 * @param {String} linkId - unique identifier for this link instance
 * @param {Object} settings
 * @param {String} settings.channel - the specific socket.io key to use for message transfer
 * @param {Boolean} settings.external - whether we trust this link (trust their routing table)
 * @param {Number} settings.maxClients - the maximum amount of clients we allow on this link
 * @constructor
 */
function ServerLink(instanceId, linkId, settings) {
    if (!(this instanceof ServerLink)) { return new ServerLink(instanceId, linkId, settings); }

    this._channel = settings.channel || 'local-channel';
    this._external = settings.hasOwnProperty('external') ? settings.external : true;
    this._maxClients = settings.hasOwnProperty('maxClients') ? settings.maxClients : 250;

    // Listening to the connect event from these sockets.
    this._listeners = [];

    // Total amount of clients connected currently
    this._currentClients = 0;

    // For handling new connections
    this._connectEventPtr = this._onConnect.bind(this);

    // Call the parent constructor.
    ProtocolLink.call(this, instanceId, linkId, settings);

    log.log(log.DEBUG2, 'Server Link initialized: [Settings: %j]', settings);
}

/**
 * If true, routing information from this host should be treated as
 * 'external', meaning it cannot affect the internal routing table
 */
ServerLink.prototype.isExternal = function() {
    return this._external;
};

/**
 * Adds a worker to the worker link (expects it to use Endpoint.js!)
 * @param worker
 */
ServerLink.prototype.addSocket = function(socket, isHub) {

    if (isHub) {

        // If we're a hub, then listen for the on-connect
        socket.on('connection', this._connectEventPtr);
        this._listeners.push(socket);

    }
    else {

        var _this = this;
        socket.on('connect', function() {
            var stream = _this._onConnect(socket);
            // Announce ourselves to the newly connected stream
            _this.announceSocket(stream);
        });
    }
};

/**
 * When a client connects to this hub, give the socket
 * here
 * @param event
 * @private
 */
ServerLink.prototype._onConnect = function(socket) {

    // Subscribe to data events from the socket.
    var transportStream = socketio({
        channel: this._channel,
        target: socket
    });

    if (this._currentClients >= this._maxClients) {
        log.log(log.WARN, 'Max clients connected. Closing new connection');
        transportStream.close();
        return;
    }

    // When the connection closes, then decrement current clients
    var _this = this;
    transportStream.on('finish', function() {
        _this._currentClients -= 1;
    });

    var readStream = through2.obj(function(chunk, encoding, cb) {
        chunk.stream = transportStream;
        this.push(chunk);
        cb();
    });

    transportStream.pipe(readStream);

    // Start reading messages
    this._handleReader(readStream);

    // Total clients connected
    this._currentClients += 1;

    return transportStream;
};

/**
 * Will manually create a 'send' transport stream for the specific destination
 * @param [metadata]
 * @returns {*}
 * @private
 */
ServerLink.prototype._createSenderStream = function(metadata) {
    var str = through2.obj();
    // Announce uses a quick sender stream and destroys it, so we don't want it
    // to kill the reader stream.  However, if the sender stream is killed, we
    // want it to propagate down to the transport stream, so it can kill
    // the reader stream.
    str.pipe(metadata.stream, metadata.announce ? { end: false } : undefined);
    return str;
};

/**
 * Manually announce to the given socket.
 * @param socket
 */
ServerLink.prototype.announceSocket = function(stream) {
    this._announce({stream:stream, announce: true});
};

/**
 * The cost to transmit to this link.  For tabs, since it uses
 * localstorage, we want to not use this as much as possible.
 * @returns {number}
 */
ServerLink.prototype.getCost = function() {
    return 100;
};

/**
 * Returns the type of link this is
 * @returns {string}
 */
ServerLink.prototype.getType = function() {
    return 'server';
};

/**
 * Remove event listeners, close streams
 */
ServerLink.prototype.close = function() {

    // Remove connect event listener for new ports
    if (this._listeners.length > 0) {
        this._listeners.forEach(function(listener) {
            listener.removeListener('connection', this._connectEventPtr);
        }, this);
        this._listeners = [];
    }

    // Close any streams (this will send goodbyes)
    ProtocolLink.prototype.close.call(this);
};

}).call(this,"/js\\app\\link\\server.js")
},{"../transport/socketio":53,"../util/appUtils":54,"./protocol-link":30,"through2":89,"util":92}],32:[function(require,module,exports){
(function (__filename){
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

var ProtocolLink = require('./protocol-link'),
    inherits = require('util').inherits,
    stringifyStream = require('../streams/stringify-stream'),
    localStorage = require('../transport/localstorage'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    through2 = require('through2');

inherits(TabLink, ProtocolLink);

module.exports = TabLink;

/**
 * This link class handles connections for localstorage on a specific
 * channel within the browser.
 * @augments ProtocolLink
 * @param {String} instanceId - unique identifier for this endpoint.js instance
 * @param {String} linkId - unique identifier for this link instance
 * @param {Object} settings
 * @param {String} settings.channel - the specific localstorage key to use for message transfer
 * @constructor
 */
function TabLink(instanceId, linkId, settings) {
    if (!(this instanceof TabLink)) { return new TabLink(instanceId, linkId, settings); }

    this._channel = settings.channel || 'local-channel';

    // Call the parent constructor.
    ProtocolLink.call(this, instanceId, linkId, settings);

    // Create our transport
    this._transportStream = localStorage({
        channel: this._channel
    });

    // Parse it, and decode it
    this._readStream = this._transportStream
        .pipe(stringifyStream.decode(true))
        .pipe(this._createDecodeStream());

    // Encode it
    this._writeStream = this._createEncodeStream();
    this._writeStream
        .pipe(stringifyStream.encode(true))
        .pipe(this._transportStream);

    // Tell our parent about it.
    this._handleReader(this._readStream);

    // Tell everyone we're here!
    this._announce();

    log.log(log.DEBUG2, 'Tab Link initialized: [Settings: %j]', settings);
}

/**
 * This function will ensure that the source and counter
 * values in the stream are not the exact same as the ones
 * from the previous message (via the protocol-link
 * metadata)
 * @private
 */
TabLink.prototype._createDecodeStream = function() {
    var lastCtr = null;
    var lastSource = null;
    return through2.obj(function(chunk, encoding, cb) {
        // Skip messages that have the same
        // counter variable.
        if (lastCtr === chunk.c &&
            lastSource === chunk.s) {
            cb();
        }
        else {
            lastCtr = chunk.c;
            lastSource = chunk.s;
            this.push(chunk);
            cb();
        }
    });
};

/**
 * This function will place a counter into the protocol-link
 * metadata.  Localstorage on some browsers fires the event
 * twice.. I don't think this applies since we're not trying
 * to support IE, but just in-case we refactor for support
 * in the future...
 * @private
 */
TabLink.prototype._createEncodeStream = function() {
    var ctr = 1;
    return through2.obj(function(chunk, encoding, cb) {
        chunk.c = ctr++;
        if (ctr > 65536) {
            ctr = 1;
        }
        this.push(chunk);
        cb();
    });
};

/**
 * Will manually create a 'send' transport stream for the specific destination
 * @param [metadata]
 * @returns {*}
 * @private
 */
TabLink.prototype._createSenderStream = function(metadata) {
    var str = through2.obj();
    str.pipe(this._writeStream, { end: false });
    return str;
};

/**
 * The cost to transmit to this link.  For tabs, since it uses
 * localstorage, we want to not use this as much as possible.
 * @returns {number}
 */
TabLink.prototype.getCost = function() {
    return 10;
};

/**
 * Returns the type of link this is
 * @returns {string}
 */
TabLink.prototype.getType = function() {
    return 'tab';
};

/**
 * Remove event listeners, close streams
 */
TabLink.prototype.close = function() {

    // Close any streams (this will send goodbyes)
    ProtocolLink.prototype.close.call(this);

    // Close the local storage transport
    this._transportStream.close();
};

}).call(this,"/js\\app\\link\\tab.js")
},{"../streams/stringify-stream":45,"../transport/localstorage":50,"../util/appUtils":54,"./protocol-link":30,"through2":89,"util":92}],33:[function(require,module,exports){
(function (__filename){
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

var ProtocolLink = require('./protocol-link'),
    inherits = require('util').inherits,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    through2 = require('through2'),
    stringifyStream = require('../streams/stringify-stream'),
    readTransport = require('../transport/postmessage-reader'),
    sendTransport = require('../transport/postmessage-sender');

inherits(WindowLink, ProtocolLink);

module.exports = WindowLink;

/**
 * Window Link handles commnication between parent/child windows,
 * or parent/child iframes.
 * @augments ProtocolLink
 * @param {String} instanceId - unique identifier for this endpoint.js instance
 * @param {String} linkId - unique identifier for this link instance
 * @param {Object} settings
 * @param {String} settings.origin - the origin of this window, only read+write to this origin
 * @param {Boolean} settings.external - whether we trust this link (trust their routing table)
 * @constructor
 */
function WindowLink(instanceId, linkId, settings) {
    if (!(this instanceof WindowLink)) { return new WindowLink(instanceId, linkId, settings); }

    this._origin = settings.origin;
    this._external = settings.hasOwnProperty('external') ? settings.external : true;

    // Call parent constructor
    ProtocolLink.call(this, instanceId, linkId, settings);

    // Create our transport
    this._transportStream = readTransport({
        target: appUtils.getGlobalObject(),
        origin: this._origin,
        checkOrigin: true,
        preserveSource: true
    });

    // Parse it, and decode it
    this._readStream = this._transportStream
        .pipe(through2.obj(function(chunk, encoding, cb) {
            // This is a special workaround, because the object might have additional
            // values, such as 'source' and 'origin', since we're using preserveSource.
            // So we just use the decode function directly instead of piping it
            // through the stringify decode stream.
            chunk.msg = stringifyStream.decodeFunction(true, chunk.msg);
            this.push(chunk);
            cb();
        }))
        .pipe(this._createDecodeStream());

    // Tell our parent about it.
    this._handleReader(this._readStream);

    log.log(log.DEBUG2, 'Window Link initialized: [Settings: %j]', settings);
}

/**
 * If true, routing information from this host should be treated as
 * 'external', meaning it cannot affect the internal routing table
 */
WindowLink.prototype.isExternal = function() {
    return this._external;
};

/**
 * Preserve the source information from the input stream
 * @private
 */
WindowLink.prototype._createDecodeStream = function() {
    return through2.obj(function(chunk, encoding, cb) {
        var newMsg = chunk.msg;
        newMsg.source = chunk.source;
        newMsg.origin = chunk.origin;
        this.push(newMsg);
        cb();
    });
};

/**
 * Will manually create a 'send' transport stream for the specific destination
 * @param destinationUuid
 * @param [metadata]
 * @returns {*}
 * @private
 */
WindowLink.prototype._createSenderStream = function(metadata) {
    var sender = sendTransport({
        target: metadata.source,
        origin: this._origin,
        sendOrigin: true
    });

    var encoder = stringifyStream.encode(true);
    encoder.pipe(sender);

    return encoder;
};

/**
 * Manually announce to the given window.
 * @param obj
 */
WindowLink.prototype.announceWindow = function(obj) {
    this._announce({ source: obj });
};

/**
 * The cost to transmit to this link.  For window, use this
 * if we have more than a few hops to a worker.
 * @returns {number}
 */
WindowLink.prototype.getCost = function() {
    return 1;
};

/**
 * Override parent type function
 * @returns {string}
 */
WindowLink.prototype.getType = function() {
    return 'window';
};

/**
 * Remove event listeners, close streams
 */
WindowLink.prototype.close = function() {

    // Close any streams (this will send goodbyes)
    ProtocolLink.prototype.close.call(this);

    // Close the post message transport
    this._transportStream.close();
};

}).call(this,"/js\\app\\link\\window.js")
},{"../streams/stringify-stream":45,"../transport/postmessage-reader":51,"../transport/postmessage-sender":52,"../util/appUtils":54,"./protocol-link":30,"through2":89,"util":92}],34:[function(require,module,exports){
(function (__filename){
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

var ProtocolLink = require('./protocol-link'),
    inherits = require('util').inherits,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    through2 = require('through2'),
    stringifyStream = require('../streams/stringify-stream'),
    readTransport = require('../transport/postmessage-reader'),
    sendTransport = require('../transport/postmessage-sender');

inherits(WorkerLink, ProtocolLink);

module.exports = WorkerLink;

/**
 * A Shared worker accepts connections from multiple sources, while
 * a normal worker is only one source.
 * @todo There is not currently a way to determine if a port
 * closes (no event), so we rely on the protocol events
 * and heartbeat.
 * @augments ProtocolLink
 * @param {String} instanceId - unique identifier for this endpoint.js instance
 * @param {String} linkId - unique identifier for this link instance
 * @param {Object} settings - settings for the link.  There are none currently
 * @constructor
 */
function WorkerLink(instanceId, linkId, settings) {
    if (!(this instanceof WorkerLink)) { return new WorkerLink(instanceId, linkId, settings); }

    // There can only be one hub (if we're a worker).  So if someone adds
    // a worker that is a hub, then set it here.
    this._workerHub = null;

    // Call parent
    ProtocolLink.call(this, instanceId, linkId, settings);

    log.log(log.DEBUG2, 'Worker Link initialized: [Settings: %j]', settings);
}

/**
 * Adds a worker to the worker link (expects it to use Endpoint.js!)
 * @param worker
 */
WorkerLink.prototype.addWorker = function(worker) {
    var port = this.addHub(worker);
    this.announceWorker(port);
};

/**
 * Used with dedicated workers and shared workers to create
 * instances that can be connected/announced to.
 * @param hub
 */
WorkerLink.prototype.addHub = function(worker) {

    // Account for shared workers
    if ('port' in worker) {
        worker = worker.port;
    }

    // Determine if we're a shared worker.
    if ('onconnect' in worker) {

        if (this._workerHub !== null) {
            var msg = 'Already assigned a worker hub';
            log.log(log.ERROR, msg);
            throw new Error(msg);
        }

        // Save so we can remove the event listener on close.
        this._workerHub = worker;

        // Add an event listener for new connections (assuming this is a shared worker)
        this._connectEventPtr = this._onConnect.bind(this);
        appUtils.addEventListener(worker, 'connect', this._connectEventPtr, false);

        log.log(log.DEBUG2, 'Worker scope detected, using hub mode');
        return null;
    }
    else {
        // Immediately add this worker
        var event = {
            ports: [worker]
        };
        var port = this._onConnect(event);

        log.log(log.DEBUG2, 'Using worker client mode');
        return port;
    }
};

/**
 * When a client connects to a shared worker, the port will
 * be given here.
 * @param event
 * @private
 */
WorkerLink.prototype._onConnect = function(event) {
    var port = event.ports[0];

    // Create our transport
    var transportStream = readTransport({
        target: port,
        checkOrigin: false
    });

    // Metadata for creating sender streams
    var meta = {
        port: port,
        cleanUp: cleanUp
    };

    // This stream will add the port to the
    // stream metadata.
    var readStream = through2.obj(function(chunk, encoding, cb) {
        chunk.meta = meta;
        this.push(chunk);
        cb();
    });

    transportStream
        .pipe(stringifyStream.decode(true))
        .pipe(readStream);

    // Tell our parent about it.
    this._handleReader(readStream);

    // If the port/worker is startable, then start it
    if ('start' in port) {
        port.start();
    }

    // Attach a function to the worker, so that if the link is closed, we can cleanup memory
    // resources
    function cleanUp() {
        transportStream.close();
    }

    return port;
};

/**
 * Will manually create a 'send' transport stream for the specific destination
 * @param destinationUuid
 * @param [metadata]
 * @returns {*}
 * @private
 */
WorkerLink.prototype._createSenderStream = function(metadata) {

    var sender = sendTransport({
        target: metadata.meta.port,
        sendOrigin: false
    });

    var encoder = stringifyStream.encode(true);
    encoder.pipe(sender);

    encoder.on('finish', function() {
        if (metadata.meta.cleanUp) {
            metadata.meta.cleanUp();
        }
    });

    return encoder;
};

/**
 * The cost to transmit to this link.  Worker is
 * the most efficient link type.
 * @returns {number}
 */
WorkerLink.prototype.getCost = function() {
    return 1.1;
};

/**
 * Return the type of this link.
 * @returns {string}
 */
WorkerLink.prototype.getType = function() {
    return 'worker';
};

/**
 * Manually announce to the given worker.
 * @param obj
 */
WorkerLink.prototype.announceWorker = function(port) {
    this._announce({
        meta: {
            port: port
        }
    });
};

/**
 * Remove event listeners, close streams
 */
WorkerLink.prototype.close = function() {

    // Remove connect event listener for new ports
    if (this._workerHub) {
        appUtils.removeEventListener(this._workerHub, 'connect', this._connectEventPtr, false);
    }

    // Close any streams (this will send goodbyes)
    ProtocolLink.prototype.close.call(this);
};

}).call(this,"/js\\app\\link\\worker.js")
},{"../streams/stringify-stream":45,"../transport/postmessage-reader":51,"../transport/postmessage-sender":52,"../util/appUtils":54,"./protocol-link":30,"through2":89,"util":92}],35:[function(require,module,exports){
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

/* globals __filename */
/* jshint -W097 */
'use strict';

var switchBoard = require('./switching/switch-board'),
    router = require('./routing/router'),
    path = require('./routing/path-vector'),
    affinity = require('./routing/host-affinity'),
    bus = require('./endpoint/bus'),
    streamer = require('./endpoint/streamer'),
    messenger = require('./endpoint/messenger'),
    endpointManager = require('./endpoint/endpoint-manager'),
    api = require('./api/api');

module.exports = Loader;

/**
 * Loader will construct an Endpoint.js instance without
 * any configured links.
 * @module Loader
 */
function Loader(linkDirectory, config) {

    // Initialize the switchboard
    var switchBoardInstance = switchBoard(linkDirectory, config);

    // Create the router handler
    var routerInstance = router(switchBoardInstance, config);

    // Create the path vector handler, which will route packets along a defined
    // path
    var pathInstance = path(routerInstance, config);

    // Create the bus handler, which will establish and create a path using
    // controlled flooding
    var busInstance = bus(routerInstance, config);

    // Create the bridge handler, which will route packets along a stateful, chained
    // path from one host to another
    var affinityInstance = affinity(routerInstance, config);

    // Create the messenger handler, which will send messages along a bridge, or
    // a path if the bridge doesn't exist
    var messengerInstance = messenger(pathInstance, routerInstance, config);

    // Create the streaming handler, which will send messages along a bridge, or
    // a path if the bridge doesn't exist
    var streamerInstance = streamer(pathInstance, routerInstance, config);

    // Aggregate the items
    var services = {
        switchboard: switchBoardInstance,
        router: routerInstance,
        path: pathInstance,
        bus: busInstance,
        hostaffinity: affinityInstance,
        messenger: messengerInstance,
        streamer: streamerInstance
    };

    // Create the endpoint manager, which manages the endpoints
    var managerInstance = endpointManager(config, services);

    // Initialize the API layer
    var apiInstance = api(managerInstance, config);

    return apiInstance;
}

},{"./api/api":6,"./endpoint/bus":24,"./endpoint/endpoint-manager":25,"./endpoint/messenger":27,"./endpoint/streamer":28,"./routing/host-affinity":37,"./routing/path-vector":38,"./routing/router":39,"./switching/switch-board":48}],36:[function(require,module,exports){
(function (__filename){
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

var isArray = require('util').isArray,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

module.exports = Address;

/**
 * A remote address tells Endpoint.js how to route a packet to a given remote
 * endpoint.js instance.  When a message is sent to an external host, the path vector will
 * be like so: [host1, host2, host3], where successive hosts are appended.  This needs to
 * be reversed before messages can be sent to an external: [host3, host2, host1].
 * To save for performance, we don't reverse the vector until it's needed.
 * @param pathVector - array of boundary routers defining the path to the remote instance
 * @param reversed - whether the vector has been reversed already
 * @constructor
 */
function Address(pathVector, reversed) {
    if (!(this instanceof Address)) { return new Address(pathVector, reversed); }
    if (!pathVector) {
        this._pathVector = [];
    }
    else if (isArray(pathVector)) {
        this._pathVector = pathVector.slice(0);
    }
    else {
        this._pathVector = [pathVector.toString()];
    }
    this._reversed = !!reversed;
}

/**
 * A representation of the path vector as a string.
 */
Address.prototype.toString = function() {
    return this.getPathVector().join('.');
};

/**
 * Return the identifier, which identifies how to get to the local network.
 */
Address.prototype.getPathVector = function() {
    if (!this._reversed) {
        this._pathVector = this._pathVector.reverse();
        this._reversed = true;
    }
    return this._pathVector.slice(0);
};

/**
 * Create a new address that routes through the given route.  The
 * assumption is that this route ends at the same place the
 * next one begins.  This function will attempt to find a way
 * to reduce the path to the given host by using common instances
 * along the way.
 * @param {Address} address
 */
Address.prototype.routeThrough = function(address) {
    if (!this.isValid()) {
        throw new Error('invalid address');
    }
    var thisVector = this.getPathVector();
    var thatVector = address.getPathVector();
    if (thisVector[thisVector.length - 1] !== thatVector[0]) {
        var msg = 'While merging two addresses, end of first must be beginning of second';
        log.log(log.ERROR, msg);
        throw new Error(msg);
    }
    else {
        // Nominal:
        // Route 1: A -> B -> C -> D
        // Route 2: D -> C -> E -> F
        // Route New: A -> B -> C -> E -> F

        // External:
        // Route 1: A -> B -> edge-ext -> C -> D
        // Route 2: D -> C -> edge-ext -> E -> F
        // Route New: A -> B -> E -> F (skip edge-ext)

        // Create intermediate structure to map what index each item occurs at
        var thatHash = {};
        for (var i = 0; i < thatVector.length; i++) {
            thatHash[thatVector[i]] = i;
        }

        var smallestScore = null;
        var smallestThisIndex = null;
        var smallestThatIndex = null;

        for (var thisIndex = 0; thisIndex < thisVector.length; thisIndex++) {
            var thatIndex = thatHash[thisVector[thisIndex]];
            if (thatIndex !== undefined) {
                var score = thisIndex + thatIndex;
                if (smallestThisIndex === null || score < smallestScore) {
                    smallestThisIndex = thisIndex;
                    smallestThatIndex = thatIndex;
                }
            }
        }

        // If the item at the smallest index is an external edge, then skip that.
        if (appUtils.isExtUuid(thatVector[smallestThatIndex])) {
            smallestThatIndex += 1;
        }

        // Create a new array:
        // thisVector: 0->smallestThisIndex
        // thatVector: (smallestThatIndex -> end).reverse()
        var newVector = thisVector.slice(0, smallestThisIndex)
            .concat(thatVector.slice(smallestThatIndex));

        return new Address(newVector, true);
    }
};

/**
 * This function protects us by ensuring that we do not allow affinity under the following
 * circumstances:
 * - loops or node revisits
 * - invalid uuid (neither a uuid or an -ext address)
 * - max hops
 * @param address
 * @private
 */
Address.prototype.isValid = function(maxHops) {
    var vector = this.getPathVector();
    if (typeof (maxHops) != 'undefined' && vector.length > maxHops) {
        log.log(log.WARN, 'max hops violation: %s', this);
        return false;
    }
    var hash = {};
    for (var i = 0; i < vector.length; i++) {
        if (!(appUtils.isUuid(vector[i]) || (appUtils.isExtUuid(vector[i])))) {
            log.log(log.WARN, 'uuid violation: %s', this);
            return false;
        }
        if (hash[vector[i]]) {
            log.log(log.WARN, 'loop violation: %s', this);
            return false;
        }
        hash[vector[i]] = true;
    }
    return true;
};

}).call(this,"/js\\app\\routing\\address.js")
},{"../util/appUtils":54,"util":92}],37:[function(require,module,exports){
(function (__filename){
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
    isArray = require('util').isArray,
    addressTool = require('./address'),
    uuid = require('node-uuid'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(HostAffinity, EventEmitter);

module.exports = HostAffinity;

/**
 * HostAffinity will establish a relationship between a chain of nodes.  If
 * any node in the chain goes down, then the subsequent nodes in the chain
 * will be notified of the break.
 * @augments EventEmitter
 * @fires HostAffinity#affinity-add (affinityId)
 * @fires HostAffinity#affinity-remove (affinityId)
 * @fires HostAffinity#affinity-error (affinityId)
 * @param {Router} routerInstance - an instance of the Router class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function HostAffinity(routerInstance, config) {
    if (!(this instanceof HostAffinity)) { return new HostAffinity(routerInstance, config); }

    // Call parent constructor
    EventEmitter.call(this);
    this.setMaxListeners(0);

    this._id = config.get('instanceId');
    this._maxHostAffinities = config.get('maxHostAffinities');
    this._maxHops = config.get('maxHops');

    // These are affinities that have been requested via add/add-ack
    this._trackedHosts = {};

    // These are local affinities that were initiated in our Endpoint.js instance.
    this._localAffinities = {};

    // Register with the router to track HostAffinity packets
    // NOTE: There might be an issue here.  If a link switches (link-switch), then
    // it could be that the remote link detected the link was dead, and killed affinity,
    // thereby re-connecting.  Our side will not detect this however, meaning the remote
    // instance/facade might be dead but we won't know on this side ...
    this._routerInstance = routerInstance;
    this._routerInstance.addHandler('affinity');
    this._routerInstance.on('route-unavailable', this._handleRouteLost.bind(this));
    this._routerInstance.on('affinity', this._handleAffinityPacket.bind(this));
}

/**
 * This function is used to establish host affinities
 * @param packet
 * @param fromUuid
 * @private
 */
HostAffinity.prototype._handleAffinityPacket = function(packet, fromUuid) {

    var fromRoute = this._routerInstance.getRoute(fromUuid);
    if (!fromRoute) {
        return;
    }
    // If this is an internal route, then trust the 'from' parameter.  This
    // is because the packet could be coming from another border node, not
    // an adjacent node.
    if (!fromRoute.external) {
        fromUuid = packet.from;
    }

    switch (packet.type) {
        case 'add':
            this._handleAdd(packet, fromUuid);
            break;
        case 'remove':
            this._handleRemove(packet, fromUuid);
            break;
        case 'error':
            this._handleError(packet, fromUuid);
            break;
    }
};

/**
 * This function is called when a request to add a tracked affinity id occurs.
 * It expects one affinity id in the 'packet.id' field, which is NOT an array.
 * @param packet - the originating protocol packet
 * @param fromUuid - who sent us the protocol packet
 * @private
 */
HostAffinity.prototype._handleAdd = function(packet, fromUuid) {
    if (!packet.id || !isArray(packet.path) || !appUtils.isUuid(packet.id)) {
        return;
    }

    // Valid?
    var address = addressTool(packet.path, true);
    if (!address.isValid(this._maxHops)) {
        return;
    }

    // Determine who we're going to send the affinity record to.  It will
    // be the next record in the path.
    var toPath = address.getPathVector();

    // Remove any additional references to me due to path-vector algorithm
    var toUuid = this._id;
    while (toUuid == this._id && toPath.length > 0) {
        toUuid = toPath[0];
        toPath.shift();
    }

    if (toUuid == this._id) {
        toUuid = 'local';
    }

    var addedFrom, addedTo;

    // Add tracked record for 'from' as long as from is not local
    addedFrom = this._addTrackedRecord(fromUuid, toUuid, packet.id, true);

    // Add tracked record for 'to' as long as to is not local, and as long as we know about
    // the host we're sending to.
    if (addedFrom) {
        if (toUuid == 'local' || this._routerInstance.getRoute(toUuid)) {
            addedTo = this._addTrackedRecord(toUuid, fromUuid, packet.id, false);
        }
    }

    if (!addedFrom || !addedTo) {
        if (addedFrom) {
            // Cleanup and send error or forward to next host.
            this._removeTrackedRecord(fromUuid, packet.id);
        }
        // Reply with error.
        this._sendProtocolMessage(fromUuid, 'error', packet.id, 'local');
    }
    else {
        this._sendProtocolMessage(toUuid, 'add', packet.id, fromUuid, toPath);
    }
};

/**
 * This function is called when a request to remove a tracked affinity id occurs.
 * @param packet - the originating protocol packet
 * @param fromUuid - who sent us the protocol packet
 * @private
 */
HostAffinity.prototype._handleRemove = function(packet, fromUuid) {
    if (!isArray(packet.id)) {
        return;
    }
    var notificationHosts = {};
    packet.id.forEach(function(affinityId) {
        var concernedHost = this._removeTrackedRecord(fromUuid, affinityId);
        if (concernedHost) {
            notificationHosts[concernedHost] = notificationHosts[concernedHost] || [];
            notificationHosts[concernedHost].push(affinityId);
            this._removeTrackedRecord(concernedHost, affinityId);
        }
    }, this);

    // Send out all notifications
    for (var host in notificationHosts) {
        // Forward the packet
        log.log(log.DEBUG3, 'Sending affinity (remove) message to host %s with %s items', host,
            notificationHosts[host].length);
        this._sendProtocolMessage(host, 'remove', notificationHosts[host], 'local');
    }
};

/**
 * Occurs when we can't establish the affinity.  (Usually maxAffinities is reached)
 * @param packet
 * @param fromUuid
 * @private
 */
HostAffinity.prototype._handleError = function(packet, fromUuid) {
    if (!packet.id || isArray(packet.id)) {
        return;
    }
    var concernedHost = this._removeTrackedRecord(fromUuid, packet.id);
    if (concernedHost) {
        this._removeTrackedRecord(concernedHost, packet.id);
        this._sendProtocolMessage(concernedHost, 'error', packet.id, 'local');
    }
};

/**
 * This occurs when a route is lost on our local routing table.  This can include
 * external hosts.  If we have a tracked host in our affinities for that id, then
 * we will send a notification that the affinity has been lost
 * @param toId - the host that dropped
 * @private
 */
HostAffinity.prototype._handleRouteLost = function(toId) {
    var hostInfo = this._trackedHosts[toId];
    if (hostInfo) {
        log.log(log.DEBUG2, 'Detected %s is lost, removing affinities', toId);
        // Simulate a remove from the host for all affinities
        this._handleRemove(
            {
                id: Object.keys(hostInfo._affinities)
            },
            toId
        );
    }
};

/**
 * This function will add a tracked record for the given host, if necessary
 * @param toId
 * @param affinityId
 * @param owned
 * @returns {Boolean} true if the record was added
 * @private
 */
HostAffinity.prototype._addTrackedRecord = function(toId, concernedId, affinityId, owned) {
    var toIdInfo = this._trackedHosts[toId];
    if (!toIdInfo) {
        toIdInfo = this._trackedHosts[toId] = {
            _affinities: {},
            _ownedCount: 0,
            _totalCount: 0
        };
    }

    // Ensure that we don't exceed, otherwise send a remove message back to the sender.
    // But only if this is an external link.
    if (owned && appUtils.isExtUuid(toId) && toIdInfo._ownedCount >= this._maxHostAffinities) {
        log.log(log.WARN, 'Exceeded max affinities for host %s', toId);
        return false;
    }

    if (!toIdInfo._affinities[affinityId]) {
        toIdInfo._affinities[affinityId] = {
            _concernedHost: concernedId,
            _owned: !!owned
        };
        toIdInfo._totalCount += 1;
        if (owned) {
            toIdInfo._totalOwned += 1;
        }
        log.log(log.DEBUG2, 'Added tracked affinity: [id: %s] [host: %s] [concerned host: %s]',
            affinityId, toId, concernedId);
        return true;
    }
    else {
        log.log(log.DEBUG, 'We already know that affinity id %s for %s', affinityId, toId);
    }
    return false;
};

/**
 * Remove the given tracked record, and return the concerned host id if it exists.
 * @param toId
 * @param affinityId
 * @returns {String} the concerned host id or null
 * @private
 */
HostAffinity.prototype._removeTrackedRecord = function(toId, affinityId) {
    var toIdInfo = this._trackedHosts[toId];
    if (toIdInfo) {
        var concernedHost = toIdInfo._affinities[affinityId];
        if (concernedHost) {
            log.log(log.DEBUG2, 'Removed tracked affinity: [id: %s] [host: %s] [concerned host: %s]',
                affinityId, toId, concernedHost._concernedHost);
            delete toIdInfo._affinities[affinityId];
            toIdInfo._totalCount -= 1;
            if (concernedHost._owned) {
                toIdInfo._ownedCount -= 1;
            }
            return concernedHost._concernedHost;
        }
    }
    if (toIdInfo._totalCount === 0) {
        delete this._trackedHosts[toId];
    }
    return null;
};

/**
 * Send an affinity packet to the given host
 * @param toId - host to send the message to
 * @param type - the type of the message
 * @param affinityId - list of ids or an id
 * @param {String} [path] - the path to continue the affinity
 * @private
 */
HostAffinity.prototype._sendProtocolMessage = function(toId, type, affinityId, fromUuid, path) {
    if (toId == 'local') {
        // Report locally, as long as it's not an error.  We don't want to
        // prevent communication if there are no affinities available
        var ids = !isArray(affinityId) ? [affinityId] : affinityId;
        var _this = this;
        ids.forEach(function(id) {
            _this.emit(id, type);
            _this.removeAllListeners(id);
        });
    }
    else {
        this._routerInstance.sendPacket(
            toId,
            'affinity',
            {
                id: affinityId,
                from: this._id,
                type: type,
                path: path
            },
            fromUuid);
    }
};

/**
 * Establish a affinity with the given node
 * @param address
 */
HostAffinity.prototype.establishHostAffinity = function(address) {
    var addressHash = address.toString();
    // Ensure that the address has no loops and isn't directed at myself.
    if (addressHash.length === 0 || !address.isValid(this._maxHops)) {
        throw new Error('invalid address');
    }
    var localAffinity = this._localAffinities[addressHash];
    if (!localAffinity) {
        // Don't route to myself
        var pathVector = address.getPathVector();
        if (pathVector.length == 1 && pathVector[0] == this._id) {
            return null;
        }
        // Create a remote affinity record
        localAffinity = this._localAffinities[addressHash] = {
            _id: uuid(),
            _count: 0
        };
        this._handleAdd(
            {
                path: address.getPathVector(),
                id: localAffinity._id
            },
            'local'
        );
    }
    localAffinity._count += 1;
    return localAffinity._id;
};

/**
 * Tell the distant node that we're breaking the given host affinity
 * @param address
 * @param affinityId
 */
HostAffinity.prototype.removeHostAffinity = function(address) {
    var addressHash = address.toString();
    if (addressHash.length === 0) {
        return;
    }
    var localAffinity = this._localAffinities[addressHash];
    if (localAffinity) {
        localAffinity._count -= 1;
        if (localAffinity._count === 0) {
            delete this._localAffinities[addressHash];
            this._handleRemove(
                {
                    id: [localAffinity._id]
                },
                'local'
            );
        }
    }
};

}).call(this,"/js\\app\\routing\\host-affinity.js")
},{"../util/appUtils":54,"./address":36,"events":64,"node-uuid":69,"util":92}],38:[function(require,module,exports){
(function (__filename){
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

var isArray = require('util').isArray,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

module.exports = PathVector;

/**
 * Path Vector will allow sending to destinations via a 'vector' instead of a single
 * internal address. The goal is to implement the IERP part of Zone Routing Protocol
 * (ZRP - https://en.wikipedia.org/wiki/Zone_Routing_Protocol)
 * @param {Router} routerInstance - an instance of the Router class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function PathVector(routerInstance, config) {
    if (!(this instanceof PathVector)) { return new PathVector(routerInstance, config); }

    this._id = config.get('instanceId');
    this._maxHops = config.get('maxHops');

    // Register with the router to track internal hosts
    this._routerInstance = routerInstance;
    this._routerInstance.addHandler('path');
    this._routerInstance.on('path', this._handlePathPacket.bind(this));
}

/**
 * Read a packet from the given address
 * @param packet
 * @param fromUuid - the immediate link we received the message from
 * @private
 */
PathVector.prototype._handlePathPacket = function(packet, fromUuid) {
    var toUuid = packet.d;

    if (isArray(toUuid)) {
        // Ensure the number of hops is less than max hops.
        if (toUuid.length > this._maxHops) {
            log.log(log.ERROR, 'Packet exceeds max hops (from %s), Total hops: %s',
                fromUuid,
                toUuid.length);
            return;
        }

        // Get the next host to send to, removing references to myself.
        var toHost = this._id;
        while (toHost == this._id && toUuid.length > 0) {
            toHost = toUuid[0];
            toUuid.shift();
        }

        if (toUuid.length > 0) {
            // More hops, continue using path protocol

            // If toUuid still has an entry, see if we know about it, if so, then route directly
            // to that host, instead of the intermediate host. We do this because in an internal
            // network, the next host will have the same routing table as me, so lets skip
            // the intermediary if there is one.
            if (toUuid.length > 0) {
                var route = this._routerInstance.getRoute(toUuid[0]);
                if (route && !route.external) {
                    toHost = toUuid[0];
                    toUuid.shift();
                }
            }

            this._routerInstance.sendPacket(toHost, 'path', packet, fromUuid);
        }
        else {
            // Send directly to the given host.
            this._routerInstance.sendPacket(toHost, packet.n, packet.m, fromUuid);
        }
    }
};

/**
 * Send the given packet to the given router handler.
 * @param address - vector to destination
 * @param name
 * @param packet
 */
PathVector.prototype.sendPacket = function(address, name, packet) {
    packet = {
        d: address.getPathVector(),
        n: name,
        m: packet
    };
    this._handlePathPacket(packet, 'local');
};

}).call(this,"/js\\app\\routing\\path-vector.js")
},{"../util/appUtils":54,"util":92}],39:[function(require,module,exports){
(function (__filename){
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
    constants = require('../util/constants'),
    routingTable = require('./routing-table'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Router, EventEmitter);

module.exports = Router;

/**
 * The router is responsible for finding the best route from
 * one Endpoint.js to another.  It uses the routing table, listening from
 * routing events from the switch board, and sends
 * @augments EventEmitter
 * @fires Router#route-available (toId, adjacent)
 * @fires Router#route-change (toId, adjacent)
 * @fires Router#route-unavailable (toId)
 * @fires Router#X (packet) when a packet is available for a particular handler
 * @fires Router#X-error (fromId, toId, packet) - when a problem occurs routing a packet
 *                                 for a specific handler type
 * @param {SwitchBoard} switchBoardInstance - an instance of the SwitchBoard class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function Router(switchBoardInstance, config) {
    if (!(this instanceof Router)) return new Router(switchBoardInstance, config);

    EventEmitter.call(this);
    this.setMaxListeners(0);

    this._id = config.get('instanceId');

    // A list of packet handlers indexed by name.
    this._handlers = {};

    // Only allow relay for the given bridges.
    this._linkAssociation = config.getLinkAssociation();

    // Routes that are updated through 'route-update' protocol on switchboard.
    this._routes = {};
    this._routes[this._id] = {
        // Whether we are using an adjacent route
        adjacent: true,
        // The current list of next hops for a given host, updated by routing table.
        nextHop: this._id,
        // Whether this item has been reported as a route (or reported via switchboard)
        reported: false,
        // Whether this host is hosted on an external link
        external: false
    };

    // Create a routing table and subscribe to events
    this._routingTable = routingTable(this._id);
    this._routingTable.on('route-update', this._handleRouteUpdate.bind(this));
    this._routingTable.on('route-expired', this._handleRouteExpire.bind(this));

    // Register with the switch board.
    this._switchBoard = switchBoardInstance;
    this._switchBoard.addHandler('route');
    this._switchBoard.addHandler('route-update');
    this._switchBoard.on('link-unavailable', this._handleLinkLost.bind(this));
    this._switchBoard.on('link-switch', this._handleLinkSwitch.bind(this));
    this._switchBoard.on('route', this._handleRoutePacket.bind(this));
    this._switchBoard.on('route-update', this._handleRouteUpdatePacket.bind(this));
}

/**
 * When a new packet comes in from a switch stream, decide where to
 * relay it to.
 * @param stream
 * @private
 */
Router.prototype._handleRoutePacket = function(packet, fromUuid) {

    var toUuid = packet.d;

    // Ensure we know about this host.
    var fromRoute = this._routes[fromUuid];
    if (!fromRoute && fromUuid != 'local') {
        log.log(log.WARN, 'Message originated from unknown endpoint: %s', fromUuid);
        return;
    }

    // Route the packet through the switchboard
    if (toUuid && toUuid != this._id && toUuid != 'local') {

        // Route externally.
        var success = this._routePacket(packet, fromRoute, toUuid);
        if (!success) {
            if (packet.p && this.hasHandler(packet.p)) {
                this.emit(packet.p + '-error', packet.m, packet.d, fromUuid);
            }
        }

    }
    else {

        // This lets anyone using the router know whether to trust messages
        // as coming from the local/group neighborhood or externally.
        var neighborhood = constants.Neighborhood;
        var source = neighborhood.LOCAL;
        if (fromRoute) {
            if (fromRoute.external) {
                source = neighborhood.UNIVERSAL;
            }
            else {
                source = neighborhood.GROUP;
            }
        }

        // Route locally.
        if (packet.p && this.hasHandler(packet.p)) {
            this.emit(packet.p, packet.m, fromUuid, source);
        }
    }
};

/**
 * When a new packet comes in from a switch stream, update local
 * details.
 * @param stream
 * @private
 */
Router.prototype._handleRouteUpdatePacket = function(packet, fromUuid) {
    // Ignore updates from external links
    var route = this._routes[fromUuid];
    if (route && !route.external) {
        var updates = this._routingTable.applyUpdates(fromUuid, packet);
        this._broadcastUpdates(updates);
    }
};

/**
 * Send the 'packet' that was sent to us from adjacent 'fromUuid' host to the ultimate
 * destination at 'toUuid' using our routing table.
 * @param packet
 * @param fromUuid
 * @param toUuid
 * @private
 */
Router.prototype._routePacket = function(packet, fromRoute, toUuid) {

    // See if we can get to the final destination internally
    var route = this.getRoute(toUuid);

    // Do we have a valid internal (routing-table) or external (switchboard) route?
    if (!route || !route.nextHop) {
        log.log(log.WARN, 'No route for: %s', toUuid);
        return false;
    }

    var nextHop = route.nextHop;

    // Don't allow routing back to where we came from
    if (fromRoute && route) {
        if (nextHop == fromRoute.address) {
            log.log(log.WARN, 'Cannot route a packet back the way it came: [nextHop: %s] [from: %s]',
                nextHop, fromRoute.address);
            return false;
        }

        // Ensure that the routing is allowed / enabled within a bridge.
        if (fromRoute.external || route.external) {
            if (!this._linkAssociation.isAssociated(fromRoute.linkId, route.linkId)) {
                log.log(log.TRACE, 'Cannot route to un-bridged links [Link 1: %s] [Link 2: %s]',
                    fromRoute.linkId, route.linkId);
                return true; // assume valid
            }
        }
    }

    // Don't need to send the destinationUuid if it's the next hop.
    if (nextHop == toUuid) {
        delete packet.d;
    }

    log.log(log.TRACE, 'Routing packet destined for [%s] to [%s]',
        toUuid, nextHop);

    this._switchBoard.sendPacket(nextHop, 'route', packet);

    return true;
};

/**
 * Send the given packet to the given switch stream.
 * @param toUuid - internal destination
 * @param name
 * @param packet
 * @param fromUuid - allow spoofing of from uuid.
 */
Router.prototype.sendPacket = function(toUuid, name, packet, fromUuid) {

    if (this.hasHandler(name)) {
        var wrappedPacket = {
            p: name,
            d: toUuid, // where we're going
            m: packet
        };
        this._handleRoutePacket(wrappedPacket, fromUuid || 'local');
    }
    else {
        log.log(log.WARN, 'Attempted to send a packet for unregistered handler' +
            ' [handler: %s]', name);
    }
};

/**
 * When a new route is available to a particular host, report it here.
 * @param toId
 * @param nextHopId
 * @private
 */
Router.prototype._handleRouteUpdate = function(toId, nextHopId) {

    var route = this._routes[toId];
    if (!route) {
        route = this._routes[toId] = {
            address: toId,
            adjacent: toId === nextHopId,
            nextHop: null,
            reported: false,
            external: false
        };
    }

    // Ignore anything from the routing table that tries to impersonate an
    // external link
    if (!route.external) {

        // Update the next hop.
        route.nextHop = nextHopId;

        // Update the link id
        var nextHopDetails = this._routes[nextHopId];
        route.linkId = nextHopDetails.linkId;

        if (!route.reported) {
            log.log(log.DEBUG2, 'New route to [%s] reported: %s', toId, nextHopId);
            route.reported = true;
            this.emit('route-available', toId, route);
        }
        else {
            // The route was reported via the routing table
            log.log(log.DEBUG2, 'Updated route to [%s] reported: %s', toId, nextHopId);
            route.adjacent = toId === nextHopId;
            this.emit('route-change', toId, route);
        }
    }
};

/**
 * When a route to a specific host is no longer available, report it here.
 * @param toId
 * @private
 */
Router.prototype._handleRouteExpire = function(toId) {
    var route = this._routes[toId];
    if (route) {
        log.log(log.DEBUG2, 'Route expired: %s', toId);
        delete this._routes[toId];
        this.emit('route-unavailable', toId, route);
    }
};

/**
 * Get the best route to the given location
 * @param toId
 */
Router.prototype.getRoute = function(toId) {
    if (this._routes[toId]) {
        return this._routes[toId];
    }
    // Otherwise returns undefined
};

/**
 * Occurs when a switch stream changes interfaces, associated with
 * a new cost.
 * @param fromUuid
 * @param cost
 * @private
 */
Router.prototype._handleLinkSwitch = function(fromUuid, linkDetails) {

    var route = this._routes[fromUuid];

    // If we don't have the route, then add it:
    if (!route) {
        // If we have never seen this host before, then register it with the routing table.
        route = this._routes[fromUuid] = {
            address: fromUuid,
            adjacent: true,
            nextHop: fromUuid,
            reported: false,
            external: linkDetails.isExternal()
        };
    }

    // Update the link id
    route.linkId = linkDetails.getId();

    // Don't want a 'external' status change to affect the routing table
    if (!route.external) {
        var updates;
        if (this._routingTable.hasLink(fromUuid)) {
            updates = this._routingTable.updateLinkCost(fromUuid, linkDetails.getCost());
        }
        else {
            updates = this._routingTable.addLink(fromUuid, linkDetails.getCost());
        }
        this._broadcastUpdates(updates);
    }
    else {
        // Report the external route
        log.log(log.DEBUG2, 'New external route reported: %s', fromUuid);
        this.emit('route-available', fromUuid, route);
    }
};

/**
 * If there is no link available for this Endpoint.js, then this is
 * unrecoverable
 * @param fromUuid
 * @private
 */
Router.prototype._handleLinkLost = function(fromUuid, linkDetails) {
    var route = this._routes[fromUuid];
    if (route) {
        if (!route.external) {
            var updates = this._routingTable.removeLink(fromUuid);
            this._broadcastUpdates(updates);
        }
        else {
            this._handleRouteExpire(fromUuid);
        }
    }
};

/**
 * Broadcast the updates to all the link streams
 * @param updates
 * @private
 */
Router.prototype._broadcastUpdates = function(updates) {
    // This is needed in case multiple connections are closed at the same
    // time (appUtils.nextTick)
    var _this = this;
    if (updates.length > 0) {
        appUtils.nextTick(function() {
            log.log(log.DEBUG2, 'Broadcasting router updates [Total: %s]', updates.length);
            _this._switchBoard.broadcastInternal('route-update', updates);
        });
    }
};

/**
 * Add the given handler to the switch-board.  This isn't really used
 * for any functional reason other than to ensure we only emit
 * packet events for handlers we know about.
 * @param name
 * @param handler
 */
Router.prototype.addHandler = function(name) {
    this._handlers[name] = true;
    log.log(log.DEBUG, 'Added packet handler [name: %s]', name);
};

/**
 * Whether the given handler is registered
 * @param name
 */
Router.prototype.hasHandler = function(name) {
    if (this._handlers[name]) {
        return true;
    }
    return false;
};

}).call(this,"/js\\app\\routing\\router.js")
},{"../util/appUtils":54,"../util/constants":55,"./routing-table":40,"events":64,"util":92}],40:[function(require,module,exports){
(function (__filename){
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
/* globals __filename, Infinity */

'use strict';

var EventEmitter = require('events').EventEmitter,
    inherits = require('util').inherits,
    periodicTimer = require('../util/periodic-timer'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(RoutingTable, EventEmitter);

module.exports = RoutingTable;

/**
 * This class will execute a modified DSDV to build a routing table
 * to all reachable hosts
 * http://www.cs.virginia.edu/~cl7v/cs851-papers/dsdv-sigcomm94.pdf
 * @augments EventEmitter
 * @fires RoutingTable#route-update (toId, nextHop)
 * @fires RoutingTable#route-expire (toId)
 * @param {String} id - unique identifier for this endpoint.js instance
 * @param {Number} period - interval to check for dead routes
 * @constructor
 */
function RoutingTable(id, period) {
    if (!(this instanceof RoutingTable)) { return new RoutingTable(id, period); }

    EventEmitter.call(this);

    // List of local links
    this._links = {};

    // My Entry
    this._myEntry = {
        id: id,
        seq: 0,
        next: id,
        cost: 0
    };

    // Listen for updates
    this._timer = periodicTimer('Routing Table', 15000);
    this._timer.on('period', this._performPeriodic.bind(this));

    // Destinations.  List of places we can get to, indexed by
    // destination ID, contains a sorted array of next possible
    // hops and the associated cost
    this._dests = {};

    // Add my entry to the destinations list.
    this._dests[id] = this._myEntry;

}

/**
 * Return the id of this router
 * @returns {*}
 */
RoutingTable.prototype.getId = function() {
    return this._myEntry.id;
};

/**
 * Whether the routing table is listening to the link
 * @param linkId
 */
RoutingTable.prototype.hasLink = function(linkId) {
    return !!this._links[linkId];
};

/**
 * Add the link to the routing table, and send out our entire table
 * to everyone.  Technically we should only have to send the value to
 * the new link, but we'll send it to everyone
 * @param linkId
 * @param cost
 * @returns {*}
 */
RoutingTable.prototype.addLink = function(linkId, cost) {
    if (this._links[linkId]) {
        log.log(log.WARN, 'Already know about that link: [id: %s]', linkId);
        return [];
    }
    this._links[linkId] = { cost: cost };
    this._myEntry.seq += 2;
    // See if we already know about this dest
    if (!this._dests[linkId]) {
        this._dests[linkId] = {
            id: linkId,
            cost: cost,
            seq: 0,
            next: linkId
        };
    }
    this.emit('route-update', linkId, linkId);
    this._timer.addReference();
    log.log(log.DEBUG2, 'Added link: [id: %s]', linkId);
    return this._exportTableAsUpdates();
};

/**
 * If a link changes cost, then update the value by incrementing the
 * sequence number, so that everyone in the network will re-calculate
 * the cost to get to a specific link.
 * @param linkId
 * @param cost
 */
RoutingTable.prototype.updateLinkCost = function(linkId, cost) {
    var link = this._links[linkId];
    if (!link) {
        log.log(log.WARN, 'Unknown link: [id: %s]', linkId);
        return [];
    }
    if (link.cost == cost) {
        // Nothing to do
        return [];
    }
    link.cost = cost;
    this._myEntry.seq += 2;
    log.log(log.DEBUG2, 'Updated link: [id: %s] [cost: %s]', linkId, cost);
    return [this._createUpdateFor(linkId, false), this._createUpdateFor(this._myEntry.id, false)];
};

/**
 * Remove the given link from our routing table, and
 * send out updates to the effect, signifying which links
 * we can no longer get to.
 * @param linkId
 * @returns {Array}
 */
RoutingTable.prototype.removeLink = function(linkId) {
    var link = this._links[linkId];
    if (!link) {
        log.log(log.WARN, 'Unknown link: [id: %s]', linkId);
        return [];
    }
    var updates = [];
    this._myEntry.seq += 2;
    for (var destId in this._dests) {
        if (this._dests[destId].next == linkId) {
            this._dests[destId].cost = Infinity;
            this._dests[destId].seq++;
            updates.push(this._createUpdateFor(destId, false));
        }
    }
    log.log(log.DEBUG2, 'Removed link: [id: %s]', linkId);
    delete this._links[linkId];
    if (this._dests[linkId]) {
        delete this._dests[linkId];
        this.emit('route-expired', linkId);
    }
    this._timer.removeReference();
    updates.push(this._createUpdateFor(this._myEntry.id, false));
    return updates;
};

/**
 *
 * @param from
 * @param updates
 * @returns {Array}
 */
RoutingTable.prototype.applyUpdates = function(fromId, updates) {

    var link = this._links[fromId];
    if (!link) {
        log.log(log.WARN, 'Unknown link: %s', fromId);
        return [];
    }

    var outUpdates = [];

    log.log(log.DEBUG3, 'Number of route updates in this pack: [from: %s] [count: %s]',
        fromId, updates.length);

    for (var i = 0; i < updates.length; i++) {
        var update = updates[i];

        // Malformed?
        if (!update || !update.hasOwnProperty('id') ||
            !update.hasOwnProperty('seq') || !update.hasOwnProperty('cost')) {
            log.log(log.WARN, 'Malformed routing packet: %j', update);
            continue;
        }

        // Translate the update
        if (update.cost == 'inf') {
            update.cost = Infinity;
        }

        if (update.id != this._myEntry.id) {

            if (!this._dests[update.id]) {

                if (update.cost !== Infinity) {

                    this._dests[update.id] = {
                        id: update.id,
                        seq: update.seq,
                        cost: update.cost + link.cost,
                        next: fromId
                    };

                    log.log(log.DEBUG, 'Encountered new external host [id: %s] [cost: %s] [next: %s]',
                        update.id, this._dests[update.id].cost, fromId);

                    outUpdates.push(this._createUpdateFor(update.id));

                    this.emit('route-update', update.id, fromId);
                }
                else {
                    log.log(log.DEBUG2, 'Was sent an infinite cost route I didn\'t know about' +
                        ' , ignoring [id: %s] [next: %s]',
                        update.id, fromId);
                }

            }
            else {

                // The odd layout of these commands are for logging purposes.
                var seqGreater = update.seq > this._dests[update.id].seq;

                var costLower;
                if (!seqGreater) {
                    costLower = update.seq == this._dests[update.id].seq &&
                        (update.cost + link.cost) < this._dests[update.id].cost;
                }

                if (seqGreater || costLower) {

                    // The last 'best' hop before this update.
                    var prevNext = this._dests[update.id].next;

                    this._dests[update.id] = {
                        id: update.id,
                        seq: update.seq,
                        cost: update.cost + link.cost,
                        next: fromId
                    };

                    log.log(log.DEBUG2, 'Better route encountered [id: %s] [cost: %s] [next: %s] ' +
                        '[seq check: %s] [cost check: %s]',
                        update.id, this._dests[update.id].cost, fromId, seqGreater, costLower);

                    outUpdates.push(this._createUpdateFor(update.id));

                    // Remove the entry immediately, but only if my next hop is
                    // the guy who gave me the update. DSDV requires us not to
                    // remove it from the routing table immediately, however,
                    // because of dampening/settling.
                    if (update.cost === Infinity && fromId == prevNext) {
                        this.emit('route-expired', update.id);
                    }
                    else {
                        // Update the cost.
                        this.emit('route-update', update.id, fromId);
                    }
                }
                else {
                    log.log(log.DEBUG3, 'Non optimal route received [id: %s] [next: %s]',
                        update.id, fromId);
                }
            }
        }
        else {

            // If it's an update for me, and it has a higher seq num,
            // send out my update again.  This will happen
            // when someone loses their route to me.  The sequence
            // update will propagate through the network, and no one
            // will be able to find me anymore unless I do this.
            if (update.seq > this._myEntry.seq) {
                // Update until I'm the latest
                while (update.seq > this._myEntry.seq) {
                    this._myEntry.seq += 2;
                }
                outUpdates.push(this._createUpdateFor(this._myEntry.id));

                log.log(log.DEBUG3, 'Someone incremented my sequence number');

            }
            else {
                log.log(log.TRACE, 'Ignore route update to myself');
            }

        }
    }

    return outUpdates;
};

/**
 * Create updates for the entire table.  This is only used when
 * we need to send the whole table to a new adjacent link.
 * @returns {Array}
 * @private
 */
RoutingTable.prototype._exportTableAsUpdates = function(withNext) {
    var updates = [];
    for (var destId in this._dests) {
        updates.push(this._createUpdateFor(destId, withNext));
    }
    return updates;
};

/**
 * Create an update message to send to other nodes for the given
 * destination id.
 * @param destId
 * @private
 */
RoutingTable.prototype._createUpdateFor = function(destId, withNext) {
    var dest = this._dests[destId];
    if (dest) {
        var value = {
            id: destId,
            seq: dest.seq,
            cost: dest.cost
        };
        if (value.cost === Infinity) {
            value.cost = 'inf';
        }
        if (withNext) {
            value.next = dest.next;
        }
        return value;
    }
    return null;
};

/**
 * This function will do periodic duties, like ensuer
 * that outdated (infinite) links are removed from the
 * routing table
 * @private
 */
RoutingTable.prototype._performPeriodic = function(force) {
    var toDelete = [];
    log.log(log.DEBUG3, 'Periodic routing table cleanup');
    for (var destId in this._dests) {
        if (force) {
            if (destId != this._myEntry.id) {
                toDelete.push(destId);
            }
        }
        else {
            var dest = this._dests[destId];
            if (dest.cost == Infinity) {
                if (!dest.ttl) {
                    dest.ttl = 1;
                }
                else {
                    if (dest.ttl >= 1) {
                        // Expire this route.
                        toDelete.push(destId);
                    }
                    else {
                        dest.ttl++;
                    }
                }
            }
        }
    }
    if (toDelete.length > 0) {
        log.log(log.DEBUG, 'Deleting %s items from the routing table', toDelete.length);
        toDelete.forEach(function(item) {
            delete this._dests[item];
            this.emit('route-expired', item);
        }, this);
    }
};

}).call(this,"/js\\app\\routing\\routing-table.js")
},{"../util/appUtils":54,"../util/periodic-timer":58,"events":64,"util":92}],41:[function(require,module,exports){
(function (__filename){
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
/* globals __filename, setInterval, clearInterval */

'use strict';

var appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    periodicTimer = require('../util/periodic-timer'),
    EventEmitter = require('events').EventEmitter,
    through2 = require('through2');

/**
 * This function will return a pair of linked heartbeat encode/decode
 * streams with the given duration
 * @module heartbeat-stream
 * @param {Number} duration - how often to ping
 */
module.exports = function(duration) {

    var events = new EventEmitter();

    var streams = {
        encode: encodeHeartbeat(events, duration),
        decode: decodeHeartbeat(events)
    };

    return streams;
};

/**
 * Used to ensure the stream is still alive
 * @returns {*}
 */
function encodeHeartbeat(events, duration) {

    duration = duration || 20000;

    var readCounter = 0;
    var sentCounter = 0;
    var timer = periodicTimer('Heart Beat', duration);
    var timerId;
    var waitingForPing = false;

    var stream = through2.obj(function(chunk, encoding, cb) {
        this.push({
            m: chunk
        });
        sentCounter += 1;
        cb();
    });

    // The destination sent data to us.
    events.on('read', function() {
        readCounter += 1;
    });

    // Relay to the stream that it has timed out.
    events.on('heartbeat-timeout', function() {
        stream.emit('heartbeat-timeout');
    });

    // If the read stream ends, then remove the reference
    events.on('read-close', function() {
        timer.removeReference();
    });

    // Send a ping, and make sure we received some data from the remote host
    timer.on('period', function(force) {

        if (force) {
            // This occurs when the timer ends
            return;
        }

        log.log(log.DEBUG3, 'Periodic timer [id: %s] [read counter: %s] [send counter: %s] [waiting for ping: %s] ',
            timerId, readCounter, sentCounter, waitingForPing);

        if (readCounter === 0) {
            if (waitingForPing) {
                // End the stream
                log.log(log.WARN, 'Heartbeat detected stream link is dead');
                events.emit('heartbeat-timeout');
                return;
            }
            else {
                waitingForPing = true;
            }
        }
        else {
            // Reset the counter
            readCounter = 0;
            waitingForPing = false;
        }

        // send a ping every instance, but only if i haven't sent any data in a while.
        if (sentCounter === 0) {
            stream.push({
                h: 'ping'
            });
        }
        else {
            sentCounter = 0;
        }

    });

    // End the timer if the stream dies
    stream.on('finish', function() {
        timer.removeReference();
    });

    // Start the timer
    timerId = timer.addReference();

    return stream;
}

/**
 * Used to ensure the stream is still alive
 * @returns {*}
 */
function decodeHeartbeat(events) {
    var stream = through2.obj(function(chunk, encoding, cb) {
        // Intercept heartbeats
        if (!chunk.h) {
            this.push(chunk.m);
        }
        events.emit('read');
        cb();
    });

    // End the timer if the stream dies
    stream.on('finish', function() {
        events.emit('read-close');
    });

    // Relay to the stream that it has timed out.
    events.on('heartbeat-timeout', function() {
        stream.emit('heartbeat-timeout');
    });
    return stream;
}

}).call(this,"/js\\app\\streams\\heartbeat-stream.js")
},{"../util/appUtils":54,"../util/periodic-timer":58,"events":64,"through2":89}],42:[function(require,module,exports){
(function (__filename){
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

var inherits = require('util').inherits,
    Duplex = require('readable-stream').Duplex,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(LinkStream, Duplex);

module.exports = LinkStream;

/**
 * Link stream is a Duplex (Readable/Writable) stream which sends data
 * through the conencted send/read transport.
 * @augments Duplex
 * @param {Object} settings
 * @param {Stream} settings.readTransport - stream to read data from
 * @param {Stream} settings.sendTransport - stream to write data to
 * @param {Object} opts - Duplex options based to Duplex.
 * @constructor
 */
function LinkStream(settings, opts) {
    if (!(this instanceof LinkStream)) {
        return new LinkStream(settings, opts);
    }

    opts = opts || {};
    Duplex.call(this, opts);
    this._cb = null;
    this._closed = false;

    // If there is no more data to be written.
    // Someone manually called .end() on us.
    var _this = this;
    function doEnd() {
        if (!_this._closed) {
            _this._sendTransport.push(null);
            _this._sendTransport.end();
            _this._closed = true;
            if (_this._cb) {
                var cb = _this._cb;
                _this._cb = null;
                cb();
            }
        }
    }
    this.on('finish', function() {
        log.log(log.DEBUG2, 'Link stream finish detected');
        doEnd();
    });
    this.on('end', function() {
        log.log(log.DEBUG2, 'Link stream end detected');
        doEnd();
    });

    this.setStreams(settings);
}

/**
 * This function does nothing
 * @param n
 * @private
 */
LinkStream.prototype._read = function(n) {
    this.emit('back-pressure-relieved');
};

/**
 * Send data to the encapsulated writer (local storage, post message, etc)
 * @param chunk
 * @param encoding
 * @param cb
 * @private
 */
LinkStream.prototype._write = function(chunk, encoding, cb) {
    if (!this._closed) {
        if (!this._sendTransport.write(chunk)) {
            // Back-Pressure, stop sending, and start buffering.
            this._cb = cb;
        }
        else {
            // TODO: Possibly do an exponential backoff here?
            cb();
        }
    }
    else {
        log.log(log.DEBUG3, 'Writing to a stream that is closed: %j', chunk);
        cb();
    }
};

/**
 * Return our current streams.
 * @returns {{readTransport: *, sendTransport: *}}
 */
LinkStream.prototype.getStreams = function() {
    return {
        readTransport: this._readTransport,
        sendTransport: this._sendTransport
    };
};

/**
 * Set the streams this link stream uses.
 * @param streams
 */
LinkStream.prototype.setStreams = function(streams) {

    if (this._readTransport) {
        this._readTransport.removeListener('readable', readable);
        this._readTransport.removeListener('end', end);
        this._readTransport.removeListener('finish', finish);
    }

    if (this._sendTransport) {
        this._readTransport.removeListener('drain', drain);
    }

    this._readTransport = streams.readTransport;
    this._sendTransport = streams.sendTransport;

    var _this = this;

    // Read data from source
    this._readTransport.on('readable', readable);

    function readable() {
        var data = _this._readTransport.read();
        if (data) {
            var result = _this.push(data);
            if (!result) {
                _this.emit('back-pressure');
            }
        }
    }

    // No more data to read from read transport,
    // which means we don't have any more data
    // to read.
    this._readTransport.on('end', end);
    this._readTransport.on('finish', finish);

    var readEnd = false;
    function readEndCB() {
        if (!readEnd)  {
            _this.push(null);
            _this.end();
            readEnd = true;
        }
    }
    function end() {
        log.log(log.DEBUG2, 'Transport read end detected');
        readEndCB();
    }
    function finish() {
        log.log(log.DEBUG2, 'Transport read finish detected');
        readEndCB();
    }

    // When the stream is relieved of back-pressure
    this._sendTransport.on('drain', drain);

    function drain() {
        log.log(log.DEBUG3, 'Transport write drain detected');
        if (_this._cb) {
            var cb = _this._cb;
            _this._cb = null;
            cb();
        }
    }
};

}).call(this,"/js\\app\\streams\\link-stream.js")
},{"../util/appUtils":54,"readable-stream":79,"util":92}],43:[function(require,module,exports){
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

var through2 = require('through2');

/**
 * @module metawrap-stream
 */
module.exports = {};

/**
 * Takes an object and wraps it in another
 * object so we can transfer metadata
 * @returns {*}
 */
module.exports.encodeMetaWrapStream = function(meta) {
    if (meta) {
        var str = through2.obj(function(chunk, encoding, cb) {
            this.push({
                meta: meta,
                m: chunk
            });
            cb();
        });
        str.updateMeta = function(newMeta) {
            meta = newMeta;
        };
        return str;
    }
    else {
        return through2.obj(function(chunk, encoding, cb) {
            this.push({ m: chunk });
            cb();
        });
    }
};

/**
 * Parse the chunk if it's a string.
 * @returns {*}
 */
module.exports.decodeMetaWrapStream = function() {
    return through2.obj(function(chunk, encoding, cb) {
        this.push(chunk.m);
        cb();
    });
};

},{"through2":89}],44:[function(require,module,exports){
(function (__filename){
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

var Transform = require('readable-stream').Transform,
    linkStream = require('./link-stream'),
    inherits = require('util').inherits,
    uuid = require('node-uuid'),
    through2 = require('through2'),
    xtend = require('xtend'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Multiplexer, Transform);

module.exports = Multiplexer;

/**
 * This is an object multiplexer. It will take a stream of objects,
 * and emit them as link streams.  You can also create a new stream.
 * @todo It works with object mode only for now.
 * @augments Transform
 * @param {Object} opts - Transform options based to Transform.
 * @constructor
 */
function Multiplexer(opts) {
    if (!(this instanceof Multiplexer)) { return new Multiplexer(opts); }
    this._streams = {};

    opts = opts || {};
    this._opts = opts;

    this.on('end', function() {
        this.close();
    }.bind(this));

    this.on('finish', function() {
        this.close();
    }.bind(this));

    Transform.call(this, { objectMode: true });

    // By default, event emitters throw a warning if you register more than
    // 11 listeners.  Since we're piping tons of streams to myself, this
    // isn't an issue.
    this.setMaxListeners(0);
}

/**
 * Create a stream on this side, and tell the other side
 * about it.
 * @param opts
 * @param meta
 * @param messageMeta - metadata sent with each message
 * @returns {*}
 */
Multiplexer.prototype.createStream = function(meta, opts, streamId) {

    streamId = streamId || uuid();

    opts = opts || {};

    var stream = this._createStream(meta, opts, streamId);

    var wrappedMeta = {
        meta: meta,
        opts: {
            objectMode: opts.hasOwnProperty('objectMode') ? opts.objectMode : false
        }
    };

    // Send the meta.
    this._sendProtocol(streamId, 'new', wrappedMeta);

    return stream;
};

/**
 * Create the internal stream with the given opts.
 * @param streamId
 * @param opts
 * @returns {*}
 * @private
 */
Multiplexer.prototype._createStream = function(meta, opts, streamId) {

    if (this._streams[streamId]) {
        var error = new Error('That stream already exists');
        log.log(log.ERROR, error.message);
        throw error;
    }

    //Read:
    // this._transform -> protocolReaderStream -> link-stream
    //Write:
    // link-stream -> pressureStream -> protocolStream -> this._transform

    var pressureStream = through2.obj(function(chunk, encoding, cb) {
        this.push(chunk);
        // Don't write anymore if backpressure is reported.
        if (streamInfo.backPressure) {
            streamInfo.backPressureCB = cb;
        }
        else {
            cb();
        }
    });

    // Add some metadata (the uuid)
    var protocolStream = through2.obj(function(chunk, encoding, cb) {
        chunk = {
            m: chunk
        };
        chunk.local = true;
        chunk.id = streamId;
        this.push(chunk);
        cb();
    });

    // Decode the protocl stream
    var protocolReaderStream = through2.obj(function(chunk, encoding, cb) {
        this.push(chunk.m);
        cb();
    });

    // Pipe the encoder to the protocol stream, and the protocol stream to me.
    pressureStream.pipe(protocolStream);
    protocolStream.pipe(this, {
        end: false
    });

    // Interface to the rest of the application
    var stream = linkStream({
        readTransport: protocolReaderStream,
        sendTransport: pressureStream
    }, opts);

    // Record the stream id.
    stream.id = streamId;

    var streamInfo = this._streams[streamId] = {
        id: streamId,
        read: protocolReaderStream,
        write: protocolStream,
        meta: meta,
        linkStream: stream,
        backPressure: false,
        backPressureCB: null,
        receivedEnd: false,
        flowing: true
    };

    // When the stream ends
    var ended = false;
    var _this = this;
    function endFunc() {
        if (!ended) {
            // Tell the other side, but only if we closed it.
            if (!streamInfo.receivedEnd) {
                _this._sendProtocol(streamId, 'end');
            }
            // Unpipe the protocol stream.
            protocolStream.unpipe();
            // End everything
            streamInfo.read.end();
            streamInfo.read.push(null);
            delete _this._streams[streamId];
            ended = true;
        }
    }
    stream.on('end', endFunc.bind(this));
    stream.on('finish', endFunc.bind(this));

    // Pressure!
    stream.on('back-pressure', function() {
        // Report back-pressure
        if (streamInfo.flowing) {
            this._sendProtocol(streamId, 'pause');
            streamInfo.flowing = false;
        }
    }.bind(this));

    // No more pressure!
    stream.on('back-pressure-relieved', function() {
        // Report relief
        if (!streamInfo.flowing) {
            this._sendProtocol(streamId, 'resume');
            streamInfo.flowing = true;
        }
    }.bind(this));

    log.log(log.TRACE, 'Created stream: %s', streamId);

    // Return the stream
    return stream;
};

/**
 * Router.  Route date internally and externally.
 * @param chunk
 * @param encoding
 * @param cb
 * @private
 */
Multiplexer.prototype._transform = function(chunk, encoding, cb) {
    if (chunk.local) {
        // Local data destined for external (so pipe can work)
        delete chunk.local;
        log.log(log.TRACE, 'Sending message: %j', chunk);
        this.push(chunk);
    }
    else {
        log.log(log.TRACE, 'Received message: %j', chunk);
        var streamInfo = this._streams[chunk.id];
        if (chunk.m && chunk.m.p) {
            this._handleProtocol(streamInfo, chunk);
        }
        else {
            // Remote data destined for local
            if (!streamInfo) {
                log.log(log.ERROR, 'Unknown stream: %s', chunk.id);
            }
            else {
                streamInfo.read.write(chunk);
            }
        }
    }
    cb();
};

/**
 * Handles the protocl message.  Supports new, end,
 * pause, and resume (for back-pressure)
 * @param msg
 * @private
 */
Multiplexer.prototype._handleProtocol = function(streamInfo, msg) {
    log.log(log.DEBUG3, 'Received protocol message: [msg: %s] [id: %s]', msg.m.p, msg.id);
    if (!streamInfo) {
        if (msg.m.p == 'new') {
            var userMeta = msg.m.meta.meta;
            var opts = msg.m.meta.opts;
            var objectMode = opts.objectMode;
            // Special case where we allow object mode property to be
            // copied.
            var newOpts = xtend(this._opts, {
                objectMode: objectMode
            });
            var str = this._createStream(null, newOpts, msg.id);
            str.meta = userMeta;
            this.emit('stream', str, newOpts);
        }
    }
    else {
        switch (msg.m.p) {
            case 'new':
                log.log(log.ERROR, 'That stream is already open: %s', msg.id);
                streamInfo.linkStream.end();
                break;
            case 'error':
                // Happens on error (unknown stream)
                streamInfo.linkStream.end();
                break;
            case 'end':
                streamInfo.receivedEnd = true;
                streamInfo.linkStream.end();
                break;
            case 'pause':
                streamInfo.backPressure = true;
                break;
            case 'resume':
                streamInfo.backPressure = false;
                if (streamInfo.backPressureCB) {
                    var cb = streamInfo.backPressureCB;
                    streamInfo.backPressureCB = null;
                    cb();
                }
                break;
        }
    }
};

/**
 * Send a protocol message through the multiplexer
 * @param streamId
 * @param msg
 * @param meta
 * @private
 */
Multiplexer.prototype._sendProtocol = function(streamId, msg, meta) {
    var streamInfo = this._streams[streamId];
    if (!streamInfo) {
        log.log(log.ERROR, 'Unknown stream: %s', streamId);
    }
    log.log(log.DEBUG3, 'Sending protocol message: [msg: %s] [id: %s]', msg, streamId);
    meta = meta || {};
    streamInfo.write.write({
        p: msg,
        meta: meta
    });
};

/**
 * Return the stream for the given id, if i know about it.
 * @param id
 */
Multiplexer.prototype.getStream = function(id) {
    var str = null;
    if (this._streams[id]) {
        str = this._streams[id].linkStream;
    }
    return str;
};

/**
 * Update metadata for a stream
 * @param id
 * @param meta
 */
Multiplexer.prototype.updateStreamMeta = function(id, meta) {
    if (this._streams[id]) {
        this._streams[id].meta = meta;
    }
    else {
        log.log(log.WARN, 'Can\'t update meta for stream ' +
            'I don\'t know about: %s', id);
    }
};

/**
 * Return the stream meta for the given id, if i know about it.
 * @param id
 */
Multiplexer.prototype.getStreamMeta = function(id) {
    var str = null;
    if (this._streams[id]) {
        str = this._streams[id].meta;
    }
    return str;
};

/**
 * Kill all streams
 */
Multiplexer.prototype.close = function() {
    var streams = Object.keys(this._streams);
    streams.forEach(function(streamId) {
        this._streams[streamId].linkStream.end();
    }, this);
};

}).call(this,"/js\\app\\streams\\mux-stream.js")
},{"../util/appUtils":54,"./link-stream":42,"node-uuid":69,"readable-stream":79,"through2":89,"util":92,"xtend":93}],45:[function(require,module,exports){
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

var through2 = require('through2'),
    isBuffer = require('util').isBuffer,
    Buffer = require('buffer').Buffer;

/**
 * The buffer stringify stream supports two forms of encoding node.js
 * buffers.  The first will perform a base64 encoding of buffer objects
 * in place, and then run that through JSON.stringify.  The second method
 * will put 'placeholders' where the buffers were, and transfer the raw
 * 'buffer' objects in a modified packet.
 * @module stringify-stream
 */
module.exports = {};

/**
 * Stringify the chunk if it's an object.
 * @returns {*}
 */
module.exports.encode = function(inPlace) {
    return through2.obj(function(chunk, encoding, cb) {
        this.push(module.exports.encodeFunction(inPlace, chunk));
        cb();
    });
};

/**
 * TODO: Be able to support typed arrays and array buffer encoding,
 * for object mode streams that contain binary.
 * This is the function used by the encode stream
 * @param chunk
 * @returns {*}
 */
module.exports.encodeFunction = function(inPlace, chunk) {
    var obj;
    if (inPlace) {
        chunk = traverse('', chunk, function(key, value) {
            if (value._isBuffer || isBuffer(value)) {
                value = {
                    type: 'buffer-i',
                    data: value.toString('base64')
                };
            }
            return value;
        });
        obj = JSON.stringify(chunk);
    }
    else {
        var transfer = [];
        var i = 0;
        chunk = traverse('', chunk, function(key, value) {
            if (chunk._isBuffer || isBuffer(value)) {
                var newValue = {
                    type: 'buffer-o',
                    index: i++
                };
                transfer.push(value.toArrayBuffer());
                return newValue;
            }
            return value;
        });
        obj = JSON.stringify(chunk);
        obj = {
            data: obj,
            transfer: transfer
        };
    }
    return obj;
};

/**
 * Parse the chunk if it's a string.
 * @returns {*}
 */
module.exports.decode = function(inPlace) {
    return through2.obj(function(chunk, encoding, cb) {
        this.push(module.exports.decodeFunction(inPlace, chunk));
        cb();
    });
};

/**
 * This is the function used by the decode stream
 * @param chunk
 * @returns {*}
 */
module.exports.decodeFunction = function(inPlace, chunk) {
    var obj;
    if (inPlace) {
        obj = JSON.parse(chunk);
        obj = traverse('', obj, function(key, value) {
            if (value && value.type == 'buffer-i') {
                return new Buffer(value.data, 'base64');
            }
            return value;
        });
    }
    else {
        obj = JSON.parse(chunk.data);
        obj = traverse('', obj, function(key, value) {
            if (value && value.type == 'buffer-o') {
                return new Buffer(chunk.transfer[value.index]);
            }
            return value;
        });
    }
    return obj;
};

/**
 * Traverse the object stack and execute func on it.
 * @param funcCB
 */
function traverse(key, value, funcCB) {
    var v1 = funcCB(key, value);
    if (value === v1) {
        if (v1 && typeof (v1) == 'object') {
            for (var k in v1) {
                if (Object.prototype.hasOwnProperty.call(v1, k)) {
                    if (v1[k]) {
                        v1[k] = traverse(k, v1[k], funcCB);
                    }
                }
            }
        }
    }
    else {
        return v1;
    }
    return value;
}

},{"buffer":62,"through2":89,"util":92}],46:[function(require,module,exports){
(function (__filename){
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
    expHash = require('../util/expirable-hash'),
    linkTransform = require('./link-transform'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(LinkDirectory, EventEmitter);

module.exports = LinkDirectory;

/**
 * Link directory keeps track of the different
 * links available to the application, and their connections.
 * It sends the connections as events to the switchboard, and
 * the disconnections as well.
 * @augments EventEmitter
 * @fires LinkDirectory#connection (link, fromUuid, streams)
 * @fires LinkDirectory#connection-close (link, fromUuid)
 * @param {Object} opts - options used to create a new link stream
 * @constructor
 */
function LinkDirectory(opts) {
    if (!(this instanceof LinkDirectory)) { return new LinkDirectory(opts); }

    EventEmitter.call(this);

    // This is a list of links, indexed by id
    this._links = {};

    // Expired edges.  These external edges have disconnected, but
    // we keep them around for a few seconds to allow un-routed packets
    // to fail.
    this._expiredEdges = expHash(60, 'Link Directory');

    // This keeps track of connected external edge ids, so that no one else
    // can use the same id of a connected host.
    this._externalEdges = {};

    // New link streams are created with these opts
    opts = opts || {};
    if (!opts.hasOwnProperty('objectMode')) {
        opts.objectMode = true;
    }
    this._opts = opts;
}

/**
 * Handle the connection of a new stream from a certain link and Endpoint.js
 * @param link
 * @param streamId - a unique identifier which identifies this private stream
 * @param fromUuid - public identifier used for routing
 * @param streams
 * @private
 */
LinkDirectory.prototype._handleConnection = function(link, vertexId, streams) {

    // Log the new connection
    log.log(log.INFO, 'New connection for: [fromUuid: %s] [Link Type: %s] [External: %s] [Link Id: %s]',
        vertexId, link.getType(), link.isExternal(), link.getId());

    // How long to wait for timeout of link
    var timeout = link.getHeartbeatTimeout();

    // Create the transform object, to allow the transform factory to modify it.
    var transform = linkTransform(this._opts, streams.read, streams.write, timeout);

    // Create the stream
    var factory = link.getTransformFactory();
    if (typeof (factory) == 'function') {
        factory(transform);
    }

    // Get the completed stream
    var stream = transform.getLinkStream();

    if (link.isExternal()) {
        if (this._externalEdges[vertexId] || this._expiredEdges.get(vertexId)) {
            // Don't allow repeat vertices
            log.log(log.WARN, 'Host attempted to use the same external vertex id: %s', vertexId);
            stream.end();
            return;
        }
        this._externalEdges[vertexId] = true;
        // This is to distinguish the vertex from internal.
        vertexId += '-ext';
    }

    this.emit('connection', link, vertexId, stream);

};

/**
 * Handles the disconnection from a specific link and Endpoint.js
 * @param link
 * @param stream
 * @param fromUuid
 * @private
 */
LinkDirectory.prototype._handleConnectionClose = function(link, vertexId) {

    // Log the new connection
    log.log(log.INFO, 'Closed connection: [fromUuid: %s] [Link Type: %s] [External: %s] [Link Id: %s]',
        vertexId, link.getType(), link.isExternal(), link.getId());

    if (link.isExternal()) {
        if (!this._externalEdges[vertexId]) {
            return;
        }
        this._expiredEdges.add(vertexId, true);
        // This is to distinguish the vertex from internal.
        vertexId += '-ext';
    }

    this.emit('connection-close', link, vertexId);
};

/**
 * Whether the link is registered in this
 * switchboard.
 * @param linkId
 * @returns {boolean}
 */
LinkDirectory.prototype.hasLink = function(linkId) {
    if (this._links[linkId]) {
        return true;
    }
    return false;
};

/**
 * Return the link with the given id.
 * @param linkId
 */
LinkDirectory.prototype.getLink = function(linkId) {
    if (this.hasLink(linkId)) {
        return this._links[linkId]._link;
    }
    return null;
};

/**
 * This function takes a 'link' object from the ../link folder.  It listens
 * for two events, stream-connection, and stream-connection-close.
 * @param link
 */
LinkDirectory.prototype.addLink = function(link) {

    if (this.hasLink(link.getId())) {
        throw new Error('Link already registered');
    }

    var linkPtr = this._links[link.getId()] = {
        _link: link,
        _connectionPtr: this._handleConnection.bind(this),
        _connectionClosePtr: this._handleConnectionClose.bind(this)
    };

    // Register event listener for new connection
    link.on('connection', linkPtr._connectionPtr);

    // Register event listener for new disconnection
    link.on('connection-close', linkPtr._connectionClosePtr);

    log.log(log.DEBUG, 'Added link: [Link Type: %s] [External: %s] [Link ID: %s]',
        link.getType(), link.isExternal(), link.getId());
};

/**
 * Remove the link from internal structures.  This does NOT
 * close the link, or its connections, only stops
 * using them.
 * @param link
 * @private
 */
LinkDirectory.prototype.removeLink = function(link) {
    if (this.hasLink(link.getId())) {
        var linkPtr = this._links[link.getId()];

        // Close all the connections on the link
        linkPtr._link.close();

        // Unsubscribe from the link
        linkPtr._link.removeListener('connection', linkPtr._connectionPtr);
        linkPtr._link.removeListener('connection-close', linkPtr._connectionClosePtr);

        // Remove the internal reference to the link
        delete this._links[linkPtr._link.getId()];

        log.log(log.DEBUG, 'Removed link: [Link Type: %s] [Link ID: %s]',
            linkPtr._link.getType(), linkPtr._link.getId());
    }
};

/**
 * Close all our links
 */
LinkDirectory.prototype.close = function() {
    // Remove all links
    var links = Object.keys(this._links);
    links.forEach(function(linkId) {
        this.removeLink(this.getLink(linkId));
    }, this);
};

}).call(this,"/js\\app\\switching\\link-directory.js")
},{"../util/appUtils":54,"../util/expirable-hash":56,"./link-transform":47,"events":64,"util":92}],47:[function(require,module,exports){
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

'use strict';

var linkStream = require('../streams/link-stream'),
    through2 = require('through2'),
    metaWrapStream = require('../streams/metawrap-stream'),
    heartbeatStream = require('../streams/heartbeat-stream');

module.exports = LinkTransform;

/**
 * Link transform allows addition of stream transformers onto a link.  The default
 * transform applied is the heartbeat stream, but you can add others, like encryption
 * or compression.  The output is a link-stream.
 * @param opts - stream options to use when creating the link stream
 * @param readStream
 * @param writeStream
 * @param timeout - heartbeat timeout in milliseconds
 * @constructor
 */
function LinkTransform(opts, readStream, writeStream, timeout) {
    if (!(this instanceof LinkTransform)) { return new LinkTransform(opts, readStream, writeStream, timeout); }
    this._opts = opts;
    this._readStream = readStream;
    this._writeStream = writeStream;

    // Create the protocol wrapper streams
    var decodeStream = metaWrapStream.decodeMetaWrapStream();
    readStream.pipe(decodeStream);

    var encodeStream = metaWrapStream.encodeMetaWrapStream();
    encodeStream.pipe(writeStream);

    // Wrap the streams in heartbeat.
    if (timeout) {
        timeout = Math.floor(timeout / 2);
    }

    var pair = heartbeatStream(timeout);
    var heartbeatSend = pair.encode;
    var heartbeatRead = pair.decode;

    heartbeatSend.pipe(encodeStream);
    decodeStream.pipe(heartbeatRead);

    // Wrap with a link stream.
    var stream = this._linkStream = linkStream({
        readTransport: heartbeatRead,
        sendTransport: heartbeatSend
    }, opts);

    // If the heartbeat timer detects an issue, end the transport.
    heartbeatSend.on('heartbeat-timeout', function() {
        stream.end();
    });
}

/**
 * Return the link stream represented by this transform
 * @returns {*}
 */
LinkTransform.prototype.getLinkStream = function() {
    return this._linkStream;
};

/**
 * Retrieve the internal streams this link stream is using for read/write,
 * and pipe the given read/write stream
 * @param readStream - a stream or a function
 * @param writeStream - a stream or a function
 */
LinkTransform.prototype.addTransform = function(readStream, writeStream) {
    var streams = this._linkStream.getStreams();
    readStream = readStream || through2.obj();
    writeStream = writeStream || through2.obj();
    if (typeof (readStream) == 'function') {
        readStream = through2.obj(readStream);
    }
    if (typeof (writeStream) == 'function') {
        writeStream = through2.obj(writeStream);
    }
    writeStream.pipe(streams.sendTransport);
    streams.readTransport.pipe(readStream);
    this._linkStream.setStreams({
        readTransport: readStream,
        sendTransport: writeStream
    });
};

},{"../streams/heartbeat-stream":41,"../streams/link-stream":42,"../streams/metawrap-stream":43,"through2":89}],48:[function(require,module,exports){
(function (__filename){
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
    switchStream = require('./switch-stream'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(SwitchBoard, EventEmitter);

module.exports = SwitchBoard;

/**
 * Manage connections with all other peers.  This class emits several based on
 * different link activity within the system.
 * @fires SwitchBoard#link-available - when a link is acquired to an adjacent Endpoint.js.
 * @fires SwitchBoard#link-unavailable - when no links are any longer available to the given
 *                adjacent Endpoint.js
 * @fires SwitchBoard#link-switch - when a link switches to another interface
 * @fires SwitchBoard#X - event emitted when a packet of a certain protocol is intercepted
 * @param {Configuration} config - system configuration
 * @constructor
 */
function SwitchBoard(linkDirectory, config) {
    if (!(this instanceof SwitchBoard)) { return new SwitchBoard(linkDirectory, config); }

    EventEmitter.call(this);

    this._id = config.get('instanceId');

    // A list of packet handlers indexed by name.
    this._handlers = {};

    // This is the list of all endpoints indexed by unique id.
    // An endpoint is a particular adjacent Endpoint.js.
    this._endpoints = {};

    // Subscribe to link events
    this._linkDirectory = linkDirectory;
    this._linkDirectory.on('connection', this._handleConnection.bind(this));
    this._linkDirectory.on('connection-close', this._handleConnectionClose.bind(this));
}

/**
 * Handle the connection of a new stream from a certain link and Endpoint.js
 * @param link
 * @param stream
 * @param fromUuid
 * @private
 */
SwitchBoard.prototype._handleConnection = function(link, fromUuid, stream) {

    var endpoint = this.getEndpoint(fromUuid);
    if (!endpoint) {

        // Make sure it's valid.
        if (fromUuid == 'local' || fromUuid == this._id) {
            log.log(log.ERROR, 'Reserved link name used: local');
            stream.end();
            return;
        }

        this._endpoints[fromUuid] = endpoint = {
            switchStream: switchStream({objectMode: true}),
            activeLink: link,
            streams: {} // indexed by link id
        };

        var _this = this;

        // Handle raw packets, by determining where to send them.
        endpoint.switchStream.on('readable', function() {
            var msg;
            while ((msg = endpoint.switchStream.read()) !== null) {
                _this._handleRawInbound(fromUuid, msg);
            }
        });

        // When a switch-stream switches, report it to the higher levels
        endpoint.switchStream.on('switch', function(cost, link) {
            endpoint.activeLink = link;
            _this.emit('link-switch', fromUuid, link);
        });

        // Report ourself to the higher level
        this.emit('link-available',
            fromUuid, link);

        log.log(log.DEBUG2, 'Creating endpoint: %s', fromUuid);
    }

    if (!endpoint.streams[link.getId()]) {
        // Add the stream to the endpoint
        endpoint.streams[link.getId()] = stream;

        // Add the stream to the endpoint
        endpoint.switchStream.addStream(stream, link.getCost(), link);
    }
    else {
        log.log(log.WARN, 'Received a duplicate connection from [link: %s] for [host: %s]; closing it!',
            link.getId(), fromUuid);
        stream.end();
    }

};

/**
 * Handles the disconnection from a specific link and Endpoint.js
 * @param link
 * @param stream
 * @param fromUuid
 * @private
 */
SwitchBoard.prototype._handleConnectionClose = function(link, fromUuid) {

    // Make sure it's valid.
    if (fromUuid == 'local' || fromUuid == this._id) {
        log.log(log.ERROR, 'Reserved link name used: local');
        return;
    }

    if (!this.hasEndpoint(fromUuid)) {
        log.log(log.ERROR, 'The given endpoint does not exist: %s', fromUuid);
        throw new Error('The given endpoint does not exist: ' + fromUuid);
    }

    var endpoint = this.getEndpoint(fromUuid);

    // Remove the stream from the switch stream
    endpoint.switchStream.removeStream(endpoint.streams[link.getId()]);

    // Remove the stream from the endpoint
    delete endpoint.streams[link.getId()];

    // If there is no active link for this link, then close it.
    if (endpoint.switchStream.getNumberStreams() === 0) {
        log.log(log.DEBUG2, 'Removing endpoint: %s', fromUuid);
        endpoint.switchStream.end();
        delete this._endpoints[fromUuid];

        // Report ourself to the higher level
        this.emit('link-unavailable', fromUuid, link);
    }
};

/**
 * When a new packet comes in from a switch stream, decide where to
 * relay it to.
 * @param stream
 * @private
 */
SwitchBoard.prototype._handleRawInbound = function(fromUuid, packet) {
    // Is this a routing packet?
    if (packet.p && this.hasHandler(packet.p)) {
        this.emit(packet.p, packet.m, fromUuid);
    }
    else {
        log.log(log.ERROR, 'Unknown packet type: [type: %s]',
            packet.p);
    }
};

/**
 * Send the given packet to the given switch stream.
 * @param toUuid
 * @param name
 * @param packet
 */
SwitchBoard.prototype.sendPacket = function(toUuid, name, packet) {
    if (this.hasHandler(name) && this.hasEndpoint(toUuid)) {
        var endpoint = this.getEndpoint(toUuid);
        var wrappedPacket = {
            p: name,
            m: packet
        };
        endpoint.switchStream.write(wrappedPacket);
    }
    else {
        log.log(log.WARN, 'Attempted to send a packet to unregistered handler or endpoint' +
            ' [handler: %s] [endpoint: %s]', name, toUuid);
    }
};

/**
 * Send the packet to all the adjacent internal links
 * @param packet
 * @private
 */
SwitchBoard.prototype.broadcastInternal = function(name, packet) {
    for (var fromUuid in this._endpoints) {
        var endpoint = this.getEndpoint(fromUuid);
        if (!endpoint.activeLink.isExternal()) {
            this.sendPacket(fromUuid, name, packet);
        }
    }
};

/**
 * Add the given handler to the switch-board.  This isn't really used
 * for any functional reason other than to ensure we only emit
 * packet events for handlers we know about.
 * @param name
 * @param handler
 */
SwitchBoard.prototype.addHandler = function(name) {
    this._handlers[name] = true;
    log.log(log.DEBUG, 'Added packet handler [name: %s]', name);
};

/**
 * Whether the given handler is registered
 * @param name
 */
SwitchBoard.prototype.hasHandler = function(name) {
    if (this._handlers[name]) {
        return true;
    }
    return false;
};

/**
 * Load the 'endpoint' information for this particular endpoint.js instance id.
 * @param fromUuid
 * @returns {*}
 * @private
 */
SwitchBoard.prototype.getEndpoint = function(fromUuid) {
    var endpoint = this._endpoints[fromUuid];
    return endpoint;
};

/**
 * Return the directory that has the list of links managed by this
 * switchboard. This will also allow the caller to add new links
 * @returns {*}
 */
SwitchBoard.prototype.getLinkDirectory = function() {
    return this._linkDirectory;
};

/**
 * Whether the uuid is registered as an endpoint in this Endpoint.js.
 * @param fromUuid
 * @returns {boolean}
 */
SwitchBoard.prototype.hasEndpoint = function(fromUuid) {
    if (this._endpoints[fromUuid]) {
        return true;
    }
    return false;
};

}).call(this,"/js\\app\\switching\\switch-board.js")
},{"../util/appUtils":54,"./switch-stream":49,"events":64,"util":92}],49:[function(require,module,exports){
(function (__filename){
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

var appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    linkStream = require('../streams/link-stream'),
    through2 = require('through2');

/**
 *  A switch stream will allow multiple input duplex
 *  streams to share the same output stream, based
 *  on the cost of that stream.
 *  @module switch-stream
 */
module.exports = function(opts) {

    var currentStream = null;
    var streams = [];

    var readStream = through2.obj();
    var writeStream = through2.obj(function(chunk, encoding, cb) {
        if (currentStream === null) {
            log.log(log.ERROR, 'No writable stream to pipe to!');
            throw new Error('No writable stream');
        }
        this.push(chunk);
        cb();
    });

    function switchStream() {
        // Find the best link.  Use <= here so that we always use
        // the newest lowest cost stream (in case a reconnection occurs)
        var lowest = null;
        streams.forEach(function(str) {
            if (lowest === null ||
                str.cost <= lowest.cost) {
                lowest = str;
            }
        });

        if (currentStream !== lowest) {
            if (currentStream !== null) {
                log.log(log.DEBUG3, 'Un-piping myself from existing stream');
                writeStream.unpipe(currentStream.stream);
                currentStream = null;
            }
            if (lowest !== null) {
                log.log(log.DEBUG2, 'Lower cost stream selected [new: %s]',
                    lowest.cost);
                currentStream = lowest;
                writeStream.pipe(currentStream.stream, {
                    end: false
                });
                // Tell the higher layer that we switched, and report the new cost.
                lnStrm.emit('switch', lowest.cost, lowest.meta);
            }
            else {
                // No streams!
                lnStrm.emit('switch-close');
            }
        }
    }

    var lnStrm = linkStream({
        readTransport: readStream,
        sendTransport: writeStream
    }, opts);

    // Add a stream and make it monitored
    lnStrm.addStream = function(stream, cost, meta) {

        // Push the send stream
        streams.push({
            stream: stream,
            cost: cost,
            meta: meta
        });

        // Pipe the stream to myself
        stream.pipe(readStream, {
            end: false
        });

        // Force a re-acquire
        switchStream();

        log.log(log.DEBUG2, 'Added stream to switch-stream [total: %s]', streams.length);

    };

    // Remove a stream from being monitored
    lnStrm.removeStream = function(stream) {
        for (var index = streams.length - 1; index > 0; index--) {
            if (streams[index].stream === stream) {
                break;
            }
        }
        if (index >= 0) {
            streams.splice(index, 1);

            // Unpipe
            stream.unpipe(readStream);

            // Force a re-acquire
            switchStream();

            log.log(log.DEBUG2, 'Removed stream from switch-stream [total: %s]', streams.length);
        }
        else {
            log.log(log.WARN, 'Tried to remove a stream from this switch-stream ' +
                'but that stream is not registered');
        }
    };

    // How many streams are being monitored.
    lnStrm.getNumberStreams = function() {
        return streams.length;
    };

    return lnStrm;
};

}).call(this,"/js\\app\\switching\\switch-stream.js")
},{"../streams/link-stream":42,"../util/appUtils":54,"through2":89}],50:[function(require,module,exports){
(function (__filename){
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

var Duplex = require('readable-stream').Duplex,
    inherits = require('util').inherits,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(LocalStorageTransport, Duplex);

module.exports = LocalStorageTransport;

/**
 * This transport reads events from a local storage 'key' value, and forwards
 * them as new 'connection' objects based on senderUuid.  This supports same
 * origin only for now, so no security measures are in place.
 * @augments Duplex
 * @param {Object} settings
 * @param {String} settings.channel - the specific localstorage key to use for message transfer
 * @param {Object} opts - Duplex options based to Duplex.
 * @constructor
 */
function LocalStorageTransport(settings, opts) {
    if (!(this instanceof LocalStorageTransport)) { return new LocalStorageTransport(settings, opts); }

    settings = settings || {};
    opts = opts || {};

    opts.objectMode = true;
    Duplex.call(this, opts);

    // Who are we listening to?
    this._channel = settings.channel || 'local-channel';

    this._localStorage = null;
    this._globalObject = appUtils.getGlobalObject();

    this._storageEventPtr = this._storageEvent.bind(this);
    this._localStorage = this._globalObject.localStorage;

    // When there is no more data to read.
    this.on('finish', function() {
        log.log(log.DEBUG2, 'Destructed LocalStorageTransport: [Channel: %s]',
            this._channel);
        this.close();
    }.bind(this));

    appUtils.addEventListener(this._globalObject, 'storage', this._storageEventPtr, false);

    log.log(log.DEBUG2, 'Initialized LocalStorageTransport: [Channel: %s]',
        this._channel);
}

/**
 * This function does nothing
 * @param n
 * @private
 */
LocalStorageTransport.prototype._read = function(n) {

};

/**
 * Event bound to (this) which executes when a storage event occurs.
 * We ignore events that aren't on our channel, or that are duplicates
 * @param event
 * @private
 */
LocalStorageTransport.prototype._storageEvent = function(event) {
    if (event.key !== this._channel) {
        return;
    }
    log.log(log.TRACE, 'Received message: [%s]', event.newValue);
    this.push(event.newValue);
};

/**
 * Implementation of the '_write' function from NodeJS Streams API
 * @param chunk - the data to write
 * @param encoding - ignored (since we're using chunks, not strings)
 * @param next - callback to tell the streams API we're done writing
 * @private
 */
LocalStorageTransport.prototype._write = function(chunk, encoding, next) {
    log.log(log.TRACE, 'Sending message: [%s]', chunk);
    this._localStorage.setItem(this._channel, chunk);
    next();
};

/**
 * Force unsubscribe from any event listeners for this target channel
 */
LocalStorageTransport.prototype.close = function() {
    appUtils.removeEventListener(this._globalObject, 'storage', this._storageEventPtr);
    this.end();
};

}).call(this,"/js\\app\\transport\\localstorage.js")
},{"../util/appUtils":54,"readable-stream":79,"util":92}],51:[function(require,module,exports){
(function (__filename){
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

var Readable = require('readable-stream').Readable,
    inherits = require('util').inherits,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(PostMessageReaderTransport, Readable);

module.exports = PostMessageReaderTransport;

/**
 * PostMessage stream multiplexer.  Emits 'streams' whenever a new uuid is
 * detected.  These streams never really pause, resume, end, etc, so they
 * are pseudo streams meant to be used by higher level protocols as a
 * transport layer. This only allows same domain for now
 * https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
 * @augments Readable
 * @param {Object} settings
 * @param {Object} settings.target - the object to subscribe to message event on
 * @param {String} settings.origin - the origin to accept messages from
 * @param {Boolean} settings.checkOrigin - only accept messages from settings.origin setting.
 * @param {Boolean} settings.preserveSource - emit data from this stream wrapped in an object that
 *   has the window source that sent the message
 * @param {Object} opts - Readable options based to Readable.
 * @constructor
 */
function PostMessageReaderTransport(settings, opts) {
    if (!(this instanceof PostMessageReaderTransport)) { return new PostMessageReaderTransport(settings, opts); }

    settings = settings || {};
    opts = opts || {};

    opts.objectMode = true;
    Readable.call(this, opts);

    // Who are we listening to?
    this._target = settings.target;
    this._origin = settings.origin || '';

    // Whether to transform the
    this._preserveSource = settings.hasOwnProperty('preserveSource') ?
        settings.preserveSource : false;

    // Whether to check against the 'settings' origin.
    this._checkOrigin = typeof settings.checkOrigin !== 'undefined' ? settings.checkOrigin : true;

    this._messageEventPtr = this._messageEvent.bind(this);

    appUtils.addEventListener(this._target, 'message', this._messageEventPtr);

    // When there is no more data to read.
    this.on('end', function() {
        log.log(log.DEBUG2, 'Destructed PostMessageReaderTransport');
        this.close();
    }.bind(this));

    log.log(log.DEBUG2, 'Initialized PostMessageReaderTransport: [Origin: %s] ' +
        '[Check Origin: %s]', this._origin, this._checkOrigin);
}

/**
 * This function does nothing
 * @param n
 * @private
 */
PostMessageReaderTransport.prototype._read = function(n) {

};

/**
 * Event bound to (this) which executes when a message event occurs.
 * @param event
 * @private
 */
PostMessageReaderTransport.prototype._messageEvent = function(event) {
    // Checks
    if (this._checkOrigin) {
        if (this._origin !== event.origin) {
            log.log(log.DEBUG3, 'Received message from invalid origin: [Origin: %s] [Expected Origin: %s] [Message: %j]',
                event.origin, this._origin, event.data);
            return;
        }
    }

    // Log and add to the buffer
    log.log(log.TRACE, 'Received message: [%s]', event.data);
    if (this._preserveSource) {
        this.push({
            source: event.source,
            origin: event.origin,
            msg: event.data
        });
    }
    else {
        this.push(event.data);
    }
};

/**
 * Force unsubscribe from any event listeners for this target
 */
PostMessageReaderTransport.prototype.close = function() {
    appUtils.removeEventListener(this._target, 'message', this._messageEventPtr);
    this.push(null);
};

}).call(this,"/js\\app\\transport\\postmessage-reader.js")
},{"../util/appUtils":54,"readable-stream":79,"util":92}],52:[function(require,module,exports){
(function (__filename){
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

var Writable = require('readable-stream').Writable,
    inherits = require('util').inherits,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(PostMessageSenderTransport, Writable);

module.exports = PostMessageSenderTransport;

/**
 * PostMessage stream multiplexer.  Emits 'streams' whenever a new uuid is
 * detected.  These streams never really pause, resume, end, etc, so they
 * are pseudo streams meant to be used by higher level protocols as a
 * transport layer. This only allows same domain for now
 * https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
 * @augments Writable
 * @param {Object} settings
 * @param {Object} settings.target - the object to post messages to
 * @param {String} settings.origin - the origin to specify when sending messages
 * @param {Boolean} settings.sendOrigin - whether to send origin or '*' in messages sent
 * @param {Object} opts - Writable options based to Writable.
 * @constructor
 */
function PostMessageSenderTransport(settings, opts) {
    if (!(this instanceof PostMessageSenderTransport)) { return new PostMessageSenderTransport(settings, opts); }

    settings = settings || {};
    opts = opts || {};

    opts.objectMode = true;
    Writable.call(this, opts);

    // Who are we listening to?
    this._target = settings.target;
    this._origin = settings.origin || '';

    // Whether to send the origin argument. (False for worker)
    this._sendOrigin = settings.hasOwnProperty('sendOrigin') ? settings.sendOrigin : true;

    log.log(log.DEBUG2, 'Initialized PostMessageSenderTransport: [Origin: %s] ' +
        '[Send Origin: %s]', this._origin, this._sendOrigin);
}

/**
 * Implementation of the '_write' function from NodeJS Streams API
 * @param chunk - the data to write
 * @param encoding - ignored (since we're using chunks, not strings)
 * @param next - callback to tell the streams API we're done writing
 * @private
 */
PostMessageSenderTransport.prototype._write = function(chunk, encoding, next) {
    log.log(log.TRACE, 'Sending message: [%s]', chunk);
    if (this._sendOrigin) {
        this._target.postMessage(chunk, this._origin);
    }
    else {
        this._target.postMessage(chunk);
    }
    next();
};

}).call(this,"/js\\app\\transport\\postmessage-sender.js")
},{"../util/appUtils":54,"readable-stream":79,"util":92}],53:[function(require,module,exports){
(function (__filename){
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

var Duplex = require('readable-stream').Duplex,
    inherits = require('util').inherits,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(SocketIoTransport, Duplex);

module.exports = SocketIoTransport;

/**
 * Socket.io browser transport will connect to a remote socket.io endpoint
 * and wrap it with a stream
 * @augments Duplex
 * @param {Object} settings
 * @param {String} settings.channel - socket.io channel to use
 * @param {String} settings.target - the socket.io socket to use
 * @param {Object} opts - Duplex options based to Duplex.
 * @constructor
 */
function SocketIoTransport(settings, opts) {
    if (!(this instanceof SocketIoTransport)) { return new SocketIoTransport(settings, opts); }

    settings = settings || {};
    opts = opts || {};

    opts.objectMode = true;
    Duplex.call(this, opts);

    // Who are we listening to?
    this._channel = settings.channel;
    this._target = settings.target;

    this._dataEventPtr = this._handleDataEvent.bind(this);
    this._target.on(this._channel, this._dataEventPtr);

    var _this = this;

    // When there is no more data to read.
    var endFunc = function() {
        if (_this._target !== null) {
            log.log(log.DEBUG2, 'Destructed SocketIoTransport: [Channel: %s]',
                _this._channel);
            _this._target.removeListener(_this._channel, _this._dataEventPtr);
            _this._target = null;
        }
    };
    this.on('end', endFunc);
    this.on('finish', endFunc);

    // If the host disconnects
    var closeFunc = function() {
        // Close the stream
        _this.push(null);
    };
    this._target.on('disconnect', closeFunc);

    log.log(log.DEBUG2, 'Initialized SocketIoTransport: [Channel: %s]',
        this._channel);
}

/**
 * This function does nothing
 * @param n
 * @private
 */
SocketIoTransport.prototype._read = function(n) {

};

/**
 * Event bound to (this) which executes when a storage event occurs.
 * We ignore events that aren't on our channel, or that are duplicates
 * @param event
 * @private
 */
SocketIoTransport.prototype._handleDataEvent = function(data) {
    log.log(log.TRACE, 'Received message: [%j]', data);
    this.push(data);
};

/**
 * Implementation of the '_write' function from NodeJS Streams API
 * @param chunk - the data to write
 * @param encoding - ignored (since we're using chunks, not strings)
 * @param next - callback to tell the streams API we're done writing
 * @private
 */
SocketIoTransport.prototype._write = function(chunk, encoding, next) {
    log.log(log.TRACE, 'Sending message: [%j]', chunk);
    if (this._target !== null) {
        this._target.emit(this._channel, chunk);
    }
    next();
};

/**
 * Force close the underlying socket
 */
SocketIoTransport.prototype.close = function() {
    this._target.disconnect();
};

}).call(this,"/js\\app\\transport\\socketio.js")
},{"../util/appUtils":54,"readable-stream":79,"util":92}],54:[function(require,module,exports){
(function (process,global){
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
/*globals global, process */
'use strict';

var logger = require('./logger').Logger,
    constants = require('./constants'),
    isString = require('util').isString;

/**
 * A set of utilities, such as creating loggers or setting the script name.  Also contains
 * event subscription utility functions.
 * @namespace
 * @property {String} _scriptName
 */
var appUtils = {

    /**
     * The name of the executing script, populated by loader.js
     */
    _scriptName: null,

    /**
     * This function will determine the Endpoint.js script name
     * @returns {*}
     */
    initScriptName: function() {
        if (!this._scriptName) {
            var wnd = this.getGlobalObject();
            if (wnd.document) {
                // The most recently executing script should be Endpoint.js.  Lets
                // get the address for it.
                var scripts = wnd.document.getElementsByTagName('script');
                var script = scripts[scripts.length - 1];
                this._scriptName = script.src;
            }
        }
    },

    /**
     * Ensure the UUID is the right size
     * @param uuid
     */
    isUuid: function(uuid) {
        if (isString(uuid) && uuid.length == 36) {
            return true;
        }
        return false;
    },

    /**
     * Ensure the External UUID is the right size
     * @param uuid
     */
    isExtUuid: function(uuid) {
        if (isString(uuid) && uuid.length == 40 && uuid.indexOf('-ext') === 36) {
            return true;
        }
        return false;
    },

    /**
     * Return the script name
     * @returns {string}
     */
    getScriptName: function() {
        return this._scriptName;
    },

    // This module returns a reference to the global (Window) object.
    // See the link below for an in depth explanation as to why this
    // is necessary.
    //
    // http://stackoverflow.com/questions/7290086/javascript-use-strict-and-nicks-find-global-function
    //
    // The gist is that:
    //
    // (1) we want to operate in strict mode at all times in all files
    // (2) outside of strict mode, 'this' would refer to the global
    //     Window object, but when running in strict mode, 'this' is
    //     undefined
    // (3) Because of RequireJS, we often wrap our code in a closure,
    //     which prevents some other popular techniques from working
    // (4) The approach below works in all Browsers, Engines, ES3,
    //     ES5, strict, nested scope, etc. and will pass JSHint/JSLint
    //
    getGlobalObject: function() {
        return global;
    },

    /**
     * Execute the given function on the next tick.
     * @param func
     */
    nextTick: function(func) {
        process.nextTick(func);
    },

    /**
     * __filename doesn't properly work in browserify on windows.
     * @param location
     * @returns {*}
     */
    getScriptBasename: function(location) {
        if (location &&
            typeof (location) == 'string' &&
            (location[0] == '/' || location[0] == '\\')) {
            location = location.replace(/\\/g, '/');
            var pieces = location.split('/');
            location = pieces[pieces.length - 1];
        }
        return location;
    },

    /**
     * This function will instantiate a logger and return it.
     * @param location
     */
    getLogger: function(location) {
        return logger(this.getScriptBasename(location));
    },

    /**
     * IE Safe event listener
     * @param event
     * @param cb
     * @param bubble
     */
    addEventListener: function(obj, event, cb, bubble) {
        if ('addEventListener' in obj) {
            obj.addEventListener(event, cb, bubble);
        }
        else {
            obj.attachEvent('on' + event, cb);
        }
    },

    /**
     * IE Safe event listener
     * @param event
     * @param cb
     * @param bubble
     */
    removeEventListener: function(obj, event, cb, bubble) {
        if ('removeEventListener' in obj) {
            obj.removeEventListener(event, cb, bubble);
        }
        else {
            obj.detachEvent('on' + event, cb);
        }
    },

    /**
     * Attempt to parse the neighborhood, and if undefined, use default.
     */
    getNeighborhood: function(specifiedNeighborhood, defaultNeighborhood) {
        var nDefault = constants.Neighborhood[(defaultNeighborhood + '').toUpperCase()];
        var nSpecified = constants.Neighborhood[(specifiedNeighborhood + '').toUpperCase()];
        return typeof (nSpecified) == 'undefined' ? nDefault : nSpecified;
    }

};

module.exports = appUtils;

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./constants":55,"./logger":57,"_process":71,"util":92}],55:[function(require,module,exports){
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
'use strict';

/**
 * Common constants used throughout the API.
 * @module
 */
module.exports = {

    /**
     * The valid types of endpoints within the system
     */
    EndpointType: {

        CLIENT: 'Client',

        CLIENT_INSTANCE: 'Client Instance',

        FACADE: 'Facade',

        ADAPTER: 'Adapter',

        OBJECT_INSTANCE: 'Object Instance',

        CALL: 'Call',

        QUERY: 'Query'

    },

    /**
     * The valid types of Links that can connect to
     * endpoints in the system
     */
    LinkType: {

        SERVER: 'server',

        WORKER: 'worker',

        TAB: 'tab',

        WINDOW: 'window'
    },

    /**
     * When a message is sent or received, this allows for determining
     * how wide to send it, or where it originated from.  These values
     * are set by the router as messages come in and leave the system.
     */
    Neighborhood: {

        UNIVERSAL: 3,

        GLOBAL: 2,

        GROUP: 1,

        LOCAL: 0
    }
};


},{}],56:[function(require,module,exports){
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
'use strict';

var periodicTimer = require('./periodic-timer'),
    inherits = require('util').inherits,
    EventEmitter = require('events').EventEmitter;

inherits(ExpirableHash, EventEmitter);

module.exports = ExpirableHash;

/**
 * A Javascript Hash object where the objects expire after a certain amount of
 * time in milliseconds
 * @constructor
 */
function ExpirableHash(duration, name) {
    if (!(this instanceof ExpirableHash)) { return new ExpirableHash(duration, name); }
    EventEmitter.call(this);
    this._duration = duration * 1000;
    this._items = 0;
    this._itemsArray = [];
    this._itemsHash = {};
    this._timer = periodicTimer(name || 'Expirable Hash', this._duration);
    this._timer.on('period', this._check.bind(this));
}

/**
 * Add a key to the dictionary
 * @param key
 * @param value
 */
ExpirableHash.prototype.add = function(key, value) {
    this._clean();
    this.remove(key);
    var item = {
        k: key,
        v: value,
        t: (new Date()).getTime() + this._duration
    };
    this._items += 1;
    this._itemsArray.push(item);
    this._itemsHash[key] = item;
    this._timer.addReference();
};

/**
 * Get a key from the dictionary.
 * @param key
 */
ExpirableHash.prototype.get = function(key) {
    // Check for expired keys
    this._check();
    var item = this._itemsHash[key];
    if (item) {
        return item.v;
    }
};

/**
 * Update the time value of the given key
 * @param key
 */
ExpirableHash.prototype.touch = function(key) {
    var val = this.get(key);
    if (val) {
        this.remove(key);
        this.add(key, val);
    }
};

/**
 * Remove a key from the dictionary
 * @param key
 */
ExpirableHash.prototype.remove = function(key) {
    var item = this._itemsHash[key];
    if (item) {
        this._items -= 1;
        item.v = item.k = null;
        item.t = 0;
        delete this._itemsHash[key];
        this._timer.removeReference();
    }
};

/**
 * Remove expired keys
 * @private
 */
ExpirableHash.prototype._check = function() {
    var now = (new Date()).getTime();
    while (this._itemsArray.length > 0) {
        var item = this._itemsArray[0];
        if (item.t > now) {
            break;
        }
        else if (item.t > 0) {
            this.emit('expired', item.k, item.v);
            this.remove(item.k);
        }
        this._itemsArray.shift();
    }
};

/**
 * Clean up the hash if the amount of dead items is double the
 * amount of items in the hash.  But only if the amount of items
 * is greater than 10.
 * @private
 */
ExpirableHash.prototype._clean = function() {
    if (this._itemsArray.length > 10 &&
        this._itemsArray.length > (this._items * 2)) {
        var newArray = [];
        this._itemsArray.forEach(function(item) {
            if (item.t > 0) {
                newArray.push(item);
            }
        });
        this._itemsArray = newArray;
    }
};

},{"./periodic-timer":58,"events":64,"util":92}],57:[function(require,module,exports){
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
'use strict';

var format = require('util').format;

module.exports = {
    Logger: Logger,
    logLevel: 'warn'
};

/**
 * This is a really basic logger module that passes through to
 * console.log depending on the log level.
 * @param {Object} location - a string or object name identifying log location
 * @constructor
 */
function Logger(location) {
    if (!(this instanceof Logger)) { return new Logger(location); }
    location = location || 'Unknown';

    var useLocation = 'Unknown';
    if (typeof (location) == 'string') {
        useLocation = location;
    }
    else if (typeof (location) == 'object') {
        if (location.constructor) {
            useLocation = location.constructor.name;
        }
    }

    this._location = location;
}

/**
 * Trace level
 * @type {string}
 */
Logger.prototype.TRACE = 'trace';

/**
 * Debug Level (3)
 * @type {string}
 */
Logger.prototype.DEBUG3 = 'debug3';

/**
 * Debug Level (2)
 * @type {string}
 */
Logger.prototype.DEBUG2 = 'debug2';

/**
 * Debug Level (1)
 * @type {string}
 */
Logger.prototype.DEBUG = 'debug';

/**
 * Info Level
 * @type {string}
 */
Logger.prototype.INFO = 'info';

/**
 * Warn Level
 * @type {string}
 */
Logger.prototype.WARN = 'warn';

/**
 * Error Level
 * @type {string}
 */
Logger.prototype.ERROR = 'error';

/**
 * None Level
 * @type {string}
 */
Logger.prototype.NONE = 'none';

/**
 * The priority of every log level
 * @type {{debug3: number, debug2: number, debug: number, info: number, warn: number, error: number}}
 */
Logger.prototype._LevelPriority = {
    trace: 8,
    debug3: 7,
    debug2: 6,
    debug: 5,
    info: 4,
    warn: 3,
    error: 2,
    none: 1
};

/**
 * Try to use this command on 'console' when logging
 * these items, if possible.
 */
Logger.prototype._ConsoleMap = {
    trace: 'debug',
    debug3: 'debug',
    debug2: 'debug',
    debug: 'debug',
    info: 'info',
    warn: 'warn',
    error: 'error'
};

/**
 * Function to log.  Additional arguments are treated as inputs
 * to util.format.
 * @param level
 * @param message
 */
Logger.prototype.log = function(level, message) {
    if (typeof (console) == 'undefined') {
        return;
    }
    if (!this._LevelPriority[level]) {
        level = this.DEBUG;
    }
    var currentPriority = this._LevelPriority[module.exports.logLevel];
    var inputPriority = this._LevelPriority[level];
    if (inputPriority <= currentPriority) {
        if (arguments.length > 2) {
            var args = Array.prototype.slice.call(arguments, 2);
            args.unshift(message);
            message = format.apply(format, args);
        }
        var date = new Date();
        var msg = format('%s:%s:%s - [%s] [%s] %s',
            date.getHours(), date.getMinutes(), date.getSeconds(),
            level, this._location, message);
        if (typeof (console[this._ConsoleMap[level]]) == 'function') {
            console[this._ConsoleMap[level]](msg);
        }
        else {
            console.log(msg);
        }
    }
};

},{"util":92}],58:[function(require,module,exports){
(function (__filename){
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
/* globals __filename, clearInterval, setInterval */

'use strict';

var appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    inherits = require('util').inherits,
    EventEmitter = require('events').EventEmitter;

inherits(PeriodicTimer, EventEmitter);

module.exports = PeriodicTimer;

/**
 * A periodic timer will execute the callback function, only if the
 * reference counter is greater than zero.  It will automatically
 * start/stop the interval timer based on the reference count.
 * @param {String} name - descriptive name
 * @param {Number} timeout - how long to set the interval for
 * @constructor
 */
function PeriodicTimer(name, timeout) {
    if (!(this instanceof PeriodicTimer)) { return new PeriodicTimer(name, timeout); }
    EventEmitter.call(this);
    this._name = name;
    this._timeout = timeout || 15000;
    this._references = 0;
    this._timerId = null;
}

/**
 * Returns the number of references in this periodic timer.
 */
PeriodicTimer.prototype.getReferenceCounter = function() {
    return this._references;
};

/**
 * Add a reference and start the timer (if necessary)
 */
PeriodicTimer.prototype.addReference = function() {
    this._references++;
    return this._checkTimer();
};

/**
 * Remove a reference and remove the timer (if necessary)
 */
PeriodicTimer.prototype.removeReference = function() {
    this._references--;
    return this._checkTimer();
};

/**
 * Start or stop the periodic timer based on the number of active
 * links
 * @private
 */
PeriodicTimer.prototype._checkTimer = function() {
    var reportTimerId = this._timerId;
    if (this._references === 0 && this._timerId !== null) {
        // Stop timer
        log.log(log.DEBUG2, 'Stopping [%s] interval timer: %s', this._name,
            this._timerId);
        clearInterval(this._timerId);
        this._timerId = null;
        this.emit('period', true);
    }
    else if (this._references > 0 && this._timerId === null) {
        this._timerId = setInterval(function() {
            this.emit('period');
        }.bind(this), this._timeout);
        log.log(log.DEBUG2, 'Starting [%s] interval timer: %s', this._name,
            this._timerId);
        reportTimerId = this._timerId;
    }
    return reportTimerId;
};

}).call(this,"/js\\app\\util\\periodic-timer.js")
},{"../util/appUtils":54,"events":64,"util":92}],59:[function(require,module,exports){
// jscs:disable

// Code here will be linted with JSHint.
/* jshint ignore:start */

/**
 * Various IE8 and Firefox 3.6 polyfills
 * @namespace polyfills
 */

/**
 * EMCAScript bind
 */
if (!Function.prototype.bind) {
    Function.prototype.bind = function(oThis) {
        if (typeof this !== 'function') {
            // closest thing possible to the ECMAScript 5
            // internal IsCallable function
            throw new TypeError('Function.prototype.bind - what is trying to be bound is not callable');
        }

        var aArgs   = Array.prototype.slice.call(arguments, 1),
            fToBind = this,
            fNOP    = function() {},
            fBound  = function() {
                return fToBind.apply(this instanceof fNOP
                    ? this
                    : oThis,
                    aArgs.concat(Array.prototype.slice.call(arguments)));
            };

        if (this.prototype) {
            // native functions don't have a prototype
            fNOP.prototype = this.prototype;
        }
        fBound.prototype = new fNOP();

        return fBound;
    };
}

// Production steps of ECMA-262, Edition 5, 15.4.4.18
// Reference: http://es5.github.io/#x15.4.4.18
if (!Array.prototype.forEach) {

    Array.prototype.forEach = function(callback, thisArg) {

        var T, k;

        if (this == null) {
            throw new TypeError(' this is null or not defined');
        }

        // 1. Let O be the result of calling ToObject passing the |this| value as the argument.
        var O = Object(this);

        // 2. Let lenValue be the result of calling the Get internal method of O with the argument "length".
        // 3. Let len be ToUint32(lenValue).
        var len = O.length >>> 0;

        // 4. If IsCallable(callback) is false, throw a TypeError exception.
        // See: http://es5.github.com/#x9.11
        if (typeof callback !== "function") {
            throw new TypeError(callback + ' is not a function');
        }

        // 5. If thisArg was supplied, let T be thisArg; else let T be undefined.
        if (arguments.length > 1) {
            T = thisArg;
        }

        // 6. Let k be 0
        k = 0;

        // 7. Repeat, while k < len
        while (k < len) {

            var kValue;

            // a. Let Pk be ToString(k).
            //   This is implicit for LHS operands of the in operator
            // b. Let kPresent be the result of calling the HasProperty internal method of O with argument Pk.
            //   This step can be combined with c
            // c. If kPresent is true, then
            if (k in O) {

                // i. Let kValue be the result of calling the Get internal method of O with argument Pk.
                kValue = O[k];

                // ii. Call the Call internal method of callback with T as the this value and
                // argument list containing kValue, k, and O.
                callback.call(T, kValue, k, O);
            }
            // d. Increase k by 1.
            k++;
        }
        // 8. return undefined
    };
}

// From https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/keys
if (!Object.keys) {
    Object.keys = (function() {
        'use strict';
        var hasOwnProperty = Object.prototype.hasOwnProperty,
            hasDontEnumBug = !({ toString: null }).propertyIsEnumerable('toString'),
            dontEnums = [
                'toString',
                'toLocaleString',
                'valueOf',
                'hasOwnProperty',
                'isPrototypeOf',
                'propertyIsEnumerable',
                'constructor'
            ],
            dontEnumsLength = dontEnums.length;

        return function(obj) {
            if (typeof obj !== 'object' && (typeof obj !== 'function' || obj === null)) {
                throw new TypeError('Object.keys called on non-object');
            }

            var result = [], prop, i;

            for (prop in obj) {
                if (hasOwnProperty.call(obj, prop)) {
                    result.push(prop);
                }
            }

            if (hasDontEnumBug) {
                for (i = 0; i < dontEnumsLength; i++) {
                    if (hasOwnProperty.call(obj, dontEnums[i])) {
                        result.push(dontEnums[i]);
                    }
                }
            }
            return result;
        };
    }());
}

// Production steps of ECMA-262, Edition 5, 15.4.4.14
// Reference: http://es5.github.io/#x15.4.4.14
if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function(searchElement, fromIndex) {

        var k;

        // 1. Let O be the result of calling ToObject passing
        //    the this value as the argument.
        if (this == null) {
            throw new TypeError('"this" is null or not defined');
        }

        var O = Object(this);

        // 2. Let lenValue be the result of calling the Get
        //    internal method of O with the argument "length".
        // 3. Let len be ToUint32(lenValue).
        var len = O.length >>> 0;

        // 4. If len is 0, return -1.
        if (len === 0) {
            return -1;
        }

        // 5. If argument fromIndex was passed let n be
        //    ToInteger(fromIndex); else let n be 0.
        var n = +fromIndex || 0;

        if (Math.abs(n) === Infinity) {
            n = 0;
        }

        // 6. If n >= len, return -1.
        if (n >= len) {
            return -1;
        }

        // 7. If n >= 0, then Let k be n.
        // 8. Else, n<0, Let k be len - abs(n).
        //    If k is less than 0, then let k be 0.
        k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);

        // 9. Repeat, while k < len
        while (k < len) {
            // a. Let Pk be ToString(k).
            //   This is implicit for LHS operands of the in operator
            // b. Let kPresent be the result of calling the
            //    HasProperty internal method of O with argument Pk.
            //   This step can be combined with c
            // c. If kPresent is true, then
            //    i.  Let elementK be the result of calling the Get
            //        internal method of O with the argument ToString(k).
            //   ii.  Let same be the result of applying the
            //        Strict Equality Comparison Algorithm to
            //        searchElement and elementK.
            //  iii.  If same is true, return k.
            if (k in O && O[k] === searchElement) {
                return k;
            }
            k++;
        }
        return -1;
    };
}

// Window.origin polyfill
if (typeof(window) !== 'undefined' && window.location && !window.location.origin) {
    window.location.origin = window.location.protocol + "//" + window.location.hostname +
        (window.location.port ? ':' + window.location.port: '');
}

// Code here will be linted with ignored by JSHint.
/* jshint ignore:end */

},{}],60:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],61:[function(require,module,exports){

},{}],62:[function(require,module,exports){
(function (global){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('isarray')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Safari 5-7 lacks support for changing the `Object.prototype.constructor` property
 *     on objects.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined
  ? global.TYPED_ARRAY_SUPPORT
  : typedArraySupport()

function typedArraySupport () {
  function Bar () {}
  try {
    var arr = new Uint8Array(1)
    arr.foo = function () { return 42 }
    arr.constructor = Bar
    return arr.foo() === 42 && // typed array instances can be augmented
        arr.constructor === Bar && // constructor can be set
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
}

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    this.length = 0
    this.parent = undefined
  }

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    array.byteLength
    that = Buffer._augment(new Uint8Array(array))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
} else {
  // pre-set for values that may exist in the future
  Buffer.prototype.length = undefined
  Buffer.prototype.parent = undefined
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` is deprecated
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` is deprecated
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = (value & 0xff)
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"base64-js":60,"ieee754":65,"isarray":68}],63:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.

function isArray(arg) {
  if (Array.isArray) {
    return Array.isArray(arg);
  }
  return objectToString(arg) === '[object Array]';
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = Buffer.isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}

}).call(this,{"isBuffer":require("../../is-buffer/index.js")})
},{"../../is-buffer/index.js":67}],64:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],65:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],66:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],67:[function(require,module,exports){
/**
 * Determine if an object is Buffer
 *
 * Author:   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * License:  MIT
 *
 * `npm install is-buffer`
 */

module.exports = function (obj) {
  return !!(obj != null &&
    (obj._isBuffer || // For Safari 5-7 (missing Object.prototype.constructor)
      (obj.constructor &&
      typeof obj.constructor.isBuffer === 'function' &&
      obj.constructor.isBuffer(obj))
    ))
}

},{}],68:[function(require,module,exports){
var toString = {}.toString;

module.exports = Array.isArray || function (arr) {
  return toString.call(arr) == '[object Array]';
};

},{}],69:[function(require,module,exports){
//     uuid.js
//
//     Copyright (c) 2010-2012 Robert Kieffer
//     MIT License - http://opensource.org/licenses/mit-license.php

(function() {
  var _global = this;

  // Unique ID creation requires a high quality random # generator.  We feature
  // detect to determine the best RNG source, normalizing to a function that
  // returns 128-bits of randomness, since that's what's usually required
  var _rng;

  // Node.js crypto-based RNG - http://nodejs.org/docs/v0.6.2/api/crypto.html
  //
  // Moderately fast, high quality
  if (typeof(_global.require) == 'function') {
    try {
      var _rb = _global.require('crypto').randomBytes;
      _rng = _rb && function() {return _rb(16);};
    } catch(e) {}
  }

  if (!_rng && _global.crypto && crypto.getRandomValues) {
    // WHATWG crypto-based RNG - http://wiki.whatwg.org/wiki/Crypto
    //
    // Moderately fast, high quality
    var _rnds8 = new Uint8Array(16);
    _rng = function whatwgRNG() {
      crypto.getRandomValues(_rnds8);
      return _rnds8;
    };
  }

  if (!_rng) {
    // Math.random()-based (RNG)
    //
    // If all else fails, use Math.random().  It's fast, but is of unspecified
    // quality.
    var  _rnds = new Array(16);
    _rng = function() {
      for (var i = 0, r; i < 16; i++) {
        if ((i & 0x03) === 0) r = Math.random() * 0x100000000;
        _rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
      }

      return _rnds;
    };
  }

  // Buffer class to use
  var BufferClass = typeof(_global.Buffer) == 'function' ? _global.Buffer : Array;

  // Maps for number <-> hex string conversion
  var _byteToHex = [];
  var _hexToByte = {};
  for (var i = 0; i < 256; i++) {
    _byteToHex[i] = (i + 0x100).toString(16).substr(1);
    _hexToByte[_byteToHex[i]] = i;
  }

  // **`parse()` - Parse a UUID into it's component bytes**
  function parse(s, buf, offset) {
    var i = (buf && offset) || 0, ii = 0;

    buf = buf || [];
    s.toLowerCase().replace(/[0-9a-f]{2}/g, function(oct) {
      if (ii < 16) { // Don't overflow!
        buf[i + ii++] = _hexToByte[oct];
      }
    });

    // Zero out remaining bytes if string was short
    while (ii < 16) {
      buf[i + ii++] = 0;
    }

    return buf;
  }

  // **`unparse()` - Convert UUID byte array (ala parse()) into a string**
  function unparse(buf, offset) {
    var i = offset || 0, bth = _byteToHex;
    return  bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]];
  }

  // **`v1()` - Generate time-based UUID**
  //
  // Inspired by https://github.com/LiosK/UUID.js
  // and http://docs.python.org/library/uuid.html

  // random #'s we need to init node and clockseq
  var _seedBytes = _rng();

  // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
  var _nodeId = [
    _seedBytes[0] | 0x01,
    _seedBytes[1], _seedBytes[2], _seedBytes[3], _seedBytes[4], _seedBytes[5]
  ];

  // Per 4.2.2, randomize (14 bit) clockseq
  var _clockseq = (_seedBytes[6] << 8 | _seedBytes[7]) & 0x3fff;

  // Previous uuid creation time
  var _lastMSecs = 0, _lastNSecs = 0;

  // See https://github.com/broofa/node-uuid for API details
  function v1(options, buf, offset) {
    var i = buf && offset || 0;
    var b = buf || [];

    options = options || {};

    var clockseq = options.clockseq != null ? options.clockseq : _clockseq;

    // UUID timestamps are 100 nano-second units since the Gregorian epoch,
    // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
    // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
    // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
    var msecs = options.msecs != null ? options.msecs : new Date().getTime();

    // Per 4.2.1.2, use count of uuid's generated during the current clock
    // cycle to simulate higher resolution clock
    var nsecs = options.nsecs != null ? options.nsecs : _lastNSecs + 1;

    // Time since last uuid creation (in msecs)
    var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

    // Per 4.2.1.2, Bump clockseq on clock regression
    if (dt < 0 && options.clockseq == null) {
      clockseq = clockseq + 1 & 0x3fff;
    }

    // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
    // time interval
    if ((dt < 0 || msecs > _lastMSecs) && options.nsecs == null) {
      nsecs = 0;
    }

    // Per 4.2.1.2 Throw error if too many uuids are requested
    if (nsecs >= 10000) {
      throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
    }

    _lastMSecs = msecs;
    _lastNSecs = nsecs;
    _clockseq = clockseq;

    // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
    msecs += 12219292800000;

    // `time_low`
    var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
    b[i++] = tl >>> 24 & 0xff;
    b[i++] = tl >>> 16 & 0xff;
    b[i++] = tl >>> 8 & 0xff;
    b[i++] = tl & 0xff;

    // `time_mid`
    var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
    b[i++] = tmh >>> 8 & 0xff;
    b[i++] = tmh & 0xff;

    // `time_high_and_version`
    b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
    b[i++] = tmh >>> 16 & 0xff;

    // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
    b[i++] = clockseq >>> 8 | 0x80;

    // `clock_seq_low`
    b[i++] = clockseq & 0xff;

    // `node`
    var node = options.node || _nodeId;
    for (var n = 0; n < 6; n++) {
      b[i + n] = node[n];
    }

    return buf ? buf : unparse(b);
  }

  // **`v4()` - Generate random UUID**

  // See https://github.com/broofa/node-uuid for API details
  function v4(options, buf, offset) {
    // Deprecated - 'format' argument, as supported in v1.2
    var i = buf && offset || 0;

    if (typeof(options) == 'string') {
      buf = options == 'binary' ? new BufferClass(16) : null;
      options = null;
    }
    options = options || {};

    var rnds = options.random || (options.rng || _rng)();

    // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
    rnds[6] = (rnds[6] & 0x0f) | 0x40;
    rnds[8] = (rnds[8] & 0x3f) | 0x80;

    // Copy bytes to buffer, if provided
    if (buf) {
      for (var ii = 0; ii < 16; ii++) {
        buf[i + ii] = rnds[ii];
      }
    }

    return buf || unparse(rnds);
  }

  // Export public API
  var uuid = v4;
  uuid.v1 = v1;
  uuid.v4 = v4;
  uuid.parse = parse;
  uuid.unparse = unparse;
  uuid.BufferClass = BufferClass;

  if (typeof(module) != 'undefined' && module.exports) {
    // Publish as node.js module
    module.exports = uuid;
  } else  if (typeof define === 'function' && define.amd) {
    // Publish as AMD module
    define(function() {return uuid;});
 

  } else {
    // Publish as global (in browsers)
    var _previousRoot = _global.uuid;

    // **`noConflict()` - (browser only) to reset global 'uuid' var**
    uuid.noConflict = function() {
      _global.uuid = _previousRoot;
      return uuid;
    };

    _global.uuid = uuid;
  }
}).call(this);

},{}],70:[function(require,module,exports){
(function (process){
'use strict';

if (!process.version ||
    process.version.indexOf('v0.') === 0 ||
    process.version.indexOf('v1.') === 0 && process.version.indexOf('v1.8.') !== 0) {
  module.exports = nextTick;
} else {
  module.exports = process.nextTick;
}

function nextTick(fn) {
  var args = new Array(arguments.length - 1);
  var i = 0;
  while (i < args.length) {
    args[i++] = arguments[i];
  }
  process.nextTick(function afterTick() {
    fn.apply(null, args);
  });
}

}).call(this,require('_process'))
},{"_process":71}],71:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],72:[function(require,module,exports){
module.exports = require("./lib/_stream_duplex.js")

},{"./lib/_stream_duplex.js":73}],73:[function(require,module,exports){
// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

'use strict';

/*<replacement>*/

var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) {
    keys.push(key);
  }return keys;
};
/*</replacement>*/

module.exports = Duplex;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

var keys = objectKeys(Writable.prototype);
for (var v = 0; v < keys.length; v++) {
  var method = keys[v];
  if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
}

function Duplex(options) {
  if (!(this instanceof Duplex)) return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false) this.readable = false;

  if (options && options.writable === false) this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false) this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended) return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  processNextTick(onEndNT, this);
}

function onEndNT(self) {
  self.end();
}

function forEach(xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}
},{"./_stream_readable":75,"./_stream_writable":77,"core-util-is":63,"inherits":66,"process-nextick-args":70}],74:[function(require,module,exports){
// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

'use strict';

module.exports = PassThrough;

var Transform = require('./_stream_transform');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough)) return new PassThrough(options);

  Transform.call(this, options);
}

PassThrough.prototype._transform = function (chunk, encoding, cb) {
  cb(null, chunk);
};
},{"./_stream_transform":76,"core-util-is":63,"inherits":66}],75:[function(require,module,exports){
(function (process){
'use strict';

module.exports = Readable;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/

/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Readable.ReadableState = ReadableState;

var EE = require('events');

/*<replacement>*/
var EElistenerCount = function (emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/

/*<replacement>*/
var Stream;
(function () {
  try {
    Stream = require('st' + 'ream');
  } catch (_) {} finally {
    if (!Stream) Stream = require('events').EventEmitter;
  }
})();
/*</replacement>*/

var Buffer = require('buffer').Buffer;

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

/*<replacement>*/
var debugUtil = require('util');
var debug = undefined;
if (debugUtil && debugUtil.debuglog) {
  debug = debugUtil.debuglog('stream');
} else {
  debug = function () {};
}
/*</replacement>*/

var StringDecoder;

util.inherits(Readable, Stream);

var Duplex;
function ReadableState(options, stream) {
  Duplex = Duplex || require('./_stream_duplex');

  options = options || {};

  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.readableObjectMode;

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~ ~this.highWaterMark;

  this.buffer = [];
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;
  this.resumeScheduled = false;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

var Duplex;
function Readable(options) {
  Duplex = Duplex || require('./_stream_duplex');

  if (!(this instanceof Readable)) return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  if (options && typeof options.read === 'function') this._read = options.read;

  Stream.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function (chunk, encoding) {
  var state = this._readableState;

  if (!state.objectMode && typeof chunk === 'string') {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = new Buffer(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function (chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

Readable.prototype.isPaused = function () {
  return this._readableState.flowing === false;
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var e = new Error('stream.unshift() after end event');
      stream.emit('error', e);
    } else {
      var skipAdd;
      if (state.decoder && !addToFront && !encoding) {
        chunk = state.decoder.write(chunk);
        skipAdd = !state.objectMode && chunk.length === 0;
      }

      if (!addToFront) state.reading = false;

      // Don't add to the buffer if we've decoded to an empty string chunk and
      // we're not in object mode
      if (!skipAdd) {
        // if we want the data now, just emit it.
        if (state.flowing && state.length === 0 && !state.sync) {
          stream.emit('data', chunk);
          stream.read(0);
        } else {
          // update the buffer info.
          state.length += state.objectMode ? 1 : chunk.length;
          if (addToFront) state.buffer.unshift(chunk);else state.buffer.push(chunk);

          if (state.needReadable) emitReadable(stream);
        }
      }

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}

// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended && (state.needReadable || state.length < state.highWaterMark || state.length === 0);
}

// backwards compatibility.
Readable.prototype.setEncoding = function (enc) {
  if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
  return this;
};

// Don't raise the hwm > 8MB
var MAX_HWM = 0x800000;
function computeNewHighWaterMark(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2
    n--;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    n++;
  }
  return n;
}

function howMuchToRead(n, state) {
  if (state.length === 0 && state.ended) return 0;

  if (state.objectMode) return n === 0 ? 0 : 1;

  if (n === null || isNaN(n)) {
    // only flow one buffer at a time
    if (state.flowing && state.buffer.length) return state.buffer[0].length;else return state.length;
  }

  if (n <= 0) return 0;

  // If we're asking for more than the target buffer level,
  // then raise the water mark.  Bump up to the next highest
  // power of 2, to prevent increasing it excessively in tiny
  // amounts.
  if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);

  // don't have that much.  return null, unless we've ended.
  if (n > state.length) {
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    } else {
      return state.length;
    }
  }

  return n;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function (n) {
  debug('read', n);
  var state = this._readableState;
  var nOrig = n;

  if (typeof n !== 'number' || n > 0) state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 && state.needReadable && (state.length >= state.highWaterMark || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended) endReadable(this);else emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    if (state.length === 0) endReadable(this);
    return null;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;
  debug('need readable', doRead);

  // if we currently have less than the highWaterMark, then also read some
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  }

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  }

  if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0) state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
  }

  // If _read pushed data synchronously, then `reading` will be false,
  // and we need to re-evaluate how much data we can return to the user.
  if (doRead && !state.reading) n = howMuchToRead(nOrig, state);

  var ret;
  if (n > 0) ret = fromList(n, state);else ret = null;

  if (ret === null) {
    state.needReadable = true;
    n = 0;
  }

  state.length -= n;

  // If we have nothing in the buffer, then we want to know
  // as soon as we *do* get something into the buffer.
  if (state.length === 0 && !state.ended) state.needReadable = true;

  // If we tried to read() past the EOF, then emit end on the next tick.
  if (nOrig !== n && state.ended && state.length === 0) endReadable(this);

  if (ret !== null) this.emit('data', ret);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && chunk !== null && chunk !== undefined && !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}

function onEofChunk(stream, state) {
  if (state.ended) return;
  if (state.decoder) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // emit 'readable' now to make sure it gets picked up.
  emitReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    if (state.sync) processNextTick(emitReadable_, stream);else emitReadable_(stream);
  }
}

function emitReadable_(stream) {
  debug('emit readable');
  stream.emit('readable');
  flow(stream);
}

// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    processNextTick(maybeReadMore_, stream, state);
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended && state.length < state.highWaterMark) {
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;else len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function (n) {
  this.emit('error', new Error('not implemented'));
};

Readable.prototype.pipe = function (dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

  var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted) processNextTick(endFn);else src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    debug('onunpipe');
    if (readable === src) {
      cleanup();
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  var cleanedUp = false;
  function cleanup() {
    debug('cleanup');
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);
    src.removeListener('data', ondata);

    cleanedUp = true;

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
  }

  src.on('data', ondata);
  function ondata(chunk) {
    debug('ondata');
    var ret = dest.write(chunk);
    if (false === ret) {
      // If the user unpiped during `dest.write()`, it is possible
      // to get stuck in a permanently paused state if that write
      // also returned false.
      if (state.pipesCount === 1 && state.pipes[0] === dest && src.listenerCount('data') === 1 && !cleanedUp) {
        debug('false write response, pause', src._readableState.awaitDrain);
        src._readableState.awaitDrain++;
      }
      src.pause();
    }
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (EElistenerCount(dest, 'error') === 0) dest.emit('error', er);
  }
  // This is a brutally ugly hack to make sure that our error handler
  // is attached before any userland ones.  NEVER DO THIS.
  if (!dest._events || !dest._events.error) dest.on('error', onerror);else if (isArray(dest._events.error)) dest._events.error.unshift(onerror);else dest._events.error = [onerror, dest._events.error];

  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function () {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain) state.awaitDrain--;
    if (state.awaitDrain === 0 && EElistenerCount(src, 'data')) {
      state.flowing = true;
      flow(src);
    }
  };
}

Readable.prototype.unpipe = function (dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0) return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes) return this;

    if (!dest) dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest) dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var _i = 0; _i < len; _i++) {
      dests[_i].emit('unpipe', this);
    }return this;
  }

  // try to find the right one.
  var i = indexOf(state.pipes, dest);
  if (i === -1) return this;

  state.pipes.splice(i, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1) state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function (ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  // If listening to data, and it has not explicitly been paused,
  // then call resume to start the flow of data on the next tick.
  if (ev === 'data' && false !== this._readableState.flowing) {
    this.resume();
  }

  if (ev === 'readable' && !this._readableState.endEmitted) {
    var state = this._readableState;
    if (!state.readableListening) {
      state.readableListening = true;
      state.emittedReadable = false;
      state.needReadable = true;
      if (!state.reading) {
        processNextTick(nReadingNextTick, this);
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

function nReadingNextTick(self) {
  debug('readable nexttick read 0');
  self.read(0);
}

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function () {
  var state = this._readableState;
  if (!state.flowing) {
    debug('resume');
    state.flowing = true;
    resume(this, state);
  }
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    processNextTick(resume_, stream, state);
  }
}

function resume_(stream, state) {
  if (!state.reading) {
    debug('resume read 0');
    stream.read(0);
  }

  state.resumeScheduled = false;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading) stream.read(0);
}

Readable.prototype.pause = function () {
  debug('call pause flowing=%j', this._readableState.flowing);
  if (false !== this._readableState.flowing) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);
  if (state.flowing) {
    do {
      var chunk = stream.read();
    } while (null !== chunk && state.flowing);
  }
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function (stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function () {
    debug('wrapped end');
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length) self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function (chunk) {
    debug('wrapped data');
    if (state.decoder) chunk = state.decoder.write(chunk);

    // don't skip over falsy values in objectMode
    if (state.objectMode && (chunk === null || chunk === undefined)) return;else if (!state.objectMode && (!chunk || !chunk.length)) return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (this[i] === undefined && typeof stream[i] === 'function') {
      this[i] = function (method) {
        return function () {
          return stream[method].apply(stream, arguments);
        };
      }(i);
    }
  }

  // proxy certain important events.
  var events = ['error', 'close', 'destroy', 'pause', 'resume'];
  forEach(events, function (ev) {
    stream.on(ev, self.emit.bind(self, ev));
  });

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function (n) {
    debug('wrapped _read', n);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};

// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
function fromList(n, state) {
  var list = state.buffer;
  var length = state.length;
  var stringMode = !!state.decoder;
  var objectMode = !!state.objectMode;
  var ret;

  // nothing in the list, definitely empty.
  if (list.length === 0) return null;

  if (length === 0) ret = null;else if (objectMode) ret = list.shift();else if (!n || n >= length) {
    // read it all, truncate the array.
    if (stringMode) ret = list.join('');else if (list.length === 1) ret = list[0];else ret = Buffer.concat(list, length);
    list.length = 0;
  } else {
    // read just some of it.
    if (n < list[0].length) {
      // just take a part of the first list item.
      // slice is the same for buffers and strings.
      var buf = list[0];
      ret = buf.slice(0, n);
      list[0] = buf.slice(n);
    } else if (n === list[0].length) {
      // first list is a perfect match
      ret = list.shift();
    } else {
      // complex case.
      // we have enough to cover it, but it spans past the first buffer.
      if (stringMode) ret = '';else ret = new Buffer(n);

      var c = 0;
      for (var i = 0, l = list.length; i < l && c < n; i++) {
        var buf = list[0];
        var cpy = Math.min(n - c, buf.length);

        if (stringMode) ret += buf.slice(0, cpy);else buf.copy(ret, c, 0, cpy);

        if (cpy < buf.length) list[0] = buf.slice(cpy);else list.shift();

        c += cpy;
      }
    }
  }

  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0) throw new Error('endReadable called on non-empty stream');

  if (!state.endEmitted) {
    state.ended = true;
    processNextTick(endReadableNT, state, stream);
  }
}

function endReadableNT(state, stream) {
  // Check that we didn't get one last unshift.
  if (!state.endEmitted && state.length === 0) {
    state.endEmitted = true;
    stream.readable = false;
    stream.emit('end');
  }
}

function forEach(xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf(xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}
}).call(this,require('_process'))
},{"./_stream_duplex":73,"_process":71,"buffer":62,"core-util-is":63,"events":64,"inherits":66,"isarray":68,"process-nextick-args":70,"string_decoder/":83,"util":61}],76:[function(require,module,exports){
// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

'use strict';

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);

function TransformState(stream) {
  this.afterTransform = function (er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
  this.writeencoding = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb) return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (data !== null && data !== undefined) stream.push(data);

  cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}

function Transform(options) {
  if (!(this instanceof Transform)) return new Transform(options);

  Duplex.call(this, options);

  this._transformState = new TransformState(this);

  // when the writable side finishes, then flush out anything remaining.
  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  if (options) {
    if (typeof options.transform === 'function') this._transform = options.transform;

    if (typeof options.flush === 'function') this._flush = options.flush;
  }

  this.once('prefinish', function () {
    if (typeof this._flush === 'function') this._flush(function (er) {
      done(stream, er);
    });else done(stream);
  });
}

Transform.prototype.push = function (chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function (chunk, encoding, cb) {
  throw new Error('not implemented');
};

Transform.prototype._write = function (chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function (n) {
  var ts = this._transformState;

  if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};

function done(stream, er) {
  if (er) return stream.emit('error', er);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var ts = stream._transformState;

  if (ws.length) throw new Error('calling transform done when ws.length != 0');

  if (ts.transforming) throw new Error('calling transform done when still transforming');

  return stream.push(null);
}
},{"./_stream_duplex":73,"core-util-is":63,"inherits":66}],77:[function(require,module,exports){
// A bit simpler than readable streams.
// Implement an async ._write(chunk, encoding, cb), and it'll handle all
// the drain event emission and buffering.

'use strict';

module.exports = Writable;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var asyncWrite = !true ? setImmediate : processNextTick;
/*</replacement>*/

/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Writable.WritableState = WritableState;

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

/*<replacement>*/
var internalUtil = {
  deprecate: require('util-deprecate')
};
/*</replacement>*/

/*<replacement>*/
var Stream;
(function () {
  try {
    Stream = require('st' + 'ream');
  } catch (_) {} finally {
    if (!Stream) Stream = require('events').EventEmitter;
  }
})();
/*</replacement>*/

var Buffer = require('buffer').Buffer;

util.inherits(Writable, Stream);

function nop() {}

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
  this.next = null;
}

var Duplex;
function WritableState(options, stream) {
  Duplex = Duplex || require('./_stream_duplex');

  options = options || {};

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.writableObjectMode;

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~ ~this.highWaterMark;

  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // when true all writes will be buffered until .uncork() call
  this.corked = 0;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function (er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.bufferedRequest = null;
  this.lastBufferedRequest = null;

  // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted
  this.pendingcb = 0;

  // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams
  this.prefinished = false;

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;

  // count buffered requests
  this.bufferedRequestCount = 0;

  // create the two objects needed to store the corked requests
  // they are not a linked list, as no new elements are inserted in there
  this.corkedRequestsFree = new CorkedRequest(this);
  this.corkedRequestsFree.next = new CorkedRequest(this);
}

WritableState.prototype.getBuffer = function writableStateGetBuffer() {
  var current = this.bufferedRequest;
  var out = [];
  while (current) {
    out.push(current);
    current = current.next;
  }
  return out;
};

(function () {
  try {
    Object.defineProperty(WritableState.prototype, 'buffer', {
      get: internalUtil.deprecate(function () {
        return this.getBuffer();
      }, '_writableState.buffer is deprecated. Use _writableState.getBuffer ' + 'instead.')
    });
  } catch (_) {}
})();

var Duplex;
function Writable(options) {
  Duplex = Duplex || require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, though they're not
  // instanceof Writable, they're instanceof Readable.
  if (!(this instanceof Writable) && !(this instanceof Duplex)) return new Writable(options);

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  if (options) {
    if (typeof options.write === 'function') this._write = options.write;

    if (typeof options.writev === 'function') this._writev = options.writev;
  }

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function () {
  this.emit('error', new Error('Cannot pipe. Not readable.'));
};

function writeAfterEnd(stream, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  processNextTick(cb, er);
}

// If we get something that is not a buffer, string, null, or undefined,
// and we're not in objectMode, then that's an error.
// Otherwise stream chunks are all considered to be of length=1, and the
// watermarks determine how many objects to keep in the buffer, rather than
// how many bytes or characters.
function validChunk(stream, state, chunk, cb) {
  var valid = true;

  if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && chunk !== null && chunk !== undefined && !state.objectMode) {
    var er = new TypeError('Invalid non-string/buffer chunk');
    stream.emit('error', er);
    processNextTick(cb, er);
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function (chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (Buffer.isBuffer(chunk)) encoding = 'buffer';else if (!encoding) encoding = state.defaultEncoding;

  if (typeof cb !== 'function') cb = nop;

  if (state.ended) writeAfterEnd(this, cb);else if (validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, chunk, encoding, cb);
  }

  return ret;
};

Writable.prototype.cork = function () {
  var state = this._writableState;

  state.corked++;
};

Writable.prototype.uncork = function () {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.writing && !state.corked && !state.finished && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
  }
};

Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
  // node::ParseEncoding() requires lower case.
  if (typeof encoding === 'string') encoding = encoding.toLowerCase();
  if (!(['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le', 'raw'].indexOf((encoding + '').toLowerCase()) > -1)) throw new TypeError('Unknown encoding: ' + encoding);
  this._writableState.defaultEncoding = encoding;
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode && state.decodeStrings !== false && typeof chunk === 'string') {
    chunk = new Buffer(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, chunk, encoding, cb) {
  chunk = decodeChunk(state, chunk, encoding);

  if (Buffer.isBuffer(chunk)) encoding = 'buffer';
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret) state.needDrain = true;

  if (state.writing || state.corked) {
    var last = state.lastBufferedRequest;
    state.lastBufferedRequest = new WriteReq(chunk, encoding, cb);
    if (last) {
      last.next = state.lastBufferedRequest;
    } else {
      state.bufferedRequest = state.lastBufferedRequest;
    }
    state.bufferedRequestCount += 1;
  } else {
    doWrite(stream, state, false, len, chunk, encoding, cb);
  }

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (writev) stream._writev(chunk, state.onwrite);else stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  --state.pendingcb;
  if (sync) processNextTick(cb, er);else cb(er);

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er) onwriteError(stream, state, sync, er, cb);else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(state);

    if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
      clearBuffer(stream, state);
    }

    if (sync) {
      /*<replacement>*/
      asyncWrite(afterWrite, stream, state, finished, cb);
      /*</replacement>*/
    } else {
        afterWrite(stream, state, finished, cb);
      }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished) onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}

// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;
  var entry = state.bufferedRequest;

  if (stream._writev && entry && entry.next) {
    // Fast case, write everything using _writev()
    var l = state.bufferedRequestCount;
    var buffer = new Array(l);
    var holder = state.corkedRequestsFree;
    holder.entry = entry;

    var count = 0;
    while (entry) {
      buffer[count] = entry;
      entry = entry.next;
      count += 1;
    }

    doWrite(stream, state, true, state.length, buffer, '', holder.finish);

    // doWrite is always async, defer these to save a bit of time
    // as the hot path ends with doWrite
    state.pendingcb++;
    state.lastBufferedRequest = null;
    state.corkedRequestsFree = holder.next;
    holder.next = null;
  } else {
    // Slow case, write chunks one-by-one
    while (entry) {
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;

      doWrite(stream, state, false, len, chunk, encoding, cb);
      entry = entry.next;
      // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.
      if (state.writing) {
        break;
      }
    }

    if (entry === null) state.lastBufferedRequest = null;
  }

  state.bufferedRequestCount = 0;
  state.bufferedRequest = entry;
  state.bufferProcessing = false;
}

Writable.prototype._write = function (chunk, encoding, cb) {
  cb(new Error('not implemented'));
};

Writable.prototype._writev = null;

Writable.prototype.end = function (chunk, encoding, cb) {
  var state = this._writableState;

  if (typeof chunk === 'function') {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (chunk !== null && chunk !== undefined) this.write(chunk, encoding);

  // .end() fully uncorks
  if (state.corked) {
    state.corked = 1;
    this.uncork();
  }

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished) endWritable(this, state, cb);
};

function needFinish(state) {
  return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
}

function prefinish(stream, state) {
  if (!state.prefinished) {
    state.prefinished = true;
    stream.emit('prefinish');
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(state);
  if (need) {
    if (state.pendingcb === 0) {
      prefinish(stream, state);
      state.finished = true;
      stream.emit('finish');
    } else {
      prefinish(stream, state);
    }
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished) processNextTick(cb);else stream.once('finish', cb);
  }
  state.ended = true;
  stream.writable = false;
}

// It seems a linked list but it is not
// there will be only 2 of these for each stream
function CorkedRequest(state) {
  var _this = this;

  this.next = null;
  this.entry = null;

  this.finish = function (err) {
    var entry = _this.entry;
    _this.entry = null;
    while (entry) {
      var cb = entry.callback;
      state.pendingcb--;
      cb(err);
      entry = entry.next;
    }
    if (state.corkedRequestsFree) {
      state.corkedRequestsFree.next = _this;
    } else {
      state.corkedRequestsFree = _this;
    }
  };
}
},{"./_stream_duplex":73,"buffer":62,"core-util-is":63,"events":64,"inherits":66,"process-nextick-args":70,"util-deprecate":90}],78:[function(require,module,exports){
module.exports = require("./lib/_stream_passthrough.js")

},{"./lib/_stream_passthrough.js":74}],79:[function(require,module,exports){
var Stream = (function (){
  try {
    return require('st' + 'ream'); // hack to fix a circular dependency issue when used with browserify
  } catch(_){}
}());
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = Stream || exports;
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');

// inline-process-browser and unreachable-branch-transform make sure this is
// removed in browserify builds
if (!true) {
  module.exports = require('stream');
}

},{"./lib/_stream_duplex.js":73,"./lib/_stream_passthrough.js":74,"./lib/_stream_readable.js":75,"./lib/_stream_transform.js":76,"./lib/_stream_writable.js":77,"stream":82}],80:[function(require,module,exports){
module.exports = require("./lib/_stream_transform.js")

},{"./lib/_stream_transform.js":76}],81:[function(require,module,exports){
module.exports = require("./lib/_stream_writable.js")

},{"./lib/_stream_writable.js":77}],82:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Stream;

var EE = require('events').EventEmitter;
var inherits = require('inherits');

inherits(Stream, EE);
Stream.Readable = require('readable-stream/readable.js');
Stream.Writable = require('readable-stream/writable.js');
Stream.Duplex = require('readable-stream/duplex.js');
Stream.Transform = require('readable-stream/transform.js');
Stream.PassThrough = require('readable-stream/passthrough.js');

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;



// old-style streams.  Note that the pipe method (the only relevant
// part of this class) is overridden in the Readable class.

function Stream() {
  EE.call(this);
}

Stream.prototype.pipe = function(dest, options) {
  var source = this;

  function ondata(chunk) {
    if (dest.writable) {
      if (false === dest.write(chunk) && source.pause) {
        source.pause();
      }
    }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once.
  if (!dest._isStdio && (!options || options.end !== false)) {
    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest.end();
  }


  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    if (typeof dest.destroy === 'function') dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (EE.listenerCount(this, 'error') === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

},{"events":64,"inherits":66,"readable-stream/duplex.js":72,"readable-stream/passthrough.js":78,"readable-stream/readable.js":79,"readable-stream/transform.js":80,"readable-stream/writable.js":81}],83:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var Buffer = require('buffer').Buffer;

var isBufferEncoding = Buffer.isEncoding
  || function(encoding) {
       switch (encoding && encoding.toLowerCase()) {
         case 'hex': case 'utf8': case 'utf-8': case 'ascii': case 'binary': case 'base64': case 'ucs2': case 'ucs-2': case 'utf16le': case 'utf-16le': case 'raw': return true;
         default: return false;
       }
     }


function assertEncoding(encoding) {
  if (encoding && !isBufferEncoding(encoding)) {
    throw new Error('Unknown encoding: ' + encoding);
  }
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters. CESU-8 is handled as part of the UTF-8 encoding.
//
// @TODO Handling all encodings inside a single object makes it very difficult
// to reason about this code, so it should be split up in the future.
// @TODO There should be a utf8-strict encoding that rejects invalid UTF-8 code
// points as used by CESU-8.
var StringDecoder = exports.StringDecoder = function(encoding) {
  this.encoding = (encoding || 'utf8').toLowerCase().replace(/[-_]/, '');
  assertEncoding(encoding);
  switch (this.encoding) {
    case 'utf8':
      // CESU-8 represents each of Surrogate Pair by 3-bytes
      this.surrogateSize = 3;
      break;
    case 'ucs2':
    case 'utf16le':
      // UTF-16 represents each of Surrogate Pair by 2-bytes
      this.surrogateSize = 2;
      this.detectIncompleteChar = utf16DetectIncompleteChar;
      break;
    case 'base64':
      // Base-64 stores 3 bytes in 4 chars, and pads the remainder.
      this.surrogateSize = 3;
      this.detectIncompleteChar = base64DetectIncompleteChar;
      break;
    default:
      this.write = passThroughWrite;
      return;
  }

  // Enough space to store all bytes of a single character. UTF-8 needs 4
  // bytes, but CESU-8 may require up to 6 (3 bytes per surrogate).
  this.charBuffer = new Buffer(6);
  // Number of bytes received for the current incomplete multi-byte character.
  this.charReceived = 0;
  // Number of bytes expected for the current incomplete multi-byte character.
  this.charLength = 0;
};


// write decodes the given buffer and returns it as JS string that is
// guaranteed to not contain any partial multi-byte characters. Any partial
// character found at the end of the buffer is buffered up, and will be
// returned when calling write again with the remaining bytes.
//
// Note: Converting a Buffer containing an orphan surrogate to a String
// currently works, but converting a String to a Buffer (via `new Buffer`, or
// Buffer#write) will replace incomplete surrogates with the unicode
// replacement character. See https://codereview.chromium.org/121173009/ .
StringDecoder.prototype.write = function(buffer) {
  var charStr = '';
  // if our last write ended with an incomplete multibyte character
  while (this.charLength) {
    // determine how many remaining bytes this buffer has to offer for this char
    var available = (buffer.length >= this.charLength - this.charReceived) ?
        this.charLength - this.charReceived :
        buffer.length;

    // add the new bytes to the char buffer
    buffer.copy(this.charBuffer, this.charReceived, 0, available);
    this.charReceived += available;

    if (this.charReceived < this.charLength) {
      // still not enough chars in this buffer? wait for more ...
      return '';
    }

    // remove bytes belonging to the current character from the buffer
    buffer = buffer.slice(available, buffer.length);

    // get the character that was split
    charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);

    // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
    var charCode = charStr.charCodeAt(charStr.length - 1);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      this.charLength += this.surrogateSize;
      charStr = '';
      continue;
    }
    this.charReceived = this.charLength = 0;

    // if there are no more bytes in this buffer, just emit our char
    if (buffer.length === 0) {
      return charStr;
    }
    break;
  }

  // determine and set charLength / charReceived
  this.detectIncompleteChar(buffer);

  var end = buffer.length;
  if (this.charLength) {
    // buffer the incomplete character bytes we got
    buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
    end -= this.charReceived;
  }

  charStr += buffer.toString(this.encoding, 0, end);

  var end = charStr.length - 1;
  var charCode = charStr.charCodeAt(end);
  // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
  if (charCode >= 0xD800 && charCode <= 0xDBFF) {
    var size = this.surrogateSize;
    this.charLength += size;
    this.charReceived += size;
    this.charBuffer.copy(this.charBuffer, size, 0, size);
    buffer.copy(this.charBuffer, 0, 0, size);
    return charStr.substring(0, end);
  }

  // or just emit the charStr
  return charStr;
};

// detectIncompleteChar determines if there is an incomplete UTF-8 character at
// the end of the given buffer. If so, it sets this.charLength to the byte
// length that character, and sets this.charReceived to the number of bytes
// that are available for this character.
StringDecoder.prototype.detectIncompleteChar = function(buffer) {
  // determine how many bytes we have to check at the end of this buffer
  var i = (buffer.length >= 3) ? 3 : buffer.length;

  // Figure out if one of the last i bytes of our buffer announces an
  // incomplete char.
  for (; i > 0; i--) {
    var c = buffer[buffer.length - i];

    // See http://en.wikipedia.org/wiki/UTF-8#Description

    // 110XXXXX
    if (i == 1 && c >> 5 == 0x06) {
      this.charLength = 2;
      break;
    }

    // 1110XXXX
    if (i <= 2 && c >> 4 == 0x0E) {
      this.charLength = 3;
      break;
    }

    // 11110XXX
    if (i <= 3 && c >> 3 == 0x1E) {
      this.charLength = 4;
      break;
    }
  }
  this.charReceived = i;
};

StringDecoder.prototype.end = function(buffer) {
  var res = '';
  if (buffer && buffer.length)
    res = this.write(buffer);

  if (this.charReceived) {
    var cr = this.charReceived;
    var buf = this.charBuffer;
    var enc = this.encoding;
    res += buf.slice(0, cr).toString(enc);
  }

  return res;
};

function passThroughWrite(buffer) {
  return buffer.toString(this.encoding);
}

function utf16DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 2;
  this.charLength = this.charReceived ? 2 : 0;
}

function base64DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 3;
  this.charLength = this.charReceived ? 3 : 0;
}

},{"buffer":62}],84:[function(require,module,exports){
// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

'use strict';

/*<replacement>*/

var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) {
    keys.push(key);
  }return keys;
};
/*</replacement>*/

module.exports = Duplex;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

var keys = objectKeys(Writable.prototype);
for (var v = 0; v < keys.length; v++) {
  var method = keys[v];
  if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
}

function Duplex(options) {
  if (!(this instanceof Duplex)) return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false) this.readable = false;

  if (options && options.writable === false) this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false) this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended) return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  processNextTick(onEndNT, this);
}

function onEndNT(self) {
  self.end();
}

function forEach(xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}
},{"./_stream_readable":85,"./_stream_writable":87,"core-util-is":63,"inherits":66,"process-nextick-args":70}],85:[function(require,module,exports){
(function (process){
'use strict';

module.exports = Readable;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/

/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Readable.ReadableState = ReadableState;

var EE = require('events');

/*<replacement>*/
var EElistenerCount = function (emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/

/*<replacement>*/
var Stream;
(function () {
  try {
    Stream = require('st' + 'ream');
  } catch (_) {} finally {
    if (!Stream) Stream = require('events').EventEmitter;
  }
})();
/*</replacement>*/

var Buffer = require('buffer').Buffer;

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

/*<replacement>*/
var debugUtil = require('util');
var debug = undefined;
if (debugUtil && debugUtil.debuglog) {
  debug = debugUtil.debuglog('stream');
} else {
  debug = function () {};
}
/*</replacement>*/

var StringDecoder;

util.inherits(Readable, Stream);

var Duplex;
function ReadableState(options, stream) {
  Duplex = Duplex || require('./_stream_duplex');

  options = options || {};

  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.readableObjectMode;

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~ ~this.highWaterMark;

  this.buffer = [];
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;
  this.resumeScheduled = false;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

var Duplex;
function Readable(options) {
  Duplex = Duplex || require('./_stream_duplex');

  if (!(this instanceof Readable)) return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  if (options && typeof options.read === 'function') this._read = options.read;

  Stream.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function (chunk, encoding) {
  var state = this._readableState;

  if (!state.objectMode && typeof chunk === 'string') {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = new Buffer(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function (chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

Readable.prototype.isPaused = function () {
  return this._readableState.flowing === false;
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var e = new Error('stream.unshift() after end event');
      stream.emit('error', e);
    } else {
      var skipAdd;
      if (state.decoder && !addToFront && !encoding) {
        chunk = state.decoder.write(chunk);
        skipAdd = !state.objectMode && chunk.length === 0;
      }

      if (!addToFront) state.reading = false;

      // Don't add to the buffer if we've decoded to an empty string chunk and
      // we're not in object mode
      if (!skipAdd) {
        // if we want the data now, just emit it.
        if (state.flowing && state.length === 0 && !state.sync) {
          stream.emit('data', chunk);
          stream.read(0);
        } else {
          // update the buffer info.
          state.length += state.objectMode ? 1 : chunk.length;
          if (addToFront) state.buffer.unshift(chunk);else state.buffer.push(chunk);

          if (state.needReadable) emitReadable(stream);
        }
      }

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}

// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended && (state.needReadable || state.length < state.highWaterMark || state.length === 0);
}

// backwards compatibility.
Readable.prototype.setEncoding = function (enc) {
  if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
  return this;
};

// Don't raise the hwm > 8MB
var MAX_HWM = 0x800000;
function computeNewHighWaterMark(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2
    n--;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    n++;
  }
  return n;
}

function howMuchToRead(n, state) {
  if (state.length === 0 && state.ended) return 0;

  if (state.objectMode) return n === 0 ? 0 : 1;

  if (n === null || isNaN(n)) {
    // only flow one buffer at a time
    if (state.flowing && state.buffer.length) return state.buffer[0].length;else return state.length;
  }

  if (n <= 0) return 0;

  // If we're asking for more than the target buffer level,
  // then raise the water mark.  Bump up to the next highest
  // power of 2, to prevent increasing it excessively in tiny
  // amounts.
  if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);

  // don't have that much.  return null, unless we've ended.
  if (n > state.length) {
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    } else {
      return state.length;
    }
  }

  return n;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function (n) {
  debug('read', n);
  var state = this._readableState;
  var nOrig = n;

  if (typeof n !== 'number' || n > 0) state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 && state.needReadable && (state.length >= state.highWaterMark || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended) endReadable(this);else emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    if (state.length === 0) endReadable(this);
    return null;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;
  debug('need readable', doRead);

  // if we currently have less than the highWaterMark, then also read some
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  }

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  }

  if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0) state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
  }

  // If _read pushed data synchronously, then `reading` will be false,
  // and we need to re-evaluate how much data we can return to the user.
  if (doRead && !state.reading) n = howMuchToRead(nOrig, state);

  var ret;
  if (n > 0) ret = fromList(n, state);else ret = null;

  if (ret === null) {
    state.needReadable = true;
    n = 0;
  }

  state.length -= n;

  // If we have nothing in the buffer, then we want to know
  // as soon as we *do* get something into the buffer.
  if (state.length === 0 && !state.ended) state.needReadable = true;

  // If we tried to read() past the EOF, then emit end on the next tick.
  if (nOrig !== n && state.ended && state.length === 0) endReadable(this);

  if (ret !== null) this.emit('data', ret);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && chunk !== null && chunk !== undefined && !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}

function onEofChunk(stream, state) {
  if (state.ended) return;
  if (state.decoder) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // emit 'readable' now to make sure it gets picked up.
  emitReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    if (state.sync) processNextTick(emitReadable_, stream);else emitReadable_(stream);
  }
}

function emitReadable_(stream) {
  debug('emit readable');
  stream.emit('readable');
  flow(stream);
}

// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    processNextTick(maybeReadMore_, stream, state);
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended && state.length < state.highWaterMark) {
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;else len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function (n) {
  this.emit('error', new Error('not implemented'));
};

Readable.prototype.pipe = function (dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

  var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted) processNextTick(endFn);else src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    debug('onunpipe');
    if (readable === src) {
      cleanup();
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  var cleanedUp = false;
  function cleanup() {
    debug('cleanup');
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);
    src.removeListener('data', ondata);

    cleanedUp = true;

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
  }

  src.on('data', ondata);
  function ondata(chunk) {
    debug('ondata');
    var ret = dest.write(chunk);
    if (false === ret) {
      // If the user unpiped during `dest.write()`, it is possible
      // to get stuck in a permanently paused state if that write
      // also returned false.
      if (state.pipesCount === 1 && state.pipes[0] === dest && src.listenerCount('data') === 1 && !cleanedUp) {
        debug('false write response, pause', src._readableState.awaitDrain);
        src._readableState.awaitDrain++;
      }
      src.pause();
    }
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (EElistenerCount(dest, 'error') === 0) dest.emit('error', er);
  }
  // This is a brutally ugly hack to make sure that our error handler
  // is attached before any userland ones.  NEVER DO THIS.
  if (!dest._events || !dest._events.error) dest.on('error', onerror);else if (isArray(dest._events.error)) dest._events.error.unshift(onerror);else dest._events.error = [onerror, dest._events.error];

  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function () {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain) state.awaitDrain--;
    if (state.awaitDrain === 0 && EElistenerCount(src, 'data')) {
      state.flowing = true;
      flow(src);
    }
  };
}

Readable.prototype.unpipe = function (dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0) return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes) return this;

    if (!dest) dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest) dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var _i = 0; _i < len; _i++) {
      dests[_i].emit('unpipe', this);
    }return this;
  }

  // try to find the right one.
  var i = indexOf(state.pipes, dest);
  if (i === -1) return this;

  state.pipes.splice(i, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1) state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function (ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  // If listening to data, and it has not explicitly been paused,
  // then call resume to start the flow of data on the next tick.
  if (ev === 'data' && false !== this._readableState.flowing) {
    this.resume();
  }

  if (ev === 'readable' && !this._readableState.endEmitted) {
    var state = this._readableState;
    if (!state.readableListening) {
      state.readableListening = true;
      state.emittedReadable = false;
      state.needReadable = true;
      if (!state.reading) {
        processNextTick(nReadingNextTick, this);
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

function nReadingNextTick(self) {
  debug('readable nexttick read 0');
  self.read(0);
}

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function () {
  var state = this._readableState;
  if (!state.flowing) {
    debug('resume');
    state.flowing = true;
    resume(this, state);
  }
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    processNextTick(resume_, stream, state);
  }
}

function resume_(stream, state) {
  if (!state.reading) {
    debug('resume read 0');
    stream.read(0);
  }

  state.resumeScheduled = false;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading) stream.read(0);
}

Readable.prototype.pause = function () {
  debug('call pause flowing=%j', this._readableState.flowing);
  if (false !== this._readableState.flowing) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);
  if (state.flowing) {
    do {
      var chunk = stream.read();
    } while (null !== chunk && state.flowing);
  }
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function (stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function () {
    debug('wrapped end');
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length) self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function (chunk) {
    debug('wrapped data');
    if (state.decoder) chunk = state.decoder.write(chunk);

    // don't skip over falsy values in objectMode
    if (state.objectMode && (chunk === null || chunk === undefined)) return;else if (!state.objectMode && (!chunk || !chunk.length)) return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (this[i] === undefined && typeof stream[i] === 'function') {
      this[i] = function (method) {
        return function () {
          return stream[method].apply(stream, arguments);
        };
      }(i);
    }
  }

  // proxy certain important events.
  var events = ['error', 'close', 'destroy', 'pause', 'resume'];
  forEach(events, function (ev) {
    stream.on(ev, self.emit.bind(self, ev));
  });

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function (n) {
    debug('wrapped _read', n);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};

// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
function fromList(n, state) {
  var list = state.buffer;
  var length = state.length;
  var stringMode = !!state.decoder;
  var objectMode = !!state.objectMode;
  var ret;

  // nothing in the list, definitely empty.
  if (list.length === 0) return null;

  if (length === 0) ret = null;else if (objectMode) ret = list.shift();else if (!n || n >= length) {
    // read it all, truncate the array.
    if (stringMode) ret = list.join('');else if (list.length === 1) ret = list[0];else ret = Buffer.concat(list, length);
    list.length = 0;
  } else {
    // read just some of it.
    if (n < list[0].length) {
      // just take a part of the first list item.
      // slice is the same for buffers and strings.
      var buf = list[0];
      ret = buf.slice(0, n);
      list[0] = buf.slice(n);
    } else if (n === list[0].length) {
      // first list is a perfect match
      ret = list.shift();
    } else {
      // complex case.
      // we have enough to cover it, but it spans past the first buffer.
      if (stringMode) ret = '';else ret = new Buffer(n);

      var c = 0;
      for (var i = 0, l = list.length; i < l && c < n; i++) {
        var buf = list[0];
        var cpy = Math.min(n - c, buf.length);

        if (stringMode) ret += buf.slice(0, cpy);else buf.copy(ret, c, 0, cpy);

        if (cpy < buf.length) list[0] = buf.slice(cpy);else list.shift();

        c += cpy;
      }
    }
  }

  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0) throw new Error('endReadable called on non-empty stream');

  if (!state.endEmitted) {
    state.ended = true;
    processNextTick(endReadableNT, state, stream);
  }
}

function endReadableNT(state, stream) {
  // Check that we didn't get one last unshift.
  if (!state.endEmitted && state.length === 0) {
    state.endEmitted = true;
    stream.readable = false;
    stream.emit('end');
  }
}

function forEach(xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf(xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}
}).call(this,require('_process'))
},{"./_stream_duplex":84,"_process":71,"buffer":62,"core-util-is":63,"events":64,"inherits":66,"isarray":68,"process-nextick-args":70,"string_decoder/":83,"util":61}],86:[function(require,module,exports){
// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

'use strict';

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);

function TransformState(stream) {
  this.afterTransform = function (er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
  this.writeencoding = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb) return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (data !== null && data !== undefined) stream.push(data);

  cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}

function Transform(options) {
  if (!(this instanceof Transform)) return new Transform(options);

  Duplex.call(this, options);

  this._transformState = new TransformState(this);

  // when the writable side finishes, then flush out anything remaining.
  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  if (options) {
    if (typeof options.transform === 'function') this._transform = options.transform;

    if (typeof options.flush === 'function') this._flush = options.flush;
  }

  this.once('prefinish', function () {
    if (typeof this._flush === 'function') this._flush(function (er) {
      done(stream, er);
    });else done(stream);
  });
}

Transform.prototype.push = function (chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function (chunk, encoding, cb) {
  throw new Error('not implemented');
};

Transform.prototype._write = function (chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function (n) {
  var ts = this._transformState;

  if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};

function done(stream, er) {
  if (er) return stream.emit('error', er);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var ts = stream._transformState;

  if (ws.length) throw new Error('calling transform done when ws.length != 0');

  if (ts.transforming) throw new Error('calling transform done when still transforming');

  return stream.push(null);
}
},{"./_stream_duplex":84,"core-util-is":63,"inherits":66}],87:[function(require,module,exports){
(function (process){
// A bit simpler than readable streams.
// Implement an async ._write(chunk, encoding, cb), and it'll handle all
// the drain event emission and buffering.

'use strict';

module.exports = Writable;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var asyncWrite = !process.browser && ['v0.10', 'v0.9.'].indexOf(process.version.slice(0, 5)) > -1 ? setImmediate : processNextTick;
/*</replacement>*/

/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Writable.WritableState = WritableState;

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

/*<replacement>*/
var internalUtil = {
  deprecate: require('util-deprecate')
};
/*</replacement>*/

/*<replacement>*/
var Stream;
(function () {
  try {
    Stream = require('st' + 'ream');
  } catch (_) {} finally {
    if (!Stream) Stream = require('events').EventEmitter;
  }
})();
/*</replacement>*/

var Buffer = require('buffer').Buffer;

util.inherits(Writable, Stream);

function nop() {}

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
  this.next = null;
}

var Duplex;
function WritableState(options, stream) {
  Duplex = Duplex || require('./_stream_duplex');

  options = options || {};

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.writableObjectMode;

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~ ~this.highWaterMark;

  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // when true all writes will be buffered until .uncork() call
  this.corked = 0;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function (er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.bufferedRequest = null;
  this.lastBufferedRequest = null;

  // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted
  this.pendingcb = 0;

  // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams
  this.prefinished = false;

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;

  // count buffered requests
  this.bufferedRequestCount = 0;

  // create the two objects needed to store the corked requests
  // they are not a linked list, as no new elements are inserted in there
  this.corkedRequestsFree = new CorkedRequest(this);
  this.corkedRequestsFree.next = new CorkedRequest(this);
}

WritableState.prototype.getBuffer = function writableStateGetBuffer() {
  var current = this.bufferedRequest;
  var out = [];
  while (current) {
    out.push(current);
    current = current.next;
  }
  return out;
};

(function () {
  try {
    Object.defineProperty(WritableState.prototype, 'buffer', {
      get: internalUtil.deprecate(function () {
        return this.getBuffer();
      }, '_writableState.buffer is deprecated. Use _writableState.getBuffer ' + 'instead.')
    });
  } catch (_) {}
})();

var Duplex;
function Writable(options) {
  Duplex = Duplex || require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, though they're not
  // instanceof Writable, they're instanceof Readable.
  if (!(this instanceof Writable) && !(this instanceof Duplex)) return new Writable(options);

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  if (options) {
    if (typeof options.write === 'function') this._write = options.write;

    if (typeof options.writev === 'function') this._writev = options.writev;
  }

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function () {
  this.emit('error', new Error('Cannot pipe. Not readable.'));
};

function writeAfterEnd(stream, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  processNextTick(cb, er);
}

// If we get something that is not a buffer, string, null, or undefined,
// and we're not in objectMode, then that's an error.
// Otherwise stream chunks are all considered to be of length=1, and the
// watermarks determine how many objects to keep in the buffer, rather than
// how many bytes or characters.
function validChunk(stream, state, chunk, cb) {
  var valid = true;

  if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && chunk !== null && chunk !== undefined && !state.objectMode) {
    var er = new TypeError('Invalid non-string/buffer chunk');
    stream.emit('error', er);
    processNextTick(cb, er);
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function (chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (Buffer.isBuffer(chunk)) encoding = 'buffer';else if (!encoding) encoding = state.defaultEncoding;

  if (typeof cb !== 'function') cb = nop;

  if (state.ended) writeAfterEnd(this, cb);else if (validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, chunk, encoding, cb);
  }

  return ret;
};

Writable.prototype.cork = function () {
  var state = this._writableState;

  state.corked++;
};

Writable.prototype.uncork = function () {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.writing && !state.corked && !state.finished && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
  }
};

Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
  // node::ParseEncoding() requires lower case.
  if (typeof encoding === 'string') encoding = encoding.toLowerCase();
  if (!(['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le', 'raw'].indexOf((encoding + '').toLowerCase()) > -1)) throw new TypeError('Unknown encoding: ' + encoding);
  this._writableState.defaultEncoding = encoding;
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode && state.decodeStrings !== false && typeof chunk === 'string') {
    chunk = new Buffer(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, chunk, encoding, cb) {
  chunk = decodeChunk(state, chunk, encoding);

  if (Buffer.isBuffer(chunk)) encoding = 'buffer';
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret) state.needDrain = true;

  if (state.writing || state.corked) {
    var last = state.lastBufferedRequest;
    state.lastBufferedRequest = new WriteReq(chunk, encoding, cb);
    if (last) {
      last.next = state.lastBufferedRequest;
    } else {
      state.bufferedRequest = state.lastBufferedRequest;
    }
    state.bufferedRequestCount += 1;
  } else {
    doWrite(stream, state, false, len, chunk, encoding, cb);
  }

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (writev) stream._writev(chunk, state.onwrite);else stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  --state.pendingcb;
  if (sync) processNextTick(cb, er);else cb(er);

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er) onwriteError(stream, state, sync, er, cb);else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(state);

    if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
      clearBuffer(stream, state);
    }

    if (sync) {
      /*<replacement>*/
      asyncWrite(afterWrite, stream, state, finished, cb);
      /*</replacement>*/
    } else {
        afterWrite(stream, state, finished, cb);
      }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished) onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}

// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;
  var entry = state.bufferedRequest;

  if (stream._writev && entry && entry.next) {
    // Fast case, write everything using _writev()
    var l = state.bufferedRequestCount;
    var buffer = new Array(l);
    var holder = state.corkedRequestsFree;
    holder.entry = entry;

    var count = 0;
    while (entry) {
      buffer[count] = entry;
      entry = entry.next;
      count += 1;
    }

    doWrite(stream, state, true, state.length, buffer, '', holder.finish);

    // doWrite is always async, defer these to save a bit of time
    // as the hot path ends with doWrite
    state.pendingcb++;
    state.lastBufferedRequest = null;
    state.corkedRequestsFree = holder.next;
    holder.next = null;
  } else {
    // Slow case, write chunks one-by-one
    while (entry) {
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;

      doWrite(stream, state, false, len, chunk, encoding, cb);
      entry = entry.next;
      // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.
      if (state.writing) {
        break;
      }
    }

    if (entry === null) state.lastBufferedRequest = null;
  }

  state.bufferedRequestCount = 0;
  state.bufferedRequest = entry;
  state.bufferProcessing = false;
}

Writable.prototype._write = function (chunk, encoding, cb) {
  cb(new Error('not implemented'));
};

Writable.prototype._writev = null;

Writable.prototype.end = function (chunk, encoding, cb) {
  var state = this._writableState;

  if (typeof chunk === 'function') {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (chunk !== null && chunk !== undefined) this.write(chunk, encoding);

  // .end() fully uncorks
  if (state.corked) {
    state.corked = 1;
    this.uncork();
  }

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished) endWritable(this, state, cb);
};

function needFinish(state) {
  return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
}

function prefinish(stream, state) {
  if (!state.prefinished) {
    state.prefinished = true;
    stream.emit('prefinish');
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(state);
  if (need) {
    if (state.pendingcb === 0) {
      prefinish(stream, state);
      state.finished = true;
      stream.emit('finish');
    } else {
      prefinish(stream, state);
    }
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished) processNextTick(cb);else stream.once('finish', cb);
  }
  state.ended = true;
  stream.writable = false;
}

// It seems a linked list but it is not
// there will be only 2 of these for each stream
function CorkedRequest(state) {
  var _this = this;

  this.next = null;
  this.entry = null;

  this.finish = function (err) {
    var entry = _this.entry;
    _this.entry = null;
    while (entry) {
      var cb = entry.callback;
      state.pendingcb--;
      cb(err);
      entry = entry.next;
    }
    if (state.corkedRequestsFree) {
      state.corkedRequestsFree.next = _this;
    } else {
      state.corkedRequestsFree = _this;
    }
  };
}
}).call(this,require('_process'))
},{"./_stream_duplex":84,"_process":71,"buffer":62,"core-util-is":63,"events":64,"inherits":66,"process-nextick-args":70,"util-deprecate":90}],88:[function(require,module,exports){
module.exports = require("./lib/_stream_transform.js")

},{"./lib/_stream_transform.js":86}],89:[function(require,module,exports){
(function (process){
var Transform = require('readable-stream/transform')
  , inherits  = require('util').inherits
  , xtend     = require('xtend')

function DestroyableTransform(opts) {
  Transform.call(this, opts)
  this._destroyed = false
}

inherits(DestroyableTransform, Transform)

DestroyableTransform.prototype.destroy = function(err) {
  if (this._destroyed) return
  this._destroyed = true
  
  var self = this
  process.nextTick(function() {
    if (err)
      self.emit('error', err)
    self.emit('close')
  })
}

// a noop _transform function
function noop (chunk, enc, callback) {
  callback(null, chunk)
}


// create a new export function, used by both the main export and
// the .ctor export, contains common logic for dealing with arguments
function through2 (construct) {
  return function (options, transform, flush) {
    if (typeof options == 'function') {
      flush     = transform
      transform = options
      options   = {}
    }

    if (typeof transform != 'function')
      transform = noop

    if (typeof flush != 'function')
      flush = null

    return construct(options, transform, flush)
  }
}


// main export, just make me a transform stream!
module.exports = through2(function (options, transform, flush) {
  var t2 = new DestroyableTransform(options)

  t2._transform = transform

  if (flush)
    t2._flush = flush

  return t2
})


// make me a reusable prototype that I can `new`, or implicitly `new`
// with a constructor call
module.exports.ctor = through2(function (options, transform, flush) {
  function Through2 (override) {
    if (!(this instanceof Through2))
      return new Through2(override)

    this.options = xtend(options, override)

    DestroyableTransform.call(this, this.options)
  }

  inherits(Through2, DestroyableTransform)

  Through2.prototype._transform = transform

  if (flush)
    Through2.prototype._flush = flush

  return Through2
})


module.exports.obj = through2(function (options, transform, flush) {
  var t2 = new DestroyableTransform(xtend({ objectMode: true, highWaterMark: 16 }, options))

  t2._transform = transform

  if (flush)
    t2._flush = flush

  return t2
})

}).call(this,require('_process'))
},{"_process":71,"readable-stream/transform":88,"util":92,"xtend":93}],90:[function(require,module,exports){
(function (global){

/**
 * Module exports.
 */

module.exports = deprecate;

/**
 * Mark that a method should not be used.
 * Returns a modified function which warns once by default.
 *
 * If `localStorage.noDeprecation = true` is set, then it is a no-op.
 *
 * If `localStorage.throwDeprecation = true` is set, then deprecated functions
 * will throw an Error when invoked.
 *
 * If `localStorage.traceDeprecation = true` is set, then deprecated functions
 * will invoke `console.trace()` instead of `console.error()`.
 *
 * @param {Function} fn - the function to deprecate
 * @param {String} msg - the string to print to the console when `fn` is invoked
 * @returns {Function} a new "deprecated" version of `fn`
 * @api public
 */

function deprecate (fn, msg) {
  if (config('noDeprecation')) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (config('throwDeprecation')) {
        throw new Error(msg);
      } else if (config('traceDeprecation')) {
        console.trace(msg);
      } else {
        console.warn(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
}

/**
 * Checks `localStorage` for boolean values for the given `name`.
 *
 * @param {String} name
 * @returns {Boolean}
 * @api private
 */

function config (name) {
  // accessing global.localStorage can trigger a DOMException in sandboxed iframes
  try {
    if (!global.localStorage) return false;
  } catch (_) {
    return false;
  }
  var val = global.localStorage[name];
  if (null == val) return false;
  return String(val).toLowerCase() === 'true';
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],91:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],92:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":91,"_process":71,"inherits":66}],93:[function(require,module,exports){
module.exports = extend

var hasOwnProperty = Object.prototype.hasOwnProperty;

function extend() {
    var target = {}

    for (var i = 0; i < arguments.length; i++) {
        var source = arguments[i]

        for (var key in source) {
            if (hasOwnProperty.call(source, key)) {
                target[key] = source[key]
            }
        }
    }

    return target
}

},{}]},{},[18]);
