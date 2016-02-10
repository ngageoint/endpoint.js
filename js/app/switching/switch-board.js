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
    switchStream = require('./switch-stream'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(SwitchBoard, EventEmitter);

module.exports = SwitchBoard;

/**
 * Manage connections with all other peers.  This class emits several based on
 * different link activity within the system.
 * @fires SwitchBoard#link-available - when a link is acquired to an adjacent Endpoint.js.
 * @fires SwitchBoard#link-unavailable - when no links are any longer available to the given
 *                adjacent Endpoint.js
 * @fires SwitchBoard#link-switch - when a link switches to another interface
 * @fires SwitchBoard#X - event emitted when a packet of a certain protocol is intercepted
 * @param {Configuration} config - system configuration
 * @constructor
 */
function SwitchBoard(linkDirectory, config) {
    if (!(this instanceof SwitchBoard)) { return new SwitchBoard(linkDirectory, config); }

    EventEmitter.call(this);

    this._id = config.get('instanceId');

    // A list of packet handlers indexed by name.
    this._handlers = {};

    // This is the list of all endpoints indexed by unique id.
    // An endpoint is a particular adjacent Endpoint.js.
    this._endpoints = {};

    // Subscribe to link events
    this._linkDirectory = linkDirectory;
    this._linkDirectory.on('connection', this._handleConnection.bind(this));
    this._linkDirectory.on('connection-close', this._handleConnectionClose.bind(this));
}

/**
 * Handle the connection of a new stream from a certain link and Endpoint.js
 * @param link
 * @param stream
 * @param fromUuid
 * @private
 */
SwitchBoard.prototype._handleConnection = function(link, fromUuid, stream) {

    var endpoint = this.getEndpoint(fromUuid);
    if (!endpoint) {

        // Make sure it's valid.
        if (fromUuid == 'local' || fromUuid == this._id) {
            log.log(log.ERROR, 'Reserved link name used: local');
            stream.end();
            return;
        }

        this._endpoints[fromUuid] = endpoint = {
            switchStream: switchStream({objectMode: true}),
            activeLink: link,
            streams: {} // indexed by link id
        };

        var _this = this;

        // Handle raw packets, by determining where to send them.
        endpoint.switchStream.on('readable', function() {
            var msg;
            while ((msg = endpoint.switchStream.read()) !== null) {
                _this._handleRawInbound(fromUuid, msg);
            }
        });

        // When a switch-stream switches, report it to the higher levels
        endpoint.switchStream.on('switch', function(cost, link) {
            endpoint.activeLink = link;
            _this.emit('link-switch', fromUuid, link);
        });

        // Report ourself to the higher level
        this.emit('link-available',
            fromUuid, link);

        log.log(log.DEBUG2, 'Creating endpoint: %s', fromUuid);
    }

    if (!endpoint.streams[link.getId()]) {
        // Add the stream to the endpoint
        endpoint.streams[link.getId()] = stream;

        // Add the stream to the endpoint
        endpoint.switchStream.addStream(stream, link.getCost(), link);
    }
    else {
        log.log(log.WARN, 'Received a duplicate connection from [link: %s] for [host: %s]; closing it!',
            link.getId(), fromUuid);
        stream.end();
    }

};

/**
 * Handles the disconnection from a specific link and Endpoint.js
 * @param link
 * @param stream
 * @param fromUuid
 * @private
 */
SwitchBoard.prototype._handleConnectionClose = function(link, fromUuid) {

    // Make sure it's valid.
    if (fromUuid == 'local' || fromUuid == this._id) {
        log.log(log.ERROR, 'Reserved link name used: local');
        return;
    }

    if (!this.hasEndpoint(fromUuid)) {
        log.log(log.ERROR, 'The given endpoint does not exist: %s', fromUuid);
        throw new Error('The given endpoint does not exist: ' + fromUuid);
    }

    var endpoint = this.getEndpoint(fromUuid);

    // Remove the stream from the switch stream
    endpoint.switchStream.removeStream(endpoint.streams[link.getId()]);

    // Remove the stream from the endpoint
    delete endpoint.streams[link.getId()];

    // If there is no active link for this link, then close it.
    if (endpoint.switchStream.getNumberStreams() === 0) {
        log.log(log.DEBUG2, 'Removing endpoint: %s', fromUuid);
        endpoint.switchStream.end();
        delete this._endpoints[fromUuid];

        // Report ourself to the higher level
        this.emit('link-unavailable', fromUuid, link);
    }
};

/**
 * When a new packet comes in from a switch stream, decide where to
 * relay it to.
 * @param stream
 * @private
 */
SwitchBoard.prototype._handleRawInbound = function(fromUuid, packet) {
    // Is this a routing packet?
    if (packet.p && this.hasHandler(packet.p)) {
        this.emit(packet.p, packet.m, fromUuid);
    }
    else {
        log.log(log.ERROR, 'Unknown packet type: [type: %s]',
            packet.p);
    }
};

/**
 * Send the given packet to the given switch stream.
 * @param toUuid
 * @param name
 * @param packet
 */
SwitchBoard.prototype.sendPacket = function(toUuid, name, packet) {
    if (this.hasHandler(name) && this.hasEndpoint(toUuid)) {
        var endpoint = this.getEndpoint(toUuid);
        var wrappedPacket = {
            p: name,
            m: packet
        };
        endpoint.switchStream.write(wrappedPacket);
    }
    else {
        log.log(log.WARN, 'Attempted to send a packet to unregistered handler or endpoint' +
            ' [handler: %s] [endpoint: %s]', name, toUuid);
    }
};

/**
 * Send the packet to all the adjacent internal links
 * @param packet
 * @private
 */
SwitchBoard.prototype.broadcastInternal = function(name, packet) {
    for (var fromUuid in this._endpoints) {
        var endpoint = this.getEndpoint(fromUuid);
        if (!endpoint.activeLink.isExternal()) {
            this.sendPacket(fromUuid, name, packet);
        }
    }
};

/**
 * Add the given handler to the switch-board.  This isn't really used
 * for any functional reason other than to ensure we only emit
 * packet events for handlers we know about.
 * @param name
 * @param handler
 */
SwitchBoard.prototype.addHandler = function(name) {
    this._handlers[name] = true;
    log.log(log.DEBUG, 'Added packet handler [name: %s]', name);
};

/**
 * Whether the given handler is registered
 * @param name
 */
SwitchBoard.prototype.hasHandler = function(name) {
    if (this._handlers[name]) {
        return true;
    }
    return false;
};

/**
 * Load the 'endpoint' information for this particular endpoint.js instance id.
 * @param fromUuid
 * @returns {*}
 * @private
 */
SwitchBoard.prototype.getEndpoint = function(fromUuid) {
    var endpoint = this._endpoints[fromUuid];
    return endpoint;
};

/**
 * Return the directory that has the list of links managed by this
 * switchboard. This will also allow the caller to add new links
 * @returns {*}
 */
SwitchBoard.prototype.getLinkDirectory = function() {
    return this._linkDirectory;
};

/**
 * Whether the uuid is registered as an endpoint in this Endpoint.js.
 * @param fromUuid
 * @returns {boolean}
 */
SwitchBoard.prototype.hasEndpoint = function(fromUuid) {
    if (this._endpoints[fromUuid]) {
        return true;
    }
    return false;
};
