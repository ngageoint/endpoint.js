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

var inherits = require('util').inherits,
    Duplex = require('readable-stream').Duplex,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(LinkStream, Duplex);

module.exports = LinkStream;

/**
 * Link stream is a Duplex (Readable/Writable) stream which sends data
 * through the conencted send/read transport.
 * @augments Duplex
 * @param {Object} settings
 * @param {Stream} settings.readTransport - stream to read data from
 * @param {Stream} settings.sendTransport - stream to write data to
 * @param {Object} opts - Duplex options based to Duplex.
 * @constructor
 */
function LinkStream(settings, opts) {
    if (!(this instanceof LinkStream)) {
        return new LinkStream(settings, opts);
    }

    opts = opts || {};
    Duplex.call(this, opts);
    this._cb = null;
    this._closed = false;

    // If there is no more data to be written.
    // Someone manually called .end() on us.
    var _this = this;
    function doEnd() {
        if (!_this._closed) {
            _this._sendTransport.push(null);
            _this._sendTransport.end();
            _this._closed = true;
            if (_this._cb) {
                var cb = _this._cb;
                _this._cb = null;
                cb();
            }
        }
    }
    this.on('finish', function() {
        log.log(log.DEBUG2, 'Link stream finish detected');
        doEnd();
    });
    this.on('end', function() {
        log.log(log.DEBUG2, 'Link stream end detected');
        doEnd();
    });

    this.setStreams(settings);
}

/**
 * This function does nothing
 * @param n
 * @private
 */
LinkStream.prototype._read = function(n) {
    this.emit('back-pressure-relieved');
};

/**
 * Send data to the encapsulated writer (local storage, post message, etc)
 * @param chunk
 * @param encoding
 * @param cb
 * @private
 */
LinkStream.prototype._write = function(chunk, encoding, cb) {
    if (!this._closed) {
        if (!this._sendTransport.write(chunk)) {
            // Back-Pressure, stop sending, and start buffering.
            this._cb = cb;
        }
        else {
            // TODO: Possibly do an exponential backoff here?
            cb();
        }
    }
    else {
        log.log(log.DEBUG3, 'Writing to a stream that is closed: %j', chunk);
        cb();
    }
};

/**
 * Return our current streams.
 * @returns {{readTransport: *, sendTransport: *}}
 */
LinkStream.prototype.getStreams = function() {
    return {
        readTransport: this._readTransport,
        sendTransport: this._sendTransport
    };
};

/**
 * Set the streams this link stream uses.
 * @param streams
 */
LinkStream.prototype.setStreams = function(streams) {

    if (this._readTransport) {
        this._readTransport.removeListener('readable', readable);
        this._readTransport.removeListener('end', end);
        this._readTransport.removeListener('finish', finish);
    }

    if (this._sendTransport) {
        this._readTransport.removeListener('drain', drain);
    }

    this._readTransport = streams.readTransport;
    this._sendTransport = streams.sendTransport;

    var _this = this;

    // Read data from source
    this._readTransport.on('readable', readable);

    function readable() {
        var data = _this._readTransport.read();
        if (data) {
            var result = _this.push(data);
            if (!result) {
                _this.emit('back-pressure');
            }
        }
    }

    // No more data to read from read transport,
    // which means we don't have any more data
    // to read.
    this._readTransport.on('end', end);
    this._readTransport.on('finish', finish);

    var readEnd = false;
    function readEndCB() {
        if (!readEnd)  {
            _this.push(null);
            _this.end();
            readEnd = true;
        }
    }
    function end() {
        log.log(log.DEBUG2, 'Transport read end detected');
        readEndCB();
    }
    function finish() {
        log.log(log.DEBUG2, 'Transport read finish detected');
        readEndCB();
    }

    // When the stream is relieved of back-pressure
    this._sendTransport.on('drain', drain);

    function drain() {
        log.log(log.DEBUG3, 'Transport write drain detected');
        if (_this._cb) {
            var cb = _this._cb;
            _this._cb = null;
            cb();
        }
    }
};
