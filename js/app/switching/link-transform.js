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

var linkStream = require('../streams/link-stream'),
    through2 = require('through2'),
    metaWrapStream = require('../streams/metawrap-stream'),
    heartbeatStream = require('../streams/heartbeat-stream');

module.exports = LinkTransform;

/**
 * Link transform allows addition of stream transformers onto a link.  The default
 * transform applied is the heartbeat stream, but you can add others, like encryption
 * or compression.  The output is a link-stream.
 * @param opts - stream options to use when creating the link stream
 * @param readStream
 * @param writeStream
 * @param timeout - heartbeat timeout in milliseconds
 * @constructor
 */
function LinkTransform(opts, readStream, writeStream, timeout) {
    if (!(this instanceof LinkTransform)) { return new LinkTransform(opts, readStream, writeStream, timeout); }
    this._opts = opts;
    this._readStream = readStream;
    this._writeStream = writeStream;

    // Create the protocol wrapper streams
    var decodeStream = metaWrapStream.decodeMetaWrapStream();
    readStream.pipe(decodeStream);

    var encodeStream = metaWrapStream.encodeMetaWrapStream();
    encodeStream.pipe(writeStream);

    // Wrap the streams in heartbeat.
    if (timeout) {
        timeout = Math.floor(timeout / 2);
    }

    var pair = heartbeatStream(timeout);
    var heartbeatSend = pair.encode;
    var heartbeatRead = pair.decode;

    heartbeatSend.pipe(encodeStream);
    decodeStream.pipe(heartbeatRead);

    // Wrap with a link stream.
    var stream = this._linkStream = linkStream({
        readTransport: heartbeatRead,
        sendTransport: heartbeatSend
    }, opts);

    // If the heartbeat timer detects an issue, end the transport.
    heartbeatSend.on('heartbeat-timeout', function() {
        stream.end();
    });
}

/**
 * Return the link stream represented by this transform
 * @returns {*}
 */
LinkTransform.prototype.getLinkStream = function() {
    return this._linkStream;
};

/**
 * Retrieve the internal streams this link stream is using for read/write,
 * and pipe the given read/write stream
 * @param readStream - a stream or a function
 * @param writeStream - a stream or a function
 */
LinkTransform.prototype.addTransform = function(readStream, writeStream) {
    var streams = this._linkStream.getStreams();
    readStream = readStream || through2.obj();
    writeStream = writeStream || through2.obj();
    if (typeof (readStream) == 'function') {
        readStream = through2.obj(readStream);
    }
    if (typeof (writeStream) == 'function') {
        writeStream = through2.obj(writeStream);
    }
    writeStream.pipe(streams.sendTransport);
    streams.readTransport.pipe(readStream);
    this._linkStream.setStreams({
        readTransport: readStream,
        sendTransport: writeStream
    });
};
