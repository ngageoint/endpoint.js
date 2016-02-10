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
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    through2 = require('through2'),
    stringifyStream = require('../streams/stringify-stream'),
    readTransport = require('../transport/postmessage-reader'),
    sendTransport = require('../transport/postmessage-sender');

inherits(WindowLink, ProtocolLink);

module.exports = WindowLink;

/**
 * Window Link handles commnication between parent/child windows,
 * or parent/child iframes.
 * @augments ProtocolLink
 * @param {String} instanceId - unique identifier for this endpoint.js instance
 * @param {String} linkId - unique identifier for this link instance
 * @param {Object} settings
 * @param {String} settings.origin - the origin of this window, only read+write to this origin
 * @param {Boolean} settings.external - whether we trust this link (trust their routing table)
 * @constructor
 */
function WindowLink(instanceId, linkId, settings) {
    if (!(this instanceof WindowLink)) { return new WindowLink(instanceId, linkId, settings); }

    this._origin = settings.origin;
    this._external = settings.hasOwnProperty('external') ? settings.external : true;

    // Call parent constructor
    ProtocolLink.call(this, instanceId, linkId, settings);

    // Create our transport
    this._transportStream = readTransport({
        target: appUtils.getGlobalObject(),
        origin: this._origin,
        checkOrigin: true,
        preserveSource: true
    });

    // Parse it, and decode it
    this._readStream = this._transportStream
        .pipe(through2.obj(function(chunk, encoding, cb) {
            // This is a special workaround, because the object might have additional
            // values, such as 'source' and 'origin', since we're using preserveSource.
            // So we just use the decode function directly instead of piping it
            // through the stringify decode stream.
            chunk.msg = stringifyStream.decodeFunction(true, chunk.msg);
            this.push(chunk);
            cb();
        }))
        .pipe(this._createDecodeStream());

    // Tell our parent about it.
    this._handleReader(this._readStream);

    log.log(log.DEBUG2, 'Window Link initialized: [Settings: %j]', settings);
}

/**
 * If true, routing information from this host should be treated as
 * 'external', meaning it cannot affect the internal routing table
 */
WindowLink.prototype.isExternal = function() {
    return this._external;
};

/**
 * Preserve the source information from the input stream
 * @private
 */
WindowLink.prototype._createDecodeStream = function() {
    return through2.obj(function(chunk, encoding, cb) {
        var newMsg = chunk.msg;
        newMsg.source = chunk.source;
        newMsg.origin = chunk.origin;
        this.push(newMsg);
        cb();
    });
};

/**
 * Will manually create a 'send' transport stream for the specific destination
 * @param destinationUuid
 * @param [metadata]
 * @returns {*}
 * @private
 */
WindowLink.prototype._createSenderStream = function(metadata) {
    var sender = sendTransport({
        target: metadata.source,
        origin: this._origin,
        sendOrigin: true
    });

    var encoder = stringifyStream.encode(true);
    encoder.pipe(sender);

    return encoder;
};

/**
 * Manually announce to the given window.
 * @param obj
 */
WindowLink.prototype.announceWindow = function(obj) {
    this._announce({ source: obj });
};

/**
 * The cost to transmit to this link.  For window, use this
 * if we have more than a few hops to a worker.
 * @returns {number}
 */
WindowLink.prototype.getCost = function() {
    return 1;
};

/**
 * Override parent type function
 * @returns {string}
 */
WindowLink.prototype.getType = function() {
    return 'window';
};

/**
 * Remove event listeners, close streams
 */
WindowLink.prototype.close = function() {

    // Close any streams (this will send goodbyes)
    ProtocolLink.prototype.close.call(this);

    // Close the post message transport
    this._transportStream.close();
};
