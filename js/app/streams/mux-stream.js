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

var Transform = require('readable-stream').Transform,
    linkStream = require('./link-stream'),
    inherits = require('util').inherits,
    uuid = require('node-uuid'),
    through2 = require('through2'),
    xtend = require('xtend'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Multiplexer, Transform);

module.exports = Multiplexer;

/**
 * This is an object multiplexer. It will take a stream of objects,
 * and emit them as link streams.  You can also create a new stream.
 * @todo It works with object mode only for now.
 * @augments Transform
 * @param {Object} opts - Transform options based to Transform.
 * @constructor
 */
function Multiplexer(opts) {
    if (!(this instanceof Multiplexer)) { return new Multiplexer(opts); }
    this._streams = {};

    opts = opts || {};
    this._opts = opts;

    this.on('end', function() {
        this.close();
    }.bind(this));

    this.on('finish', function() {
        this.close();
    }.bind(this));

    Transform.call(this, { objectMode: true });

    // By default, event emitters throw a warning if you register more than
    // 11 listeners.  Since we're piping tons of streams to myself, this
    // isn't an issue.
    this.setMaxListeners(0);
}

/**
 * Create a stream on this side, and tell the other side
 * about it.
 * @param opts
 * @param meta
 * @param messageMeta - metadata sent with each message
 * @returns {*}
 */
Multiplexer.prototype.createStream = function(meta, opts, streamId) {

    streamId = streamId || uuid();

    opts = opts || {};

    var stream = this._createStream(meta, opts, streamId);

    var wrappedMeta = {
        meta: meta,
        opts: {
            objectMode: opts.hasOwnProperty('objectMode') ? opts.objectMode : false
        }
    };

    // Send the meta.
    this._sendProtocol(streamId, 'new', wrappedMeta);

    return stream;
};

/**
 * Create the internal stream with the given opts.
 * @param streamId
 * @param opts
 * @returns {*}
 * @private
 */
Multiplexer.prototype._createStream = function(meta, opts, streamId) {

    if (this._streams[streamId]) {
        var error = new Error('That stream already exists');
        log.log(log.ERROR, error.message);
        throw error;
    }

    //Read:
    // this._transform -> protocolReaderStream -> link-stream
    //Write:
    // link-stream -> pressureStream -> protocolStream -> this._transform

    var pressureStream = through2.obj(function(chunk, encoding, cb) {
        this.push(chunk);
        // Don't write anymore if backpressure is reported.
        if (streamInfo.backPressure) {
            streamInfo.backPressureCB = cb;
        }
        else {
            cb();
        }
    });

    // Add some metadata (the uuid)
    var protocolStream = through2.obj(function(chunk, encoding, cb) {
        chunk = {
            m: chunk
        };
        chunk.local = true;
        chunk.id = streamId;
        this.push(chunk);
        cb();
    });

    // Decode the protocl stream
    var protocolReaderStream = through2.obj(function(chunk, encoding, cb) {
        this.push(chunk.m);
        cb();
    });

    // Pipe the encoder to the protocol stream, and the protocol stream to me.
    pressureStream.pipe(protocolStream);
    protocolStream.pipe(this, {
        end: false
    });

    // Interface to the rest of the application
    var stream = linkStream({
        readTransport: protocolReaderStream,
        sendTransport: pressureStream
    }, opts);

    // Record the stream id.
    stream.id = streamId;

    var streamInfo = this._streams[streamId] = {
        id: streamId,
        read: protocolReaderStream,
        write: protocolStream,
        meta: meta,
        linkStream: stream,
        backPressure: false,
        backPressureCB: null,
        receivedEnd: false,
        flowing: true
    };

    // When the stream ends
    var ended = false;
    var _this = this;
    function endFunc() {
        if (!ended) {
            // Tell the other side, but only if we closed it.
            if (!streamInfo.receivedEnd) {
                _this._sendProtocol(streamId, 'end');
            }
            // Unpipe the protocol stream.
            protocolStream.unpipe();
            // End everything
            streamInfo.read.end();
            streamInfo.read.push(null);
            delete _this._streams[streamId];
            ended = true;
        }
    }
    stream.on('end', endFunc.bind(this));
    stream.on('finish', endFunc.bind(this));

    // Pressure!
    stream.on('back-pressure', function() {
        // Report back-pressure
        if (streamInfo.flowing) {
            this._sendProtocol(streamId, 'pause');
            streamInfo.flowing = false;
        }
    }.bind(this));

    // No more pressure!
    stream.on('back-pressure-relieved', function() {
        // Report relief
        if (!streamInfo.flowing) {
            this._sendProtocol(streamId, 'resume');
            streamInfo.flowing = true;
        }
    }.bind(this));

    log.log(log.TRACE, 'Created stream: %s', streamId);

    // Return the stream
    return stream;
};

/**
 * Router.  Route date internally and externally.
 * @param chunk
 * @param encoding
 * @param cb
 * @private
 */
Multiplexer.prototype._transform = function(chunk, encoding, cb) {
    if (chunk.local) {
        // Local data destined for external (so pipe can work)
        delete chunk.local;
        log.log(log.TRACE, 'Sending message: %j', chunk);
        this.push(chunk);
    }
    else {
        log.log(log.TRACE, 'Received message: %j', chunk);
        var streamInfo = this._streams[chunk.id];
        if (chunk.m && chunk.m.p) {
            this._handleProtocol(streamInfo, chunk);
        }
        else {
            // Remote data destined for local
            if (!streamInfo) {
                log.log(log.ERROR, 'Unknown stream: %s', chunk.id);
                // Special case of protocol, where we have no idea
                // what this stream is
                this.write({
                    id: chunk.id,
                    local: true,
                    p: 'error'
                });
            }
            else {
                streamInfo.read.write(chunk);
            }
        }
    }
    cb();
};

/**
 * Handles the protocl message.  Supports new, end,
 * pause, and resume (for back-pressure)
 * @param msg
 * @private
 */
Multiplexer.prototype._handleProtocol = function(streamInfo, msg) {
    log.log(log.DEBUG3, 'Received protocol message: [msg: %s] [id: %s]', msg.m.p, msg.id);
    if (!streamInfo) {
        if (msg.m.p == 'new') {
            var userMeta = msg.m.meta.meta;
            var opts = msg.m.meta.opts;
            var objectMode = opts.objectMode;
            // Special case where we allow object mode property to be
            // copied.
            var newOpts = xtend(this._opts, {
                objectMode: objectMode
            });
            var str = this._createStream(null, newOpts, msg.id);
            str.meta = userMeta;
            this.emit('stream', str, newOpts);
        }
    }
    else {
        switch (msg.m.p) {
            case 'new':
                log.log(log.ERROR, 'That stream is already open: %s', msg.id);
                streamInfo.linkStream.end();
                break;
            case 'error':
                // Happens on error (unknown stream)
                streamInfo.linkStream.end();
                break;
            case 'end':
                streamInfo.receivedEnd = true;
                streamInfo.linkStream.end();
                break;
            case 'pause':
                streamInfo.backPressure = true;
                break;
            case 'resume':
                streamInfo.backPressure = false;
                if (streamInfo.backPressureCB) {
                    var cb = streamInfo.backPressureCB;
                    streamInfo.backPressureCB = null;
                    cb();
                }
                break;
        }
    }
};

/**
 * Send a protocol message through the multiplexer
 * @param streamId
 * @param msg
 * @param meta
 * @private
 */
Multiplexer.prototype._sendProtocol = function(streamId, msg, meta) {
    var streamInfo = this._streams[streamId];
    if (!streamInfo) {
        log.log(log.ERROR, 'Unknown stream: %s', streamId);
    }
    log.log(log.DEBUG3, 'Sending protocol message: [msg: %s] [id: %s]', msg, streamId);
    meta = meta || {};
    streamInfo.write.write({
        p: msg,
        meta: meta
    });
};

/**
 * Return the stream for the given id, if i know about it.
 * @param id
 */
Multiplexer.prototype.getStream = function(id) {
    var str = null;
    if (this._streams[id]) {
        str = this._streams[id].linkStream;
    }
    return str;
};

/**
 * Update metadata for a stream
 * @param id
 * @param meta
 */
Multiplexer.prototype.updateStreamMeta = function(id, meta) {
    if (this._streams[id]) {
        this._streams[id].meta = meta;
    }
    else {
        log.log(log.WARN, 'Can\'t update meta for stream ' +
            'I don\'t know about: %s', id);
    }
};

/**
 * Return the stream meta for the given id, if i know about it.
 * @param id
 */
Multiplexer.prototype.getStreamMeta = function(id) {
    var str = null;
    if (this._streams[id]) {
        str = this._streams[id].meta;
    }
    return str;
};

/**
 * Kill all streams
 */
Multiplexer.prototype.close = function() {
    var streams = Object.keys(this._streams);
    streams.forEach(function(streamId) {
        this._streams[streamId].linkStream.end();
    }, this);
};
