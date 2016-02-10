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

var Writable = require('readable-stream').Writable,
    inherits = require('util').inherits,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(PostMessageSenderTransport, Writable);

module.exports = PostMessageSenderTransport;

/**
 * PostMessage stream multiplexer.  Emits 'streams' whenever a new uuid is
 * detected.  These streams never really pause, resume, end, etc, so they
 * are pseudo streams meant to be used by higher level protocols as a
 * transport layer. This only allows same domain for now
 * https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
 * @augments Writable
 * @param {Object} settings
 * @param {Object} settings.target - the object to post messages to
 * @param {String} settings.origin - the origin to specify when sending messages
 * @param {Boolean} settings.sendOrigin - whether to send origin or '*' in messages sent
 * @param {Object} opts - Writable options based to Writable.
 * @constructor
 */
function PostMessageSenderTransport(settings, opts) {
    if (!(this instanceof PostMessageSenderTransport)) { return new PostMessageSenderTransport(settings, opts); }

    settings = settings || {};
    opts = opts || {};

    opts.objectMode = true;
    Writable.call(this, opts);

    // Who are we listening to?
    this._target = settings.target;
    this._origin = settings.origin || '';

    // Whether to send the origin argument. (False for worker)
    this._sendOrigin = settings.hasOwnProperty('sendOrigin') ? settings.sendOrigin : true;

    log.log(log.DEBUG2, 'Initialized PostMessageSenderTransport: [Origin: %s] ' +
        '[Send Origin: %s]', this._origin, this._sendOrigin);
}

/**
 * Implementation of the '_write' function from NodeJS Streams API
 * @param chunk - the data to write
 * @param encoding - ignored (since we're using chunks, not strings)
 * @param next - callback to tell the streams API we're done writing
 * @private
 */
PostMessageSenderTransport.prototype._write = function(chunk, encoding, next) {
    log.log(log.TRACE, 'Sending message: [%s]', chunk);
    if (this._sendOrigin) {
        this._target.postMessage(chunk, this._origin);
    }
    else {
        this._target.postMessage(chunk);
    }
    next();
};
