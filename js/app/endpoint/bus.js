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

var appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    address = require('../routing/address'),
    constants = require('../util/constants'),
    isArray = require('util').isArray,
    xtend = require('xtend'),
    inherits = require('util').inherits,
    EventEmitter = require('events').EventEmitter;

inherits(Bus, EventEmitter);

module.exports = Bus;

/**
 * The bus uses EventEmitter to create a global message bus.  It also uses
 * the router to propagate messages to all other nodes in the
 * network using a controlled flooding algorithm.
 * https://en.wikipedia.org/wiki/Flooding_(computer_networking)
 * @augments EventEmitter
 * @fires Bus#X - where X is the global event to fire
 * @param {Router} routerInstance - an instance of the Router class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function Bus(routerInstance, config) {
    if (!(this instanceof Bus)) { return new Bus(routerInstance, config); }

    this._id = config.get('instanceId');
    this._sequence = 1;

    // Call parent Constructor
    EventEmitter.call(this);
    this.setMaxListeners(0);

    // This is the host information
    this._hosts = {};

    // This allows us to look up bridges to ensure that the link is in the bridge
    this._linkAssociation = config.getLinkAssociation();

    // Register with the router
    this._routerInstance = routerInstance;
    this._routerInstance.addHandler('bus');
    this._routerInstance.on('route-available', this._handleRouteAvailable.bind(this));
    this._routerInstance.on('route-change', this._handleRouteChange.bind(this));
    this._routerInstance.on('route-unavailable', this._handleRouteLost.bind(this));
    this._routerInstance.on('bus', this._handleBusPacket.bind(this));
}

/**
 * When a new host is available, then register it.
 * @param address
 * @param cost
 * @private
 */
Bus.prototype._handleRouteAvailable = function(address, route) {

    this._hosts[address] = {
        address: address,
        linkId: route.linkId,
        adjacent: route.adjacent,
        external: route.external,
        sequence: -1
    };

    if (route.adjacent) {
        log.log(log.DEBUG, 'Discovered new adjacent host ' +
            '[id: %s]', address);
    }
    else {
        log.log(log.DEBUG, 'Discovered new non-adjacent host ' +
            '[id: %s]', address);
    }
};

/**
 * When the adjacency of a route changes
 * @param address
 * @param adjacent
 * @private
 */
Bus.prototype._handleRouteChange = function(address, route) {
    this._hosts[address].adjacent = route.adjacent;
    this._hosts[address].linkId = route.linkId;
};

/**
 * Remove the host from the registry.
 * @param address
 * @private
 */
Bus.prototype._handleRouteLost = function(address) {
    // Remove the host
    delete this._hosts[address];
};

/**
 * Read a packet from the given address
 * @param envelope
 * @param address - the immediate link we received the message from
 * @private
 */
Bus.prototype._handleBusPacket = function(packet, fromUuid, source) {

    // Is the immediate packet sender external?
    var fromInfo = this._hosts[fromUuid];
    if (!fromInfo) {
        log.log(log.WARN, 'Received bus packet from unknown host (ignoring): %s', fromUuid);
        return;
    }

    if (!isArray(packet.path) || !isArray(packet.event)) {
        log.log(log.WARN, 'Invalid packet from %s: %j', fromUuid, packet);
        return;
    }

    // Process the packet based on whether it originated internally or
    // externally.  This 'sequenceHost' is either the internal network
    // originator, or the external uuid if external.
    var sequenceHost;
    if (fromInfo.external) {
        sequenceHost = this._handleExternalBusPacket(packet, fromInfo);
    }
    else {
        sequenceHost = this._handleInternalBusPacket(packet, fromUuid);
    }

    if (!sequenceHost) {
        return;
    }

    // Cleanup the sequence number
    packet.seq = parseInt(packet.seq);

    // Update the sequence information
    if (packet.seq <= sequenceHost.sequence) {
        log.log(log.TRACE, 'Ignored duplicate event packet: %j', packet);
        return;
    }
    sequenceHost.sequence = packet.seq;

    if (fromInfo.external) {
        // Fake the message as having come from us within our
        // little internal network.  I will be the 'originator' within
        // the internal network.
        packet.seq = this._sequence++;
    }

    // I don't want to send this packet along if I've already seen it.
    // Check the 'path' value to see if it has the given sequenceHost in
    // it already (more than once, since I just appended it), or
    // if it has my id.
    if (this._hasAlreadySeenPacket(packet, sequenceHost)) {
        log.log(log.TRACE, 'Already seen that packet (path violation)');
        return;
    }

    // Log
    log.log(log.TRACE, 'Read event packet: %j', packet);

    this._emitPacket(packet, source);
    this._forwardPacket(packet, fromInfo, null);
};

/**
 * This function will attempt to find more than two instances of the originator host,
 * or at least one instance of myself.  If it finds either, then it will return
 * true, otherwise false.
 * @param packet
 * @param originatorHost
 * @private
 */
Bus.prototype._hasAlreadySeenPacket = function(packet, originatorHost) {
    var count = 0;
    for (var i = 0; i < packet.path.length; i++) {
        if (packet.path[i] == originatorHost.address) {
            count += 1;
        }
        if (packet.path[i] == this._id || count >= 2) {
            return true;
        }
    }
    return false;
};

/**
 * Received the packet from internal. Just ensure we know who it came from.
 * @param packet
 * @returns {*}
 * @private
 */
Bus.prototype._handleInternalBusPacket = function(packet, fromUuid) {

    if (packet.path.length === 0) {
        log.log(log.WARN, 'Empty path from %s: %j', fromUuid, packet);
        return false;
    }

    // Take the most recent host in the path vector.  This was the host in our
    // group that decided to re-send the message to me (or it was the external
    // host that sent the message to me)
    var originatorUuid = packet.path[packet.path.length - 1];

    // Do we know about the originator? If not, ignore
    // Is the immediate packet sender external?
    var originatorInfo = this._hosts[originatorUuid];
    if (!originatorInfo) {
        log.log(log.WARN, 'Received bus packet from unknown originator (ignoring): %s', originatorUuid);
        return false;
    }

    return originatorInfo;
};

/**
 * Received the message from an external host. Set the src and mode,
 * and update the path to include the external link id.
 * @param packet
 * @param fromInfo
 * @private
 */
Bus.prototype._handleExternalBusPacket = function(packet, fromInfo) {

    // Append the sending host
    packet.path = packet.path.concat(fromInfo.address);

    // If global, then we've gotten the message through an
    // external link.  We don't want to send it through any more external
    // links, so change it to 'group' mode.
    if (packet.mode === constants.Neighborhood.GLOBAL) {
        packet.mode = constants.Neighborhood.GROUP;
    }

    return fromInfo;
};

/**
 * Handles EventEmitter messages
 * @param packet - the packet containing the event to emit
 * @param source - the source of the packet, @see{constants.Neighborhood}
 * @private
 */
Bus.prototype._emitPacket = function(packet, source) {
    try {
        if (EventEmitter.listenerCount(this, packet.event[0])) {
            var deliveryAddress = address(packet.path.concat(this._id));
            var eventCopy = packet.event.slice(0);
            eventCopy.splice(1, 0, deliveryAddress, source);
            EventEmitter.prototype.emit.apply(this, eventCopy);
        }
    }
    catch (e) {
        log.log(log.ERROR, 'Exception executing event: %s %s', e.message, e.stack);
    }
};

/**
 *
 * @param envelope
 * @param fromExternal
 * @private
 */
Bus.prototype._forwardPacket = function(envelope, fromInfo, destinationBridgeId, destinationHostId) {

    // Only send if we're in something greater than local mode!
    if (envelope.mode <= constants.Neighborhood.LOCAL) {
        return;
    }

    var fromSelf = envelope.path.length === 0;
    var fromExternal = fromInfo ? fromInfo.external : false;
    var fromUuid = fromInfo ? fromInfo.address : 'local';

    // Special envelope that has myself appended to the path.
    var envelopeWithPathSequence;
    var envelopeWithPath;

    // Do not re-send the message to any host in the path vector
    // Using a hash here even though the array size is small because
    // indexOf isn't supported in IE8
    var ignoreHosts = {};
    for (var j = 0; j < envelope.path.length; j++) {
        ignoreHosts[envelope.path[j]] = true;
    }
    ignoreHosts[fromUuid] = true;

    log.log(log.TRACE, 'Relay event packet to hosts: %j', envelope);

    // Lookup the bridge
    var bridge;
    if (destinationBridgeId) {
        bridge = this._linkAssociation.getBridge(destinationBridgeId);
    }

    for (var host in this._hosts) {
        if (!ignoreHosts || !ignoreHosts[host]) {
            var hostInfo = this._hosts[host];

            // If this is a bridge destination, then get the link id and ensure it's in
            // the bridge.
            if (bridge) {
                if (!bridge.hasLinkId(hostInfo.linkId)) {
                    continue;
                }
            }

            // If the user has specified a host, then only emit to that host.
            if (destinationHostId) {
                if (host !== destinationHostId) {
                    continue;
                }
            }

            // Only send to adjacent hosts
            if (hostInfo.adjacent) {

                // Only send if we're sending internal or we're sending to external
                // and we have at least Neighborhood.GLOBAL
                if (!hostInfo.external ||
                    (hostInfo.external &&
                        envelope.mode > constants.Neighborhood.GROUP)) {

                    // Append my id to the path in special circumstances (outlined below).
                    // When sending external, we don't append, because the external host will
                    // append me in the appropriate circumstances.
                    var envelopeToSend = envelope;
                    if ((fromExternal && !hostInfo.external) || // from external to internal
                        (fromSelf && !hostInfo.external) || // from self to internal
                        (!fromSelf && !fromExternal && hostInfo.external)) { // from internal to external
                        // append path
                        if (!envelopeWithPath) {
                            envelopeWithPath = xtend(envelope, {
                                path: envelope.path.concat(this._id)
                            });
                        }
                        envelopeToSend = envelopeWithPath;
                    }

                    // If we're sending external, and it's not from ourself, then
                    // we need to increment the sequence number.
                    if (!fromSelf && hostInfo.external) {
                        // append path
                        if (!envelopeWithPathSequence) {
                            envelopeWithPathSequence = xtend(envelope, {
                                path: envelope.path.concat(this._id),
                                seq: this._sequence++
                            });
                        }
                        envelopeToSend = envelopeWithPathSequence;
                    }

                    this._routerInstance.sendPacket(host, 'bus', envelopeToSend, fromUuid);
                }
            }
        }
    }
};

/**
 * Create the packet to send to external hosts
 * @param neighborhood
 * @param arguments
 * @private
 */
Bus.prototype._createPacket = function(neighborhood, event) {
    var packet = {
        event: event,
        seq: this._sequence++,
        mode: neighborhood,
        path: []
    };
    return packet;
};

/**
 * Send to given host and neighborhood only
 * @param destinationBridgeId - only send to all links in this bridge
 * @param destinationHostId - only send to this host (as long as it's in the destination bridge)
 * @param neighborhood
 */
Bus.prototype.emitDirect = function(destinationBridgeId, destinationHostId, neighborhood) {
    var packet = this._createPacket(neighborhood, this._convertArgs(arguments, 3));
    this._forwardPacket(packet, null, destinationBridgeId, destinationHostId);
};

/**
 * Send to given neighborhood
 * @param neighborhood
 */
Bus.prototype.emit = function(neighborhood) {
    var packet = this._createPacket(neighborhood, this._convertArgs(arguments, 1));
    this._emitPacket(packet, constants.Neighborhood.LOCAL);
    this._forwardPacket(packet, null, null, null);
};

/**
 * Convert the given arg array into an array
 * @param args
 * @returns {Array}
 * @private
 */
Bus.prototype._convertArgs = function(args, start) {
    var event = [];
    for (var i = start; i < args.length; i++) {
        event.push(args[i]);
    }
    return event;
};
