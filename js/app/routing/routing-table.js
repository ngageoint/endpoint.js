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
/* globals __filename, Infinity */

'use strict';

var EventEmitter = require('events').EventEmitter,
    inherits = require('util').inherits,
    periodicTimer = require('../util/periodic-timer'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(RoutingTable, EventEmitter);

module.exports = RoutingTable;

/**
 * This class will execute a modified DSDV to build a routing table
 * to all reachable hosts
 * http://www.cs.virginia.edu/~cl7v/cs851-papers/dsdv-sigcomm94.pdf
 * @augments EventEmitter
 * @fires RoutingTable#route-update (toId, nextHop)
 * @fires RoutingTable#route-expire (toId)
 * @param {String} id - unique identifier for this endpoint.js instance
 * @param {Number} period - interval to check for dead routes
 * @constructor
 */
function RoutingTable(id, period) {
    if (!(this instanceof RoutingTable)) { return new RoutingTable(id, period); }

    EventEmitter.call(this);

    // List of local links
    this._links = {};

    // My Entry
    this._myEntry = {
        id: id,
        seq: 0,
        next: id,
        cost: 0
    };

    // Listen for updates
    this._timer = periodicTimer('Routing Table', 15000);
    this._timer.on('period', this._performPeriodic.bind(this));

    // Destinations.  List of places we can get to, indexed by
    // destination ID, contains a sorted array of next possible
    // hops and the associated cost
    this._dests = {};

    // Add my entry to the destinations list.
    this._dests[id] = this._myEntry;

}

/**
 * Return the id of this router
 * @returns {*}
 */
RoutingTable.prototype.getId = function() {
    return this._myEntry.id;
};

/**
 * Whether the routing table is listening to the link
 * @param linkId
 */
RoutingTable.prototype.hasLink = function(linkId) {
    return !!this._links[linkId];
};

/**
 * Add the link to the routing table, and send out our entire table
 * to everyone.  Technically we should only have to send the value to
 * the new link, but we'll send it to everyone
 * @param linkId
 * @param cost
 * @returns {*}
 */
RoutingTable.prototype.addLink = function(linkId, cost) {
    if (this._links[linkId]) {
        log.log(log.WARN, 'Already know about that link: [id: %s]', linkId);
        return [];
    }
    this._links[linkId] = { cost: cost };
    this._myEntry.seq += 2;
    // See if we already know about this dest
    if (!this._dests[linkId]) {
        this._dests[linkId] = {
            id: linkId,
            cost: cost,
            seq: 0,
            next: linkId
        };
    }
    this.emit('route-update', linkId, linkId);
    this._timer.addReference();
    log.log(log.DEBUG2, 'Added link: [id: %s]', linkId);
    return this._exportTableAsUpdates();
};

/**
 * If a link changes cost, then update the value by incrementing the
 * sequence number, so that everyone in the network will re-calculate
 * the cost to get to a specific link.
 * @param linkId
 * @param cost
 */
RoutingTable.prototype.updateLinkCost = function(linkId, cost) {
    var link = this._links[linkId];
    if (!link) {
        log.log(log.WARN, 'Unknown link: [id: %s]', linkId);
        return [];
    }
    if (link.cost == cost) {
        // Nothing to do
        return [];
    }
    link.cost = cost;
    this._myEntry.seq += 2;
    log.log(log.DEBUG2, 'Updated link: [id: %s] [cost: %s]', linkId, cost);
    return [this._createUpdateFor(linkId, false), this._createUpdateFor(this._myEntry.id, false)];
};

/**
 * Remove the given link from our routing table, and
 * send out updates to the effect, signifying which links
 * we can no longer get to.
 * @param linkId
 * @returns {Array}
 */
RoutingTable.prototype.removeLink = function(linkId) {
    var link = this._links[linkId];
    if (!link) {
        log.log(log.WARN, 'Unknown link: [id: %s]', linkId);
        return [];
    }
    var updates = [];
    this._myEntry.seq += 2;
    for (var destId in this._dests) {
        if (this._dests[destId].next == linkId) {
            this._dests[destId].cost = Infinity;
            this._dests[destId].seq++;
            updates.push(this._createUpdateFor(destId, false));
        }
    }
    log.log(log.DEBUG2, 'Removed link: [id: %s]', linkId);
    delete this._links[linkId];
    if (this._dests[linkId]) {
        delete this._dests[linkId];
        this.emit('route-expired', linkId);
    }
    this._timer.removeReference();
    updates.push(this._createUpdateFor(this._myEntry.id, false));
    return updates;
};

/**
 *
 * @param from
 * @param updates
 * @returns {Array}
 */
RoutingTable.prototype.applyUpdates = function(fromId, updates) {

    var link = this._links[fromId];
    if (!link) {
        log.log(log.WARN, 'Unknown link: %s', fromId);
        return [];
    }

    var outUpdates = [];

    log.log(log.DEBUG3, 'Number of route updates in this pack: [from: %s] [count: %s]',
        fromId, updates.length);

    for (var i = 0; i < updates.length; i++) {
        var update = updates[i];

        // Malformed?
        if (!update || !update.hasOwnProperty('id') ||
            !update.hasOwnProperty('seq') || !update.hasOwnProperty('cost')) {
            log.log(log.WARN, 'Malformed routing packet: %j', update);
            continue;
        }

        // Translate the update
        if (update.cost == 'inf') {
            update.cost = Infinity;
        }

        if (update.id != this._myEntry.id) {

            if (!this._dests[update.id]) {

                if (update.cost !== Infinity) {

                    this._dests[update.id] = {
                        id: update.id,
                        seq: update.seq,
                        cost: update.cost + link.cost,
                        next: fromId
                    };

                    log.log(log.DEBUG, 'Encountered new external host [id: %s] [cost: %s] [next: %s]',
                        update.id, this._dests[update.id].cost, fromId);

                    outUpdates.push(this._createUpdateFor(update.id));

                    this.emit('route-update', update.id, fromId);
                }
                else {
                    log.log(log.DEBUG2, 'Was sent an infinite cost route I didn\'t know about' +
                        ' , ignoring [id: %s] [next: %s]',
                        update.id, fromId);
                }

            }
            else {

                // The odd layout of these commands are for logging purposes.
                var seqGreater = update.seq > this._dests[update.id].seq;

                var costLower;
                if (!seqGreater) {
                    costLower = update.seq == this._dests[update.id].seq &&
                        (update.cost + link.cost) < this._dests[update.id].cost;
                }

                if (seqGreater || costLower) {

                    // The last 'best' hop before this update.
                    var prevNext = this._dests[update.id].next;

                    this._dests[update.id] = {
                        id: update.id,
                        seq: update.seq,
                        cost: update.cost + link.cost,
                        next: fromId
                    };

                    log.log(log.DEBUG2, 'Better route encountered [id: %s] [cost: %s] [next: %s] ' +
                        '[seq check: %s] [cost check: %s]',
                        update.id, this._dests[update.id].cost, fromId, seqGreater, costLower);

                    outUpdates.push(this._createUpdateFor(update.id));

                    // Remove the entry immediately, but only if my next hop is
                    // the guy who gave me the update. DSDV requires us not to
                    // remove it from the routing table immediately, however,
                    // because of dampening/settling.
                    if (update.cost === Infinity && fromId == prevNext) {
                        this.emit('route-expired', update.id);
                    }
                    else {
                        // Update the cost.
                        this.emit('route-update', update.id, fromId);
                    }
                }
                else {
                    log.log(log.DEBUG3, 'Non optimal route received [id: %s] [next: %s]',
                        update.id, fromId);
                }
            }
        }
        else {

            // If it's an update for me, and it has a higher seq num,
            // send out my update again.  This will happen
            // when someone loses their route to me.  The sequence
            // update will propagate through the network, and no one
            // will be able to find me anymore unless I do this.
            if (update.seq > this._myEntry.seq) {
                // Update until I'm the latest
                while (update.seq > this._myEntry.seq) {
                    this._myEntry.seq += 2;
                }
                outUpdates.push(this._createUpdateFor(this._myEntry.id));

                log.log(log.DEBUG3, 'Someone incremented my sequence number');

            }
            else {
                log.log(log.TRACE, 'Ignore route update to myself');
            }

        }
    }

    return outUpdates;
};

/**
 * Create updates for the entire table.  This is only used when
 * we need to send the whole table to a new adjacent link.
 * @returns {Array}
 * @private
 */
RoutingTable.prototype._exportTableAsUpdates = function(withNext) {
    var updates = [];
    for (var destId in this._dests) {
        updates.push(this._createUpdateFor(destId, withNext));
    }
    return updates;
};

/**
 * Create an update message to send to other nodes for the given
 * destination id.
 * @param destId
 * @private
 */
RoutingTable.prototype._createUpdateFor = function(destId, withNext) {
    var dest = this._dests[destId];
    if (dest) {
        var value = {
            id: destId,
            seq: dest.seq,
            cost: dest.cost
        };
        if (value.cost === Infinity) {
            value.cost = 'inf';
        }
        if (withNext) {
            value.next = dest.next;
        }
        return value;
    }
    return null;
};

/**
 * This function will do periodic duties, like ensuer
 * that outdated (infinite) links are removed from the
 * routing table
 * @private
 */
RoutingTable.prototype._performPeriodic = function(force) {
    var toDelete = [];
    log.log(log.DEBUG3, 'Periodic routing table cleanup');
    for (var destId in this._dests) {
        if (force) {
            if (destId != this._myEntry.id) {
                toDelete.push(destId);
            }
        }
        else {
            var dest = this._dests[destId];
            if (dest.cost == Infinity) {
                if (!dest.ttl) {
                    dest.ttl = 1;
                }
                else {
                    if (dest.ttl >= 1) {
                        // Expire this route.
                        toDelete.push(destId);
                    }
                    else {
                        dest.ttl++;
                    }
                }
            }
        }
    }
    if (toDelete.length > 0) {
        log.log(log.DEBUG, 'Deleting %s items from the routing table', toDelete.length);
        toDelete.forEach(function(item) {
            delete this._dests[item];
            this.emit('route-expired', item);
        }, this);
    }
};
