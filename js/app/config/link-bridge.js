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
    uuid = require('uuid'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(LinkBridge, EventEmitter);

module.exports = LinkBridge;

/**
 * A link bridge describes which links should participate in a bus
 * transaction.  The purpose is to limit the hosts we send bus
 * requests to.  For example, assume we have the following layout:
 * default-server (link for client/server)
 * cross-domain-xyz.com (link for cross domain web application)
 * We want our application to access services on both of these
 * Endpoint.js instances, but we don't want specific requests going
 * from client to server to be intercepted and overridden by ones from
 * cross-domain-xyz.com.
 * By default, the bus operates in a fully open mode.
 * @augments EventEmitter
 * @param selfRelay - whether links are associated / relay to themselves in this bridge.
 * @returns {LinkBridge}
 * @constructor
 */
function LinkBridge(selfRelay) {
    if (!(this instanceof LinkBridge)) return new LinkBridge(selfRelay);
    EventEmitter.call(this);
    this._id = uuid();
    this._selfRelay = !!selfRelay;
    this._links = {};
}

/**
 * Return a unique identifier for storing in a hash table
 */
LinkBridge.prototype.getId = function() {
    return this._id;
};

/**
 * Return whether the link id is in the bridge.
 * @param linkId
 */
LinkBridge.prototype.hasLinkId = function(linkId) {
    return !!this._links[linkId];
};

/**
 * Add a specific link from this bridge, emit events
 * @param linkId
 */
LinkBridge.prototype.addLinkId = function(linkId) {
    var id = this._links[linkId];
    if (!id) {
        this._event('add-association', linkId);
        this._links[linkId] = true;
    }
};

/**
 * Remove a specific link from this bridge, emit events
 * @param linkId
 */
LinkBridge.prototype.removeLinkId = function(linkId) {
    var id = this._links[linkId];
    if (id) {
        delete this._links[linkId];
        this._event('remove-association', linkId);
    }
};

/**
 * Emit bi-directional events to the link-associations
 * @param type
 * @param linkId
 * @private
 */
LinkBridge.prototype._event = function(type, linkId) {
    if (this._selfRelay) {
        log.log(log.DEBUG3, 'Emitting self relay %s for %s', type, linkId);
        this.emit(type, linkId, linkId);
    }
    Object.keys(this._links).forEach(function(existingLink) {
        log.log(log.DEBUG3, 'Emitting %s for %s <-> %s', type, linkId, existingLink);
        this.emit(type, existingLink, linkId);
        this.emit(type, linkId, existingLink);
    }, this);
};

/**
 * Emit event to remove all associations added by this bridge
 */
LinkBridge.prototype.close = function() {
    Object.keys(this._links).forEach(function(linkId) {
        this._event('remove-association', linkId);
    }, this);
    this.emit('closed', this.getId());
};
