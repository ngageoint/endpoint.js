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
    socketio = require('../transport/socketio'),
    through2 = require('through2'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(ServerLink, ProtocolLink);

module.exports = ServerLink;

/**
 * This link class handles connections for socket.io.  It will detect
 * whether it is in the browser or not and then add the appropriate link.
 * @augments ProtocolLink
 * @param {String} instanceId - unique identifier for this endpoint.js instance
 * @param {String} linkId - unique identifier for this link instance
 * @param {Object} settings
 * @param {String} settings.channel - the specific socket.io key to use for message transfer
 * @param {Boolean} settings.external - whether we trust this link (trust their routing table)
 * @param {Number} settings.maxClients - the maximum amount of clients we allow on this link
 * @constructor
 */
function ServerLink(instanceId, linkId, settings) {
    if (!(this instanceof ServerLink)) { return new ServerLink(instanceId, linkId, settings); }

    this._channel = settings.channel || 'local-channel';
    this._external = settings.hasOwnProperty('external') ? settings.external : true;
    this._maxClients = settings.hasOwnProperty('maxClients') ? settings.maxClients : 250;

    // Listening to the connect event from these sockets.
    this._listeners = [];

    // Total amount of clients connected currently
    this._currentClients = 0;

    // For handling new connections
    this._connectEventPtr = this._onConnect.bind(this);

    // Call the parent constructor.
    ProtocolLink.call(this, instanceId, linkId, settings);

    log.log(log.DEBUG2, 'Server Link initialized: [Settings: %j]', settings);
}

/**
 * If true, routing information from this host should be treated as
 * 'external', meaning it cannot affect the internal routing table
 */
ServerLink.prototype.isExternal = function() {
    return this._external;
};

/**
 * Adds a worker to the worker link (expects it to use Endpoint.js!)
 * @param worker
 */
ServerLink.prototype.addSocket = function(socket, isHub) {

    if (isHub) {

        // If we're a hub, then listen for the on-connect
        socket.on('connection', this._connectEventPtr);
        this._listeners.push(socket);

    }
    else {

        var _this = this;
        socket.on('connect', function() {
            var stream = _this._onConnect(socket);
            // Announce ourselves to the newly connected stream
            _this.announceSocket(stream);
        });
    }
};

/**
 * When a client connects to this hub, give the socket
 * here
 * @param event
 * @private
 */
ServerLink.prototype._onConnect = function(socket) {

    // Subscribe to data events from the socket.
    var transportStream = socketio({
        channel: this._channel,
        target: socket
    });

    if (this._currentClients >= this._maxClients) {
        log.log(log.WARN, 'Max clients connected. Closing new connection');
        transportStream.close();
        return;
    }

    // When the connection closes, then decrement current clients
    var _this = this;
    transportStream.on('finish', function() {
        _this._currentClients -= 1;
    });

    var readStream = through2.obj(function(chunk, encoding, cb) {
        chunk.stream = transportStream;
        this.push(chunk);
        cb();
    });

    transportStream.pipe(readStream);

    // Start reading messages
    this._handleReader(readStream);

    // Total clients connected
    this._currentClients += 1;

    return transportStream;
};

/**
 * Will manually create a 'send' transport stream for the specific destination
 * @param [metadata]
 * @returns {*}
 * @private
 */
ServerLink.prototype._createSenderStream = function(metadata) {
    var str = through2.obj();
    // Announce uses a quick sender stream and destroys it, so we don't want it
    // to kill the reader stream.  However, if the sender stream is killed, we
    // want it to propagate down to the transport stream, so it can kill
    // the reader stream.
    str.pipe(metadata.stream, metadata.announce ? { end: false } : undefined);
    return str;
};

/**
 * Manually announce to the given socket.
 * @param socket
 */
ServerLink.prototype.announceSocket = function(stream) {
    this._announce({stream:stream, announce: true});
};

/**
 * The cost to transmit to this link.  For tabs, since it uses
 * localstorage, we want to not use this as much as possible.
 * @returns {number}
 */
ServerLink.prototype.getCost = function() {
    return 100;
};

/**
 * Returns the type of link this is
 * @returns {string}
 */
ServerLink.prototype.getType = function() {
    return 'server';
};

/**
 * Remove event listeners, close streams
 */
ServerLink.prototype.close = function() {

    // Remove connect event listener for new ports
    if (this._listeners.length > 0) {
        this._listeners.forEach(function(listener) {
            listener.removeListener('connection', this._connectEventPtr);
        }, this);
        this._listeners = [];
    }

    // Close any streams (this will send goodbyes)
    ProtocolLink.prototype.close.call(this);
};
