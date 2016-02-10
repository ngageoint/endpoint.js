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

var isArray = require('util').isArray,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

module.exports = PathVector;

/**
 * Path Vector will allow sending to destinations via a 'vector' instead of a single
 * internal address. The goal is to implement the IERP part of Zone Routing Protocol
 * (ZRP - https://en.wikipedia.org/wiki/Zone_Routing_Protocol)
 * @param {Router} routerInstance - an instance of the Router class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function PathVector(routerInstance, config) {
    if (!(this instanceof PathVector)) { return new PathVector(routerInstance, config); }

    this._id = config.get('instanceId');
    this._maxHops = config.get('maxHops');

    // Register with the router to track internal hosts
    this._routerInstance = routerInstance;
    this._routerInstance.addHandler('path');
    this._routerInstance.on('path', this._handlePathPacket.bind(this));
}

/**
 * Read a packet from the given address
 * @param packet
 * @param fromUuid - the immediate link we received the message from
 * @private
 */
PathVector.prototype._handlePathPacket = function(packet, fromUuid) {
    var toUuid = packet.d;

    if (isArray(toUuid)) {
        // Ensure the number of hops is less than max hops.
        if (toUuid.length > this._maxHops) {
            log.log(log.ERROR, 'Packet exceeds max hops (from %s), Total hops: %s',
                fromUuid,
                toUuid.length);
            return;
        }

        // Get the next host to send to, removing references to myself.
        var toHost = this._id;
        while (toHost == this._id && toUuid.length > 0) {
            toHost = toUuid[0];
            toUuid.shift();
        }

        if (toUuid.length > 0) {
            // More hops, continue using path protocol

            // If toUuid still has an entry, see if we know about it, if so, then route directly
            // to that host, instead of the intermediate host. We do this because in an internal
            // network, the next host will have the same routing table as me, so lets skip
            // the intermediary if there is one.
            if (toUuid.length > 0) {
                var route = this._routerInstance.getRoute(toUuid[0]);
                if (route && !route.external) {
                    toHost = toUuid[0];
                    toUuid.shift();
                }
            }

            this._routerInstance.sendPacket(toHost, 'path', packet, fromUuid);
        }
        else {
            // Send directly to the given host.
            this._routerInstance.sendPacket(toHost, packet.n, packet.m, fromUuid);
        }
    }
};

/**
 * Send the given packet to the given router handler.
 * @param address - vector to destination
 * @param name
 * @param packet
 */
PathVector.prototype.sendPacket = function(address, name, packet) {
    packet = {
        d: address.getPathVector(),
        n: name,
        m: packet
    };
    this._handlePathPacket(packet, 'local');
};
