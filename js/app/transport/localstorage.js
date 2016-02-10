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

inherits(LocalStorageTransport, Duplex);

module.exports = LocalStorageTransport;

/**
 * This transport reads events from a local storage 'key' value, and forwards
 * them as new 'connection' objects based on senderUuid.  This supports same
 * origin only for now, so no security measures are in place.
 * @augments Duplex
 * @param {Object} settings
 * @param {String} settings.channel - the specific localstorage key to use for message transfer
 * @param {Object} opts - Duplex options based to Duplex.
 * @constructor
 */
function LocalStorageTransport(settings, opts) {
    if (!(this instanceof LocalStorageTransport)) { return new LocalStorageTransport(settings, opts); }

    settings = settings || {};
    opts = opts || {};

    opts.objectMode = true;
    Duplex.call(this, opts);

    // Who are we listening to?
    this._channel = settings.channel || 'local-channel';

    this._localStorage = null;
    this._globalObject = appUtils.getGlobalObject();

    this._storageEventPtr = this._storageEvent.bind(this);
    this._localStorage = this._globalObject.localStorage;

    // When there is no more data to read.
    this.on('finish', function() {
        log.log(log.DEBUG2, 'Destructed LocalStorageTransport: [Channel: %s]',
            this._channel);
        this.close();
    }.bind(this));

    appUtils.addEventListener(this._globalObject, 'storage', this._storageEventPtr, false);

    log.log(log.DEBUG2, 'Initialized LocalStorageTransport: [Channel: %s]',
        this._channel);
}

/**
 * This function does nothing
 * @param n
 * @private
 */
LocalStorageTransport.prototype._read = function(n) {

};

/**
 * Event bound to (this) which executes when a storage event occurs.
 * We ignore events that aren't on our channel, or that are duplicates
 * @param event
 * @private
 */
LocalStorageTransport.prototype._storageEvent = function(event) {
    if (event.key !== this._channel) {
        return;
    }
    log.log(log.TRACE, 'Received message: [%s]', event.newValue);
    this.push(event.newValue);
};

/**
 * Implementation of the '_write' function from NodeJS Streams API
 * @param chunk - the data to write
 * @param encoding - ignored (since we're using chunks, not strings)
 * @param next - callback to tell the streams API we're done writing
 * @private
 */
LocalStorageTransport.prototype._write = function(chunk, encoding, next) {
    log.log(log.TRACE, 'Sending message: [%s]', chunk);
    this._localStorage.setItem(this._channel, chunk);
    next();
};

/**
 * Force unsubscribe from any event listeners for this target channel
 */
LocalStorageTransport.prototype.close = function() {
    appUtils.removeEventListener(this._globalObject, 'storage', this._storageEventPtr);
    this.end();
};
