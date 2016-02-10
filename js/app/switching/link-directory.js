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
    expHash = require('../util/expirable-hash'),
    linkTransform = require('./link-transform'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(LinkDirectory, EventEmitter);

module.exports = LinkDirectory;

/**
 * Link directory keeps track of the different
 * links available to the application, and their connections.
 * It sends the connections as events to the switchboard, and
 * the disconnections as well.
 * @augments EventEmitter
 * @fires LinkDirectory#connection (link, fromUuid, streams)
 * @fires LinkDirectory#connection-close (link, fromUuid)
 * @param {Object} opts - options used to create a new link stream
 * @constructor
 */
function LinkDirectory(opts) {
    if (!(this instanceof LinkDirectory)) { return new LinkDirectory(opts); }

    EventEmitter.call(this);

    // This is a list of links, indexed by id
    this._links = {};

    // Expired edges.  These external edges have disconnected, but
    // we keep them around for a few seconds to allow un-routed packets
    // to fail.
    this._expiredEdges = expHash(60, 'Link Directory');

    // This keeps track of connected external edge ids, so that no one else
    // can use the same id of a connected host.
    this._externalEdges = {};

    // New link streams are created with these opts
    opts = opts || {};
    if (!opts.hasOwnProperty('objectMode')) {
        opts.objectMode = true;
    }
    this._opts = opts;
}

/**
 * Handle the connection of a new stream from a certain link and Endpoint.js
 * @param link
 * @param streamId - a unique identifier which identifies this private stream
 * @param fromUuid - public identifier used for routing
 * @param streams
 * @private
 */
LinkDirectory.prototype._handleConnection = function(link, vertexId, streams) {

    // Log the new connection
    log.log(log.INFO, 'New connection for: [fromUuid: %s] [Link Type: %s] [External: %s] [Link Id: %s]',
        vertexId, link.getType(), link.isExternal(), link.getId());

    // How long to wait for timeout of link
    var timeout = link.getHeartbeatTimeout();

    // Create the transform object, to allow the transform factory to modify it.
    var transform = linkTransform(this._opts, streams.read, streams.write, timeout);

    // Create the stream
    var factory = link.getTransformFactory();
    if (typeof (factory) == 'function') {
        factory(transform);
    }

    // Get the completed stream
    var stream = transform.getLinkStream();

    if (link.isExternal()) {
        if (this._externalEdges[vertexId] || this._expiredEdges.get(vertexId)) {
            // Don't allow repeat vertices
            log.log(log.WARN, 'Host attempted to use the same external vertex id: %s', vertexId);
            stream.end();
            return;
        }
        this._externalEdges[vertexId] = true;
        // This is to distinguish the vertex from internal.
        vertexId += '-ext';
    }

    this.emit('connection', link, vertexId, stream);

};

/**
 * Handles the disconnection from a specific link and Endpoint.js
 * @param link
 * @param stream
 * @param fromUuid
 * @private
 */
LinkDirectory.prototype._handleConnectionClose = function(link, vertexId) {

    // Log the new connection
    log.log(log.INFO, 'Closed connection: [fromUuid: %s] [Link Type: %s] [External: %s] [Link Id: %s]',
        vertexId, link.getType(), link.isExternal(), link.getId());

    if (link.isExternal()) {
        if (!this._externalEdges[vertexId]) {
            return;
        }
        this._expiredEdges.add(vertexId, true);
        // This is to distinguish the vertex from internal.
        vertexId += '-ext';
    }

    this.emit('connection-close', link, vertexId);
};

/**
 * Whether the link is registered in this
 * switchboard.
 * @param linkId
 * @returns {boolean}
 */
LinkDirectory.prototype.hasLink = function(linkId) {
    if (this._links[linkId]) {
        return true;
    }
    return false;
};

/**
 * Return the link with the given id.
 * @param linkId
 */
LinkDirectory.prototype.getLink = function(linkId) {
    if (this.hasLink(linkId)) {
        return this._links[linkId]._link;
    }
    return null;
};

/**
 * This function takes a 'link' object from the ../link folder.  It listens
 * for two events, stream-connection, and stream-connection-close.
 * @param link
 */
LinkDirectory.prototype.addLink = function(link) {

    if (this.hasLink(link.getId())) {
        throw new Error('Link already registered');
    }

    var linkPtr = this._links[link.getId()] = {
        _link: link,
        _connectionPtr: this._handleConnection.bind(this),
        _connectionClosePtr: this._handleConnectionClose.bind(this)
    };

    // Register event listener for new connection
    link.on('connection', linkPtr._connectionPtr);

    // Register event listener for new disconnection
    link.on('connection-close', linkPtr._connectionClosePtr);

    log.log(log.DEBUG, 'Added link: [Link Type: %s] [External: %s] [Link ID: %s]',
        link.getType(), link.isExternal(), link.getId());
};

/**
 * Remove the link from internal structures.  This does NOT
 * close the link, or its connections, only stops
 * using them.
 * @param link
 * @private
 */
LinkDirectory.prototype.removeLink = function(link) {
    if (this.hasLink(link.getId())) {
        var linkPtr = this._links[link.getId()];

        // Close all the connections on the link
        linkPtr._link.close();

        // Unsubscribe from the link
        linkPtr._link.removeListener('connection', linkPtr._connectionPtr);
        linkPtr._link.removeListener('connection-close', linkPtr._connectionClosePtr);

        // Remove the internal reference to the link
        delete this._links[linkPtr._link.getId()];

        log.log(log.DEBUG, 'Removed link: [Link Type: %s] [Link ID: %s]',
            linkPtr._link.getType(), linkPtr._link.getId());
    }
};

/**
 * Close all our links
 */
LinkDirectory.prototype.close = function() {
    // Remove all links
    var links = Object.keys(this._links);
    links.forEach(function(linkId) {
        this.removeLink(this.getLink(linkId));
    }, this);
};
