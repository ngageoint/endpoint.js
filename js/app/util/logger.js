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
