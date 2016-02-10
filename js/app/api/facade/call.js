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
