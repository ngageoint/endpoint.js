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
