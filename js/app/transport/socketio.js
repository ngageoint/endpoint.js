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

var Duplex = require('readable-stream').Duplex,
    inherits = require('util').inherits,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(SocketIoTransport, Duplex);

module.exports = SocketIoTransport;

/**
 * Socket.io browser transport will connect to a remote socket.io endpoint
 * and wrap it with a stream
 * @augments Duplex
 * @param {Object} settings
 * @param {String} settings.channel - socket.io channel to use
 * @param {String} settings.target - the socket.io socket to use
 * @param {Object} opts - Duplex options based to Duplex.
 * @constructor
 */
function SocketIoTransport(settings, opts) {
    if (!(this instanceof SocketIoTransport)) { return new SocketIoTransport(settings, opts); }

    settings = settings || {};
    opts = opts || {};

    opts.objectMode = true;
    Duplex.call(this, opts);

    // Who are we listening to?
    this._channel = settings.channel;
    this._target = settings.target;

    this._dataEventPtr = this._handleDataEvent.bind(this);
    this._target.on(this._channel, this._dataEventPtr);

    var _this = this;

    // When there is no more data to read.
    var endFunc = function() {
        if (_this._target !== null) {
            log.log(log.DEBUG2, 'Destructed SocketIoTransport: [Channel: %s]',
                _this._channel);
            _this._target.removeListener(_this._channel, _this._dataEventPtr);
            _this._target = null;
        }
    };
    this.on('end', endFunc);
    this.on('finish', endFunc);

    // If the host disconnects
    var closeFunc = function() {
        // Close the stream
        _this.push(null);
    };
    this._target.on('disconnect', closeFunc);

    log.log(log.DEBUG2, 'Initialized SocketIoTransport: [Channel: %s]',
        this._channel);
}

/**
 * This function does nothing
 * @param n
 * @private
 */
SocketIoTransport.prototype._read = function(n) {

};

/**
 * Event bound to (this) which executes when a storage event occurs.
 * We ignore events that aren't on our channel, or that are duplicates
 * @param event
 * @private
 */
SocketIoTransport.prototype._handleDataEvent = function(data) {
    log.log(log.TRACE, 'Received message: [%j]', data);
    this.push(data);
};

/**
 * Implementation of the '_write' function from NodeJS Streams API
 * @param chunk - the data to write
 * @param encoding - ignored (since we're using chunks, not strings)
 * @param next - callback to tell the streams API we're done writing
 * @private
 */
SocketIoTransport.prototype._write = function(chunk, encoding, next) {
    log.log(log.TRACE, 'Sending message: [%j]', chunk);
    if (this._target !== null) {
        this._target.emit(this._channel, chunk);
    }
    next();
};

/**
 * Force close the underlying socket
 */
SocketIoTransport.prototype.close = function() {
    this._target.disconnect();
};
