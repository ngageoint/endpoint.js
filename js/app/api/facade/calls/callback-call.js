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
