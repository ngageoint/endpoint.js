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
