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
    uuid = require('uuid'),
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
