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

var Readable = require('readable-stream').Readable,
    inherits = require('util').inherits,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(PostMessageReaderTransport, Readable);

module.exports = PostMessageReaderTransport;

/**
 * PostMessage stream multiplexer.  Emits 'streams' whenever a new uuid is
 * detected.  These streams never really pause, resume, end, etc, so they
 * are pseudo streams meant to be used by higher level protocols as a
 * transport layer. This only allows same domain for now
 * https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
 * @augments Readable
 * @param {Object} settings
 * @param {Object} settings.target - the object to subscribe to message event on
 * @param {String} settings.origin - the origin to accept messages from
 * @param {Boolean} settings.checkOrigin - only accept messages from settings.origin setting.
 * @param {Boolean} settings.preserveSource - emit data from this stream wrapped in an object that
 *   has the window source that sent the message
 * @param {Object} opts - Readable options based to Readable.
 * @constructor
 */
function PostMessageReaderTransport(settings, opts) {
    if (!(this instanceof PostMessageReaderTransport)) { return new PostMessageReaderTransport(settings, opts); }

    settings = settings || {};
    opts = opts || {};

    opts.objectMode = true;
    Readable.call(this, opts);

    // Who are we listening to?
    this._target = settings.target;
    this._origin = settings.origin || '';

    // Whether to transform the
    this._preserveSource = settings.hasOwnProperty('preserveSource') ?
        settings.preserveSource : false;

    // Whether to check against the 'settings' origin.
    this._checkOrigin = typeof settings.checkOrigin !== 'undefined' ? settings.checkOrigin : true;

    this._messageEventPtr = this._messageEvent.bind(this);

    appUtils.addEventListener(this._target, 'message', this._messageEventPtr);

    // When there is no more data to read.
    this.on('end', function() {
        log.log(log.DEBUG2, 'Destructed PostMessageReaderTransport');
        this.close();
    }.bind(this));

    log.log(log.DEBUG2, 'Initialized PostMessageReaderTransport: [Origin: %s] ' +
        '[Check Origin: %s]', this._origin, this._checkOrigin);
}

/**
 * This function does nothing
 * @param n
 * @private
 */
PostMessageReaderTransport.prototype._read = function(n) {

};

/**
 * Event bound to (this) which executes when a message event occurs.
 * @param event
 * @private
 */
PostMessageReaderTransport.prototype._messageEvent = function(event) {
    // Checks
    if (this._checkOrigin) {
        if (this._origin !== event.origin) {
            log.log(log.DEBUG3, 'Received message from invalid origin: [Origin: %s] [Expected Origin: %s] [Message: %j]',
                event.origin, this._origin, event.data);
            return;
        }
    }

    // Log and add to the buffer
    log.log(log.TRACE, 'Received message: [%s]', event.data);
    if (this._preserveSource) {
        this.push({
            source: event.source,
            origin: event.origin,
            msg: event.data
        });
    }
    else {
        this.push(event.data);
    }
};

/**
 * Force unsubscribe from any event listeners for this target
 */
PostMessageReaderTransport.prototype.close = function() {
    appUtils.removeEventListener(this._target, 'message', this._messageEventPtr);
    this.push(null);
};
