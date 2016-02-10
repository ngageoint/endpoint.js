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
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Link, EventEmitter);

module.exports = Link;

/**
 * Abstract base class for links. This class uses an incrementing
 * value to identify links, and subscribes to the window object
 * to close each link before the window closes
 * @param {Number} linkId - the unique identifier for this link
 * @param {Object} settings
 * @param {Object} settings.transformFactory - a function for adding/removing transforms to a link stream
 * @param {Number} settings.heartbeatTimeout - amount of time to wait before killing link
 * @constructor
 */
function Link(linkId, settings) {
    if (!(this instanceof Link)) { return new Link(linkId, settings); }

    this._linkId = linkId;
    this._settings = settings;

    log.log(log.DEBUG, 'Link initialized: [Type: %s] [ID: %s]', this.getType(), this.getId());
}

/**
 * Returns the heartbeat timeout for this link. If no information is received in this
 * interval, then the link will timeout.  Default to 1.5 minutes
 */
Link.prototype.getHeartbeatTimeout = function() {
    return this._settings.heartbeatTimeout;
};

/**
 * A transform factory is a function that takes a {LinkTransform} interface and adds
 * additional read/write transforms to the link after a connection is made
 */
Link.prototype.getTransformFactory = function() {
    return this._settings.transformFactory;
};

/**
 * Returns the type of link this is
 * @returns {Error}
 */
Link.prototype.getType = function() {
    return new Error('not implemented');
};

/**
 * Return the unique id of this link.
 * @returns {*}
 */
Link.prototype.getId = function() {
    return this._linkId;
};

/**
 * The cost to transmit to this link
 * @returns {number}
 */
Link.prototype.getCost = function() {
    return 0;
};

/**
 * If true, routing information from this host should be treated as
 * 'external', meaning it cannot affect the internal routing table
 */
Link.prototype.isExternal = function() {
    return false;
};

/**
 * Close all open streams
 */
Link.prototype.close = function() {
    log.log(log.DEBUG, 'Link closed: [Type: %s] [ID: %s]', this.getType(), this.getId());
};
