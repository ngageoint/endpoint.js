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

var ProtocolLink = require('./protocol-link'),
    inherits = require('util').inherits,
    stringifyStream = require('../streams/stringify-stream'),
    localStorage = require('../transport/localstorage'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    through2 = require('through2');

inherits(TabLink, ProtocolLink);

module.exports = TabLink;

/**
 * This link class handles connections for localstorage on a specific
 * channel within the browser.
 * @augments ProtocolLink
 * @param {String} instanceId - unique identifier for this endpoint.js instance
 * @param {String} linkId - unique identifier for this link instance
 * @param {Object} settings
 * @param {String} settings.channel - the specific localstorage key to use for message transfer
 * @constructor
 */
function TabLink(instanceId, linkId, settings) {
    if (!(this instanceof TabLink)) { return new TabLink(instanceId, linkId, settings); }

    this._channel = settings.channel || 'local-channel';

    // Call the parent constructor.
    ProtocolLink.call(this, instanceId, linkId, settings);

    // Create our transport
    this._transportStream = localStorage({
        channel: this._channel
    });

    // Parse it, and decode it
    this._readStream = this._transportStream
        .pipe(stringifyStream.decode(true))
        .pipe(this._createDecodeStream());

    // Encode it
    this._writeStream = this._createEncodeStream();
    this._writeStream
        .pipe(stringifyStream.encode(true))
        .pipe(this._transportStream);

    // Tell our parent about it.
    this._handleReader(this._readStream);

    // Tell everyone we're here!
    this._announce();

    log.log(log.DEBUG2, 'Tab Link initialized: [Settings: %j]', settings);
}

/**
 * This function will ensure that the source and counter
 * values in the stream are not the exact same as the ones
 * from the previous message (via the protocol-link
 * metadata)
 * @private
 */
TabLink.prototype._createDecodeStream = function() {
    var lastCtr = null;
    var lastSource = null;
    return through2.obj(function(chunk, encoding, cb) {
        // Skip messages that have the same
        // counter variable.
        if (lastCtr === chunk.c &&
            lastSource === chunk.s) {
            cb();
        }
        else {
            lastCtr = chunk.c;
            lastSource = chunk.s;
            this.push(chunk);
            cb();
        }
    });
};

/**
 * This function will place a counter into the protocol-link
 * metadata.  Localstorage on some browsers fires the event
 * twice.. I don't think this applies since we're not trying
 * to support IE, but just in-case we refactor for support
 * in the future...
 * @private
 */
TabLink.prototype._createEncodeStream = function() {
    var ctr = 1;
    return through2.obj(function(chunk, encoding, cb) {
        chunk.c = ctr++;
        if (ctr > 65536) {
            ctr = 1;
        }
        this.push(chunk);
        cb();
    });
};

/**
 * Will manually create a 'send' transport stream for the specific destination
 * @param [metadata]
 * @returns {*}
 * @private
 */
TabLink.prototype._createSenderStream = function(metadata) {
    var str = through2.obj();
    str.pipe(this._writeStream, { end: false });
    return str;
};

/**
 * The cost to transmit to this link.  For tabs, since it uses
 * localstorage, we want to not use this as much as possible.
 * @returns {number}
 */
TabLink.prototype.getCost = function() {
    return 10;
};

/**
 * Returns the type of link this is
 * @returns {string}
 */
TabLink.prototype.getType = function() {
    return 'tab';
};

/**
 * Remove event listeners, close streams
 */
TabLink.prototype.close = function() {

    // Close any streams (this will send goodbyes)
    ProtocolLink.prototype.close.call(this);

    // Close the local storage transport
    this._transportStream.close();
};
