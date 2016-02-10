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
    constants = require('../util/constants'),
    routingTable = require('./routing-table'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(Router, EventEmitter);

module.exports = Router;

/**
 * The router is responsible for finding the best route from
 * one Endpoint.js to another.  It uses the routing table, listening from
 * routing events from the switch board, and sends
 * @augments EventEmitter
 * @fires Router#route-available (toId, adjacent)
 * @fires Router#route-change (toId, adjacent)
 * @fires Router#route-unavailable (toId)
 * @fires Router#X (packet) when a packet is available for a particular handler
 * @fires Router#X-error (fromId, toId, packet) - when a problem occurs routing a packet
 *                                 for a specific handler type
 * @param {SwitchBoard} switchBoardInstance - an instance of the SwitchBoard class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function Router(switchBoardInstance, config) {
    if (!(this instanceof Router)) return new Router(switchBoardInstance, config);

    EventEmitter.call(this);
    this.setMaxListeners(0);

    this._id = config.get('instanceId');

    // A list of packet handlers indexed by name.
    this._handlers = {};

    // Only allow relay for the given bridges.
    this._linkAssociation = config.getLinkAssociation();

    // Routes that are updated through 'route-update' protocol on switchboard.
    this._routes = {};
    this._routes[this._id] = {
        // Whether we are using an adjacent route
        adjacent: true,
        // The current list of next hops for a given host, updated by routing table.
        nextHop: this._id,
        // Whether this item has been reported as a route (or reported via switchboard)
        reported: false,
        // Whether this host is hosted on an external link
        external: false
    };

    // Create a routing table and subscribe to events
    this._routingTable = routingTable(this._id);
    this._routingTable.on('route-update', this._handleRouteUpdate.bind(this));
    this._routingTable.on('route-expired', this._handleRouteExpire.bind(this));

    // Register with the switch board.
    this._switchBoard = switchBoardInstance;
    this._switchBoard.addHandler('route');
    this._switchBoard.addHandler('route-update');
    this._switchBoard.on('link-unavailable', this._handleLinkLost.bind(this));
    this._switchBoard.on('link-switch', this._handleLinkSwitch.bind(this));
    this._switchBoard.on('route', this._handleRoutePacket.bind(this));
    this._switchBoard.on('route-update', this._handleRouteUpdatePacket.bind(this));
}

/**
 * When a new packet comes in from a switch stream, decide where to
 * relay it to.
 * @param stream
 * @private
 */
Router.prototype._handleRoutePacket = function(packet, fromUuid) {

    var toUuid = packet.d;

    // Ensure we know about this host.
    var fromRoute = this._routes[fromUuid];
    if (!fromRoute && fromUuid != 'local') {
        log.log(log.WARN, 'Message originated from unknown endpoint: %s', fromUuid);
        return;
    }

    // Route the packet through the switchboard
    if (toUuid && toUuid != this._id && toUuid != 'local') {

        // Route externally.
        var success = this._routePacket(packet, fromRoute, toUuid);
        if (!success) {
            if (packet.p && this.hasHandler(packet.p)) {
                this.emit(packet.p + '-error', packet.m, packet.d, fromUuid);
            }
        }

    }
    else {

        // This lets anyone using the router know whether to trust messages
        // as coming from the local/group neighborhood or externally.
        var neighborhood = constants.Neighborhood;
        var source = neighborhood.LOCAL;
        if (fromRoute) {
            if (fromRoute.external) {
                source = neighborhood.UNIVERSAL;
            }
            else {
                source = neighborhood.GROUP;
            }
        }

        // Route locally.
        if (packet.p && this.hasHandler(packet.p)) {
            this.emit(packet.p, packet.m, fromUuid, source);
        }
    }
};

/**
 * When a new packet comes in from a switch stream, update local
 * details.
 * @param stream
 * @private
 */
Router.prototype._handleRouteUpdatePacket = function(packet, fromUuid) {
    // Ignore updates from external links
    var route = this._routes[fromUuid];
    if (route && !route.external) {
        var updates = this._routingTable.applyUpdates(fromUuid, packet);
        this._broadcastUpdates(updates);
    }
};

/**
 * Send the 'packet' that was sent to us from adjacent 'fromUuid' host to the ultimate
 * destination at 'toUuid' using our routing table.
 * @param packet
 * @param fromUuid
 * @param toUuid
 * @private
 */
Router.prototype._routePacket = function(packet, fromRoute, toUuid) {

    // See if we can get to the final destination internally
    var route = this.getRoute(toUuid);

    // Do we have a valid internal (routing-table) or external (switchboard) route?
    if (!route || !route.nextHop) {
        log.log(log.WARN, 'No route for: %s', toUuid);
        return false;
    }

    var nextHop = route.nextHop;

    // Don't allow routing back to where we came from
    if (fromRoute && route) {
        if (nextHop == fromRoute.address) {
            log.log(log.WARN, 'Cannot route a packet back the way it came: [nextHop: %s] [from: %s]',
                nextHop, fromRoute.address);
            return false;
        }

        // Ensure that the routing is allowed / enabled within a bridge.
        if (fromRoute.external || route.external) {
            if (!this._linkAssociation.isAssociated(fromRoute.linkId, route.linkId)) {
                log.log(log.TRACE, 'Cannot route to un-bridged links [Link 1: %s] [Link 2: %s]',
                    fromRoute.linkId, route.linkId);
                return true; // assume valid
            }
        }
    }

    // Don't need to send the destinationUuid if it's the next hop.
    if (nextHop == toUuid) {
        delete packet.d;
    }

    log.log(log.TRACE, 'Routing packet destined for [%s] to [%s]',
        toUuid, nextHop);

    this._switchBoard.sendPacket(nextHop, 'route', packet);

    return true;
};

/**
 * Send the given packet to the given switch stream.
 * @param toUuid - internal destination
 * @param name
 * @param packet
 * @param fromUuid - allow spoofing of from uuid.
 */
Router.prototype.sendPacket = function(toUuid, name, packet, fromUuid) {

    if (this.hasHandler(name)) {
        var wrappedPacket = {
            p: name,
            d: toUuid, // where we're going
            m: packet
        };
        this._handleRoutePacket(wrappedPacket, fromUuid || 'local');
    }
    else {
        log.log(log.WARN, 'Attempted to send a packet for unregistered handler' +
            ' [handler: %s]', name);
    }
};

/**
 * When a new route is available to a particular host, report it here.
 * @param toId
 * @param nextHopId
 * @private
 */
Router.prototype._handleRouteUpdate = function(toId, nextHopId) {

    var route = this._routes[toId];
    if (!route) {
        route = this._routes[toId] = {
            address: toId,
            adjacent: toId === nextHopId,
            nextHop: null,
            reported: false,
            external: false
        };
    }

    // Ignore anything from the routing table that tries to impersonate an
    // external link
    if (!route.external) {

        // Update the next hop.
        route.nextHop = nextHopId;

        // Update the link id
        var nextHopDetails = this._routes[nextHopId];
        route.linkId = nextHopDetails.linkId;

        if (!route.reported) {
            log.log(log.DEBUG2, 'New route to [%s] reported: %s', toId, nextHopId);
            route.reported = true;
            this.emit('route-available', toId, route);
        }
        else {
            // The route was reported via the routing table
            log.log(log.DEBUG2, 'Updated route to [%s] reported: %s', toId, nextHopId);
            route.adjacent = toId === nextHopId;
            this.emit('route-change', toId, route);
        }
    }
};

/**
 * When a route to a specific host is no longer available, report it here.
 * @param toId
 * @private
 */
Router.prototype._handleRouteExpire = function(toId) {
    var route = this._routes[toId];
    if (route) {
        log.log(log.DEBUG2, 'Route expired: %s', toId);
        delete this._routes[toId];
        this.emit('route-unavailable', toId, route);
    }
};

/**
 * Get the best route to the given location
 * @param toId
 */
Router.prototype.getRoute = function(toId) {
    if (this._routes[toId]) {
        return this._routes[toId];
    }
    // Otherwise returns undefined
};

/**
 * Occurs when a switch stream changes interfaces, associated with
 * a new cost.
 * @param fromUuid
 * @param cost
 * @private
 */
Router.prototype._handleLinkSwitch = function(fromUuid, linkDetails) {

    var route = this._routes[fromUuid];

    // If we don't have the route, then add it:
    if (!route) {
        // If we have never seen this host before, then register it with the routing table.
        route = this._routes[fromUuid] = {
            address: fromUuid,
            adjacent: true,
            nextHop: fromUuid,
            reported: false,
            external: linkDetails.isExternal()
        };
    }

    // Update the link id
    route.linkId = linkDetails.getId();

    // Don't want a 'external' status change to affect the routing table
    if (!route.external) {
        var updates;
        if (this._routingTable.hasLink(fromUuid)) {
            updates = this._routingTable.updateLinkCost(fromUuid, linkDetails.getCost());
        }
        else {
            updates = this._routingTable.addLink(fromUuid, linkDetails.getCost());
        }
        this._broadcastUpdates(updates);
    }
    else {
        // Report the external route
        log.log(log.DEBUG2, 'New external route reported: %s', fromUuid);
        this.emit('route-available', fromUuid, route);
    }
};

/**
 * If there is no link available for this Endpoint.js, then this is
 * unrecoverable
 * @param fromUuid
 * @private
 */
Router.prototype._handleLinkLost = function(fromUuid, linkDetails) {
    var route = this._routes[fromUuid];
    if (route) {
        if (!route.external) {
            var updates = this._routingTable.removeLink(fromUuid);
            this._broadcastUpdates(updates);
        }
        else {
            this._handleRouteExpire(fromUuid);
        }
    }
};

/**
 * Broadcast the updates to all the link streams
 * @param updates
 * @private
 */
Router.prototype._broadcastUpdates = function(updates) {
    // This is needed in case multiple connections are closed at the same
    // time (appUtils.nextTick)
    var _this = this;
    if (updates.length > 0) {
        appUtils.nextTick(function() {
            log.log(log.DEBUG2, 'Broadcasting router updates [Total: %s]', updates.length);
            _this._switchBoard.broadcastInternal('route-update', updates);
        });
    }
};

/**
 * Add the given handler to the switch-board.  This isn't really used
 * for any functional reason other than to ensure we only emit
 * packet events for handlers we know about.
 * @param name
 * @param handler
 */
Router.prototype.addHandler = function(name) {
    this._handlers[name] = true;
    log.log(log.DEBUG, 'Added packet handler [name: %s]', name);
};

/**
 * Whether the given handler is registered
 * @param name
 */
Router.prototype.hasHandler = function(name) {
    if (this._handlers[name]) {
        return true;
    }
    return false;
};
