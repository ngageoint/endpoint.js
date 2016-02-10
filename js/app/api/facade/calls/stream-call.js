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
