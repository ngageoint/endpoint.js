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
