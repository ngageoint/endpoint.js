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
            else if (item !== null && item['_facade'] && item['_facade'] instanceof Facade) {
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
