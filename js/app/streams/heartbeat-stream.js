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
/* globals __filename, setInterval, clearInterval */

'use strict';

var appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    periodicTimer = require('../util/periodic-timer'),
    EventEmitter = require('events').EventEmitter,
    through2 = require('through2');

/**
 * This function will return a pair of linked heartbeat encode/decode
 * streams with the given duration
 * @module heartbeat-stream
 * @param {Number} duration - how often to ping
 */
module.exports = function(duration) {

    var events = new EventEmitter();

    var streams = {
        encode: encodeHeartbeat(events, duration),
        decode: decodeHeartbeat(events)
    };

    return streams;
};

/**
 * Used to ensure the stream is still alive
 * @returns {*}
 */
function encodeHeartbeat(events, duration) {

    duration = duration || 20000;

    var readCounter = 0;
    var sentCounter = 0;
    var timer = periodicTimer('Heart Beat', duration);
    var timerId;
    var waitingForPing = false;

    var stream = through2.obj(function(chunk, encoding, cb) {
        this.push({
            m: chunk
        });
        sentCounter += 1;
        cb();
    });

    // The destination sent data to us.
    events.on('read', function() {
        readCounter += 1;
    });

    // Relay to the stream that it has timed out.
    events.on('heartbeat-timeout', function() {
        stream.emit('heartbeat-timeout');
    });

    // If the read stream ends, then remove the reference
    events.on('read-close', function() {
        timer.removeReference();
    });

    // Send a ping, and make sure we received some data from the remote host
    timer.on('period', function(force) {

        if (force) {
            // This occurs when the timer ends
            return;
        }

        log.log(log.DEBUG3, 'Periodic timer [id: %s] [read counter: %s] [send counter: %s] [waiting for ping: %s] ',
            timerId, readCounter, sentCounter, waitingForPing);

        if (readCounter === 0) {
            if (waitingForPing) {
                // End the stream
                log.log(log.WARN, 'Heartbeat detected stream link is dead');
                events.emit('heartbeat-timeout');
                return;
            }
            else {
                waitingForPing = true;
            }
        }
        else {
            // Reset the counter
            readCounter = 0;
            waitingForPing = false;
        }

        // send a ping every instance, but only if i haven't sent any data in a while.
        if (sentCounter === 0) {
            stream.push({
                h: 'ping'
            });
        }
        else {
            sentCounter = 0;
        }

    });

    // End the timer if the stream dies
    stream.on('finish', function() {
        timer.removeReference();
    });

    // Start the timer
    timerId = timer.addReference();

    return stream;
}

/**
 * Used to ensure the stream is still alive
 * @returns {*}
 */
function decodeHeartbeat(events) {
    var stream = through2.obj(function(chunk, encoding, cb) {
        // Intercept heartbeats
        if (!chunk.h) {
            this.push(chunk.m);
        }
        events.emit('read');
        cb();
    });

    // End the timer if the stream dies
    stream.on('finish', function() {
        events.emit('read-close');
    });

    // Relay to the stream that it has timed out.
    events.on('heartbeat-timeout', function() {
        stream.emit('heartbeat-timeout');
    });
    return stream;
}
