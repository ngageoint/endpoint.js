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

var Link = require('./link'),
    inherits = require('util').inherits,
    uuid = require('node-uuid'),
    expHash = require('../util/expirable-hash'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    through2 = require('through2');

inherits(ProtocolLink, Link);

module.exports = ProtocolLink;

/**
 * Abstract base class for links which require a protocol to establish
 * a link.  The protocol is based on a simple 3-step process:
 * - greetings - broadcast existence
 * - hi - reply to greetings
 * - ready - can start receiving data
 * @augments Link
 * @param instanceId - unique identifier for the endpoint.js instance
 * @param linkId - unique identifier for this link
 * @param {Object} settings
 * @constructor
 */
function ProtocolLink(instanceId, linkId, settings) {
    if (!(this instanceof ProtocolLink)) { return new ProtocolLink(instanceId, linkId, settings); }

    this._instanceId = instanceId;

    Link.call(this, linkId, settings);

    // Allow 15 seconds for hosts to establish a stream
    this._handshakes = expHash(15, 'Protocol link: ' + linkId);
    this._handshakes.on('expired', function(key, value) {
        log.log(log.WARN, 'Host exchange expired');
        value.closeFn();
    });

    // List of streamInfo, indexed by uuid.
    this._streams = {};
}

/**
 * In response to a greetings message, allocate a link
 * stream for this sender
 * @param fromUuid
 * @param [metadata]
 * @private
 */
ProtocolLink.prototype._handleGreeting = function(msg, edgeId, instanceId) {

    // This is the host we will report to our upper level/layer if this
    // is an external connection. We also use this as the 'sender' in
    // future messages
    var streamId = uuid();
    instanceId = instanceId || msg.s;
    edgeId = edgeId || uuid();

    // Ensure the values are valid.
    if (!appUtils.isUuid(instanceId) || !appUtils.isUuid(edgeId)) {
        throw new Error('Invalid instance or edge id');
    }

    // Destination information for the initial greeting
    var inject = {
        d: msg.s, // send initial replies to opposite greetings id.
        s: streamId
    };

    // Create the sender for this destination, as well as
    // the client side user stream.
    // Use a unique value for edgeId in case we have to
    // re-establish this link in the future (prevent collisions)
    var streamInfo = {
        streamId: streamId,
        instanceId: instanceId || msg.s,
        edgeId: this.isExternal() ? edgeId : instanceId,
        ready: false,
        readTransport: through2.obj(),
        sendTransport: this._createInjectStream(inject, msg),
        closeFn: endFunc
    };

    // When the stream ends, remove it
    var ended = false;
    var _this = this;
    function endFunc() {
        if (!ended) {
            log.log(log.DEBUG, 'Lost connection: [Link Type: %s] [Link ID: %s] [Edge ID: %s] [From: %s]',
                _this.getType(),
                _this.getId(),
                streamInfo.edgeId,
                streamInfo.instanceId);

            // Do not re-execute this code.
            ended = true;

            // Make sure both streams are ended
            streamInfo.readTransport.push(null);
            streamInfo.readTransport.end();

            // Remove from the cache (if it's there)
            if (streamInfo.ready) {
                delete _this._streams[streamId];
                // Tell anyone listening
                _this.emit('connection-close', _this, streamInfo.edgeId);
            }
            else {
                _this._handshakes.remove(streamId);
                // Need to force end the sendTransport, since link stream hasn't
                // been created yet, meaning it won't propagate the close.
                streamInfo.sendTransport.push(null);
                streamInfo.sendTransport.end();
            }
        }
    }

    streamInfo.sendTransport.on('finish', endFunc);
    streamInfo.sendTransport.on('end', endFunc);

    // Save the data for later
    this._handshakes.add(streamId, streamInfo);

    log.log(log.DEBUG, 'New connection: [Link Type: %s] [Link ID: %s] [Edge ID: %s] [From: %s]',
        this.getType(),
        this.getId(),
        streamInfo.edgeId,
        streamInfo.instanceId);

    return streamInfo;
};

/**
 * When a sender disconnects, then kill his link stream
 * @param destinationUuid
 * @param [metadata]
 * @private
 */
ProtocolLink.prototype._handleGoodbye = function(msg) {
    var streamInfo = this._streams[msg.d];
    if (streamInfo) {
        // This will trigger the link close.
        streamInfo.readTransport.push(null);
        streamInfo.readTransport.end();
    }
};

/**
 * Creates a writer that can send protocol messages via the 'sendProtocolCommand'
 * and sends the message
 * @param command
 * @param [message]
 * @returns {Error}
 * @private
 */
ProtocolLink.prototype._sendProtocolCommand = function(toUuid, command, message) {
    var streamInfo = this._streams[toUuid] || this._handshakes.get(toUuid);
    if (streamInfo) {
        this._sendProtocolCommandTo(streamInfo.sendTransport, command, message);
    }
};

/**
 * Send a protocol command to a specific host (transport)
 * @param transport
 * @param command
 * @param message
 * @private
 */
ProtocolLink.prototype._sendProtocolCommandTo = function(transport, command, message) {
    transport.write({
        p: command,
        m: message
    });
};

/**
 * This function will create a writer stream to the given destination
 */
ProtocolLink.prototype._createInjectStream = function(inject, metadata) {
    // Add the destination, only if the 'p' protocol flag isn't
    // set.
    var writeStream = through2.obj(
        function(chunk, encoding, cb) {
            for (var prop in inject) {
                chunk[prop] = inject[prop];
            }
            this.push(chunk);
            cb();
        });
    writeStream.updateInject = function(data) {
        inject = data;
    };

    // Pipe the write stream through a sender stream
    writeStream.pipe(this._createSenderStream(metadata));
    return writeStream;
};

/**
 * Happens as soon as the destination has created its buffer streams
 * and is ready for me to start sending messages
 * @param msg
 * @private
 */
ProtocolLink.prototype._handleReady = function(msg, hisInstanceId) {

    var streamId = msg.d;

    var streamInfo = this._handshakes.get(streamId);
    if (streamInfo && !streamInfo.ready) {

        // Update his instance id if he specified it
        if (hisInstanceId) {
            // Ensure the values are valid.
            if (!appUtils.isUuid(hisInstanceId)) {
                throw new Error('Invalid instance id');
            }
            streamInfo.instanceId = hisInstanceId;
        }

        // Address messages the way he wants them.
        streamInfo.sendTransport.updateInject({
            d: msg.s
        });

        streamInfo.ready = true;

        // Move the stream to this._streams
        this._streams[streamInfo.streamId] = streamInfo;
        this._handshakes.remove(streamInfo.streamId);

        // Tell listeners
        this.emit('connection',
            this,
            streamInfo.edgeId,
            {
                read: streamInfo.readTransport,
                write: streamInfo.sendTransport
            },
            streamInfo.instanceId);

        return true;
    }

    return false;
};

/**
 * This is a message chunk from an external source (fromUuid)
 * directed at me
 * @param fromUuid
 * @param message
 * @private
 */
ProtocolLink.prototype._handleReader = function(reader) {

    var assignedReaders = {};

    // This will keep track of this messenger locally in this closure, so
    // that if the reader transport fails, we can kill all the dependent
    // streams
    var registerReader = function(streamId) {
        if (!assignedReaders[streamId]) {
            assignedReaders[streamId] = this._streams[streamId].readTransport;
            assignedReaders[streamId].once('end', function() {
                delete assignedReaders[streamId];
            });
        }
    }.bind(this);

    var handle = function() {
        var msg;
        while ((msg = reader.read()) !== null) {

            if (!msg || !msg.d) {
                continue;
            }

            try {

                var streamInfo;
                if (msg.p) {
                    // Respond to protocol events.  Mostly from hello's and goodbyes.
                    switch (msg.p) {
                        case 'greetings':
                            if (msg.d == 'broadcast') {

                                // Make sure it's not from myself.  IE bug!
                                if (msg.s != this._instanceId) {

                                    // Message sent that says 'Hi, I'm new here!'
                                    streamInfo = this._handleGreeting(msg);

                                    // Reply to destination that we're here.
                                    this._sendProtocolCommand(streamInfo.streamId, 'hi',
                                        {
                                            i: this._instanceId,
                                            e: streamInfo.edgeId
                                        });
                                }
                            }
                            break;

                        case 'hi':
                            if (msg.d == this._instanceId && msg.m) {
                                // Message sent that says 'Hi, I'm new here!'
                                streamInfo = this._handleGreeting(msg, msg.m.e, msg.m.i);

                                // Reply to destination that we're ready.
                                this._sendProtocolCommand(streamInfo.streamId, 'ready');

                                // Seamlessly transition our destination id to the
                                // newly generated id.
                                msg.d = streamInfo.streamId;

                                // Create streams for the destination
                                this._handleReady(msg, msg.m.i);
                                registerReader(msg.d);
                            }
                            break;

                        case 'ready':
                            if (this._handleReady(msg)) {
                                registerReader(msg.d);
                            }
                            break;

                        case 'goodbye':
                            // Message sent that says 'Goodbye, I'm leaving!'
                            this._handleGoodbye(msg);
                            break;
                    }
                }
                else {
                    // Not a protocol message, send to the next layer.
                    streamInfo = this._streams[msg.d];
                    if (streamInfo) {
                        streamInfo.readTransport.push(msg);
                    }
                }
            }
            catch (e) {
                log.log(log.ERROR, 'Exception reading: %s', e.stack);
            }
        }
    }.bind(this);

    var terminate = function() {
        reader.removeListener('readable', handle);
        for (var streamId in assignedReaders) {
            assignedReaders[streamId].push(null);
        }
        assignedReaders = {};
    }.bind(this);

    reader.once('end', terminate);
    reader.on('readable', handle);
};

/**
 * Send the protocol message to the given destination
 * @param metadata
 * @private
 */
ProtocolLink.prototype._announce = function(metadata) {
    var inject = {
        d: 'broadcast',
        s: this._instanceId
    };
    var writeStream = this._createInjectStream(inject, metadata);
    this._sendProtocolCommandTo(writeStream, 'greetings');
    writeStream.end();
};

/**
 * Will manually create a 'send' transport stream for the specific destination
 * @param destinationUuid
 * @param [metadata]
 * @returns {*}
 * @private
 */
ProtocolLink.prototype._createSenderStream = function(metadata) {
    return new Error('not implemented');
};

/**
 * Close the specific stream key.
 * @param streamKey
 */
ProtocolLink.prototype.closeLink = function(streamKey) {
    // This will trigger the close of this stream
    var streamInfo = this._streams[streamKey];
    if (streamInfo) {
        this._sendProtocolCommandTo(streamInfo.sendTransport, 'goodbye');
        streamInfo.closeFn();
    }
};

/**
 * Close all open streams
 */
ProtocolLink.prototype.close = function() {

    // Close all streams
    var streamKeys = Object.keys(this._streams);
    streamKeys.forEach(function(streamKey) {
        this.closeLink(streamKey);
    }, this);

    // Tell parent
    Link.prototype.close.call(this);
};
