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

var appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    linkStream = require('../streams/link-stream'),
    through2 = require('through2');

/**
 *  A switch stream will allow multiple input duplex
 *  streams to share the same output stream, based
 *  on the cost of that stream.
 *  @module switch-stream
 */
module.exports = function(opts) {

    var currentStream = null;
    var streams = [];

    var readStream = through2.obj();
    var writeStream = through2.obj(function(chunk, encoding, cb) {
        if (currentStream === null) {
            log.log(log.ERROR, 'No writable stream to pipe to!');
            throw new Error('No writable stream');
        }
        this.push(chunk);
        cb();
    });

    function switchStream() {
        // Find the best link.  Use <= here so that we always use
        // the newest lowest cost stream (in case a reconnection occurs)
        var lowest = null;
        streams.forEach(function(str) {
            if (lowest === null ||
                str.cost <= lowest.cost) {
                lowest = str;
            }
        });

        if (currentStream !== lowest) {
            if (currentStream !== null) {
                log.log(log.DEBUG3, 'Un-piping myself from existing stream');
                writeStream.unpipe(currentStream.stream);
                currentStream = null;
            }
            if (lowest !== null) {
                log.log(log.DEBUG2, 'Lower cost stream selected [new: %s]',
                    lowest.cost);
                currentStream = lowest;
                writeStream.pipe(currentStream.stream, {
                    end: false
                });
                // Tell the higher layer that we switched, and report the new cost.
                lnStrm.emit('switch', lowest.cost, lowest.meta);
            }
            else {
                // No streams!
                lnStrm.emit('switch-close');
            }
        }
    }

    var lnStrm = linkStream({
        readTransport: readStream,
        sendTransport: writeStream
    }, opts);

    // Add a stream and make it monitored
    lnStrm.addStream = function(stream, cost, meta) {

        // Push the send stream
        streams.push({
            stream: stream,
            cost: cost,
            meta: meta
        });

        // Pipe the stream to myself
        stream.pipe(readStream, {
            end: false
        });

        // Force a re-acquire
        switchStream();

        log.log(log.DEBUG2, 'Added stream to switch-stream [total: %s]', streams.length);

    };

    // Remove a stream from being monitored
    lnStrm.removeStream = function(stream) {
        for (var index = streams.length - 1; index > 0; index--) {
            if (streams[index].stream === stream) {
                break;
            }
        }
        if (index >= 0) {
            streams.splice(index, 1);

            // Unpipe
            stream.unpipe(readStream);

            // Force a re-acquire
            switchStream();

            log.log(log.DEBUG2, 'Removed stream from switch-stream [total: %s]', streams.length);
        }
        else {
            log.log(log.WARN, 'Tried to remove a stream from this switch-stream ' +
                'but that stream is not registered');
        }
    };

    // How many streams are being monitored.
    lnStrm.getNumberStreams = function() {
        return streams.length;
    };

    return lnStrm;
};
