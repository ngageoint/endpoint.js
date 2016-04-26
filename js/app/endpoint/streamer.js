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

var EventEmitter = require('events').EventEmitter,
    inherits = require('util').inherits,
    address = require('../routing/address'),
    muxStream = require('../streams/mux-stream'),
    uuid = require('node-uuid'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Streamer, EventEmitter);

module.exports = Streamer;

/**
 * This handler handles streams which can be routed throughout the Endpoint.js network.
 * @augments EventEmitter
 * @fires Streamer#stream-X when a new stream is available
 * @param {PathVector} pathInstance - an instance of the PathVector class
 * @param {Router} routerInstance - an instance of the Router class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function Streamer(pathInstance, routerInstance, config) {
    if (!(this instanceof Streamer)) return new Streamer(pathInstance, routerInstance, config);

    EventEmitter.call(this);
    this.setMaxListeners(0);

    this._id = config.get('instanceId');

    // Stream metadata needed by the streamer to route the message
    this._streamInfo = {};

    // A list of streamhandlers indexed by name.
    this._handlers = {};

    // Setup the global multiplexer for this endpoint.
    this._multiplexer = muxStream();
    this._multiplexer.on('readable', this._handleMultiplexerOutbound.bind(this));

    // This listener happens when a new stream has been routed to use for relay to
    // the parent api level.
    this._multiplexer.on('stream', this._handleMultiplexerStream.bind(this));

    // Save a reference to the path vector
    this._pathInstance = pathInstance;

    // Subscribe to router events.
    this._routerInstance = routerInstance;
    this._routerInstance.addHandler('stream');
    this._routerInstance.on('stream', this._handleStreamPacket.bind(this));
    this._routerInstance.on('stream-error', this._handleStreamError.bind(this));
}

/**
 * Data is ready to be send to the router.
 * @private
 */
Streamer.prototype._handleMultiplexerOutbound = function() {
    var msg;
    while ((msg = this._multiplexer.read()) !== null) {
        var streamInfo = this._streamInfo[msg.id];
        if (streamInfo) {
            if (streamInfo.local) {
                msg.id = streamInfo.localId;
            }
            this._pathInstance.sendPacket(streamInfo.remoteAddress, 'stream', msg);
        }
    }
};

/**
 * Forward the unwrapped packet from the router to the multiplexer.
 * @param packet
 * @private
 */
Streamer.prototype._handleStreamPacket = function(packet, fromUuid, source) {
    var id = packet.id;

    var info = this._streamInfo[id];
    if (!info) {
        // New stream we haven't seen before.
        this._streamInfo[id] = {
            local: fromUuid == 'local',
            source: source,
            remoteAddress: null
        };
    }
    else {
        // If we haven't gotten a source packet before, get the first one
        if (!info.source) {
            info.source = source;
        }
        else if (source !== info.source) {
            log.log(log.WARN, 'Packet does not match original source %s: %j', source, packet);
            // Ensure source matches the last source.
            return;
        }
    }
    this._multiplexer.write(packet);
};

/**
 * Tell the multiplexer that we couldn't route a certain packet.
 * @param fromUuid
 * @param toUuid
 * @param packet
 * @private
 */
Streamer.prototype._handleStreamError = function(packet) {
    // Get the id, and if I know about this stream in my multiplexer,
    // then kill it.
    var id = packet.id;
    var str = this._multiplexer.getStream(id);
    if (str) {
        str.end();
    }
};

/**
 * Emit the new stream to the API layer.
 * @private
 */
Streamer.prototype._handleMultiplexerStream = function(stream, opts) {

    if (!stream.meta || !stream.meta.type) {
        log.log(log.ERROR, 'Unknown stream type: %j', stream.meta);
        stream.end();
        return;
    }

    if (!this.hasHandler(stream.meta.type)) {
        log.log(log.ERROR, 'No handler for stream type: %s', stream.meta.type);
        stream.end();
        return;
    }

    var streamInfo = this._streamInfo[stream.id];

    // This lets us create streams to ourself
    var remoteAddress;
    if (streamInfo.local) {
        streamInfo.localId = stream.id.substring(0, stream.id.length - 6);
        remoteAddress = address('local');
    }
    else {
        // Update the streamInfo with the originator
        remoteAddress = address(stream.meta.address);
    }
    streamInfo.remoteAddress = remoteAddress;

    var type = stream.meta.type;
    stream.meta = stream.meta.meta;

    // If the stream ends, then clean-up
    var _this = this;
    stream.on('finish', function() {
        log.log(log.DEBUG2, 'Cleaning up old stream after end: %s', stream.id);
        delete _this._streamInfo[stream.id];
    });

    log.log(log.DEBUG2, 'Received new stream: [local: %s] [id: %s]', streamInfo.local, stream.id);

    // Emit it to the higher layer.
    this.emit('stream-' + type, stream, opts);

};

/**
 * Create a stream to the given destination
 * @param type
 * @param remoteAddress
 * @param meta
 * @param opts
 */
Streamer.prototype.createStream = function(type, remoteAddress, meta, opts) {

    var address = remoteAddress.getPathVector();

    var newStreamId = uuid();
    var streamInfo = this._streamInfo[newStreamId] = {
        local: address.length === 0 || address[address.length - 1] == this._id,
        localId: newStreamId + '.local',
        remoteAddress: remoteAddress
    };

    var wrappedMeta = {
        address: address,
        type: type,
        meta: meta
    };

    // Create the stream, or clean up if it fails.
    var stream;
    try {
        stream = this._multiplexer.createStream(wrappedMeta, opts, newStreamId);
    }
    catch (e) {
        delete this._streamInfo[newStreamId];
        throw e;
    }

    // If the stream ends, then clean-up
    var _this = this;
    stream.on('finish', function() {
        log.log(log.DEBUG2, 'Cleaning up old stream after end: %s', newStreamId);
        delete _this._streamInfo[newStreamId];
    });

    log.log(log.DEBUG2, 'Created new stream [local: %s] [id: %s]', streamInfo.local, newStreamId);

    return stream;
};

/**
 * Return information about a given stream
 * @param streamId
 */
Streamer.prototype.getStreamInfo = function(streamId) {
    return this._streamInfo[streamId];
};

/**
 * Add the given handler to the streamer.
 * @param name
 */
Streamer.prototype.addHandler = function(name) {
    this._handlers[name] = true;
    log.log(log.DEBUG3, 'Added stream handler [name: %s]', name);
};

/**
 * This function removes a valid handler from the streamer.
 * @param name
 */
Streamer.prototype.removeHandler = function(name) {
    if (this._handlers[name]) {
        delete this._handlers[name];
        log.log(log.DEBUG3, 'Removed stream handler [name: %s]', name);
    }
    else {
        log.log(log.WARN, 'That handler isn\'t registered [name: %s]', name);
    }
};

/**
 * Whether the given handler is registered
 * @param name
 */
Streamer.prototype.hasHandler = function(name) {
    if (this._handlers[name]) {
        return true;
    }
    return false;
};
