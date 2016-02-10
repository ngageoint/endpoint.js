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
