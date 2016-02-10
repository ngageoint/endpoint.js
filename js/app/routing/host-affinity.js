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
    isArray = require('util').isArray,
    addressTool = require('./address'),
    uuid = require('node-uuid'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(HostAffinity, EventEmitter);

module.exports = HostAffinity;

/**
 * HostAffinity will establish a relationship between a chain of nodes.  If
 * any node in the chain goes down, then the subsequent nodes in the chain
 * will be notified of the break.
 * @augments EventEmitter
 * @fires HostAffinity#affinity-add (affinityId)
 * @fires HostAffinity#affinity-remove (affinityId)
 * @fires HostAffinity#affinity-error (affinityId)
 * @param {Router} routerInstance - an instance of the Router class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function HostAffinity(routerInstance, config) {
    if (!(this instanceof HostAffinity)) { return new HostAffinity(routerInstance, config); }

    // Call parent constructor
    EventEmitter.call(this);
    this.setMaxListeners(0);

    this._id = config.get('instanceId');
    this._maxHostAffinities = config.get('maxHostAffinities');
    this._maxHops = config.get('maxHops');

    // These are affinities that have been requested via add/add-ack
    this._trackedHosts = {};

    // These are local affinities that were initiated in our Endpoint.js instance.
    this._localAffinities = {};

    // Register with the router to track HostAffinity packets
    // NOTE: There might be an issue here.  If a link switches (link-switch), then
    // it could be that the remote link detected the link was dead, and killed affinity,
    // thereby re-connecting.  Our side will not detect this however, meaning the remote
    // instance/facade might be dead but we won't know on this side ...
    this._routerInstance = routerInstance;
    this._routerInstance.addHandler('affinity');
    this._routerInstance.on('route-unavailable', this._handleRouteLost.bind(this));
    this._routerInstance.on('affinity', this._handleAffinityPacket.bind(this));
}

/**
 * This function is used to establish host affinities
 * @param packet
 * @param fromUuid
 * @private
 */
HostAffinity.prototype._handleAffinityPacket = function(packet, fromUuid) {

    var fromRoute = this._routerInstance.getRoute(fromUuid);
    if (!fromRoute) {
        return;
    }
    // If this is an internal route, then trust the 'from' parameter.  This
    // is because the packet could be coming from another border node, not
    // an adjacent node.
    if (!fromRoute.external) {
        fromUuid = packet.from;
    }

    switch (packet.type) {
        case 'add':
            this._handleAdd(packet, fromUuid);
            break;
        case 'remove':
            this._handleRemove(packet, fromUuid);
            break;
        case 'error':
            this._handleError(packet, fromUuid);
            break;
    }
};

/**
 * This function is called when a request to add a tracked affinity id occurs.
 * It expects one affinity id in the 'packet.id' field, which is NOT an array.
 * @param packet - the originating protocol packet
 * @param fromUuid - who sent us the protocol packet
 * @private
 */
HostAffinity.prototype._handleAdd = function(packet, fromUuid) {
    if (!packet.id || !isArray(packet.path) || !appUtils.isUuid(packet.id)) {
        return;
    }

    // Valid?
    var address = addressTool(packet.path, true);
    if (!address.isValid(this._maxHops)) {
        return;
    }

    // Determine who we're going to send the affinity record to.  It will
    // be the next record in the path.
    var toPath = address.getPathVector();

    // Remove any additional references to me due to path-vector algorithm
    var toUuid = this._id;
    while (toUuid == this._id && toPath.length > 0) {
        toUuid = toPath[0];
        toPath.shift();
    }

    if (toUuid == this._id) {
        toUuid = 'local';
    }

    var addedFrom, addedTo;

    // Add tracked record for 'from' as long as from is not local
    addedFrom = this._addTrackedRecord(fromUuid, toUuid, packet.id, true);

    // Add tracked record for 'to' as long as to is not local, and as long as we know about
    // the host we're sending to.
    if (addedFrom) {
        if (toUuid == 'local' || this._routerInstance.getRoute(toUuid)) {
            addedTo = this._addTrackedRecord(toUuid, fromUuid, packet.id, false);
        }
    }

    if (!addedFrom || !addedTo) {
        if (addedFrom) {
            // Cleanup and send error or forward to next host.
            this._removeTrackedRecord(fromUuid, packet.id);
        }
        // Reply with error.
        this._sendProtocolMessage(fromUuid, 'error', packet.id, 'local');
    }
    else {
        this._sendProtocolMessage(toUuid, 'add', packet.id, fromUuid, toPath);
    }
};

/**
 * This function is called when a request to remove a tracked affinity id occurs.
 * @param packet - the originating protocol packet
 * @param fromUuid - who sent us the protocol packet
 * @private
 */
HostAffinity.prototype._handleRemove = function(packet, fromUuid) {
    if (!isArray(packet.id)) {
        return;
    }
    var notificationHosts = {};
    packet.id.forEach(function(affinityId) {
        var concernedHost = this._removeTrackedRecord(fromUuid, affinityId);
        if (concernedHost) {
            notificationHosts[concernedHost] = notificationHosts[concernedHost] || [];
            notificationHosts[concernedHost].push(affinityId);
            this._removeTrackedRecord(concernedHost, affinityId);
        }
    }, this);

    // Send out all notifications
    for (var host in notificationHosts) {
        // Forward the packet
        log.log(log.DEBUG3, 'Sending affinity (remove) message to host %s with %s items', host,
            notificationHosts[host].length);
        this._sendProtocolMessage(host, 'remove', notificationHosts[host], 'local');
    }
};

/**
 * Occurs when we can't establish the affinity.  (Usually maxAffinities is reached)
 * @param packet
 * @param fromUuid
 * @private
 */
HostAffinity.prototype._handleError = function(packet, fromUuid) {
    if (!packet.id || isArray(packet.id)) {
        return;
    }
    var concernedHost = this._removeTrackedRecord(fromUuid, packet.id);
    if (concernedHost) {
        this._removeTrackedRecord(concernedHost, packet.id);
        this._sendProtocolMessage(concernedHost, 'error', packet.id, 'local');
    }
};

/**
 * This occurs when a route is lost on our local routing table.  This can include
 * external hosts.  If we have a tracked host in our affinities for that id, then
 * we will send a notification that the affinity has been lost
 * @param toId - the host that dropped
 * @private
 */
HostAffinity.prototype._handleRouteLost = function(toId) {
    var hostInfo = this._trackedHosts[toId];
    if (hostInfo) {
        log.log(log.DEBUG2, 'Detected %s is lost, removing affinities', toId);
        // Simulate a remove from the host for all affinities
        this._handleRemove(
            {
                id: Object.keys(hostInfo._affinities)
            },
            toId
        );
    }
};

/**
 * This function will add a tracked record for the given host, if necessary
 * @param toId
 * @param affinityId
 * @param owned
 * @returns {Boolean} true if the record was added
 * @private
 */
HostAffinity.prototype._addTrackedRecord = function(toId, concernedId, affinityId, owned) {
    var toIdInfo = this._trackedHosts[toId];
    if (!toIdInfo) {
        toIdInfo = this._trackedHosts[toId] = {
            _affinities: {},
            _ownedCount: 0,
            _totalCount: 0
        };
    }

    // Ensure that we don't exceed, otherwise send a remove message back to the sender.
    // But only if this is an external link.
    if (owned && appUtils.isExtUuid(toId) && toIdInfo._ownedCount >= this._maxHostAffinities) {
        log.log(log.WARN, 'Exceeded max affinities for host %s', toId);
        return false;
    }

    if (!toIdInfo._affinities[affinityId]) {
        toIdInfo._affinities[affinityId] = {
            _concernedHost: concernedId,
            _owned: !!owned
        };
        toIdInfo._totalCount += 1;
        if (owned) {
            toIdInfo._totalOwned += 1;
        }
        log.log(log.DEBUG2, 'Added tracked affinity: [id: %s] [host: %s] [concerned host: %s]',
            affinityId, toId, concernedId);
        return true;
    }
    else {
        log.log(log.DEBUG, 'We already know that affinity id %s for %s', affinityId, toId);
    }
    return false;
};

/**
 * Remove the given tracked record, and return the concerned host id if it exists.
 * @param toId
 * @param affinityId
 * @returns {String} the concerned host id or null
 * @private
 */
HostAffinity.prototype._removeTrackedRecord = function(toId, affinityId) {
    var toIdInfo = this._trackedHosts[toId];
    if (toIdInfo) {
        var concernedHost = toIdInfo._affinities[affinityId];
        if (concernedHost) {
            log.log(log.DEBUG2, 'Removed tracked affinity: [id: %s] [host: %s] [concerned host: %s]',
                affinityId, toId, concernedHost._concernedHost);
            delete toIdInfo._affinities[affinityId];
            toIdInfo._totalCount -= 1;
            if (concernedHost._owned) {
                toIdInfo._ownedCount -= 1;
            }
            return concernedHost._concernedHost;
        }
    }
    if (toIdInfo._totalCount === 0) {
        delete this._trackedHosts[toId];
    }
    return null;
};

/**
 * Send an affinity packet to the given host
 * @param toId - host to send the message to
 * @param type - the type of the message
 * @param affinityId - list of ids or an id
 * @param {String} [path] - the path to continue the affinity
 * @private
 */
HostAffinity.prototype._sendProtocolMessage = function(toId, type, affinityId, fromUuid, path) {
    if (toId == 'local') {
        // Report locally, as long as it's not an error.  We don't want to
        // prevent communication if there are no affinities available
        var ids = !isArray(affinityId) ? [affinityId] : affinityId;
        var _this = this;
        ids.forEach(function(id) {
            _this.emit(id, type);
            _this.removeAllListeners(id);
        });
    }
    else {
        this._routerInstance.sendPacket(
            toId,
            'affinity',
            {
                id: affinityId,
                from: this._id,
                type: type,
                path: path
            },
            fromUuid);
    }
};

/**
 * Establish a affinity with the given node
 * @param address
 */
HostAffinity.prototype.establishHostAffinity = function(address) {
    var addressHash = address.toString();
    // Ensure that the address has no loops and isn't directed at myself.
    if (addressHash.length === 0 || !address.isValid(this._maxHops)) {
        throw new Error('invalid address');
    }
    var localAffinity = this._localAffinities[addressHash];
    if (!localAffinity) {
        // Don't route to myself
        var pathVector = address.getPathVector();
        if (pathVector.length == 1 && pathVector[0] == this._id) {
            return null;
        }
        // Create a remote affinity record
        localAffinity = this._localAffinities[addressHash] = {
            _id: uuid(),
            _count: 0
        };
        this._handleAdd(
            {
                path: address.getPathVector(),
                id: localAffinity._id
            },
            'local'
        );
    }
    localAffinity._count += 1;
    return localAffinity._id;
};

/**
 * Tell the distant node that we're breaking the given host affinity
 * @param address
 * @param affinityId
 */
HostAffinity.prototype.removeHostAffinity = function(address) {
    var addressHash = address.toString();
    if (addressHash.length === 0) {
        return;
    }
    var localAffinity = this._localAffinities[addressHash];
    if (localAffinity) {
        localAffinity._count -= 1;
        if (localAffinity._count === 0) {
            delete this._localAffinities[addressHash];
            this._handleRemove(
                {
                    id: [localAffinity._id]
                },
                'local'
            );
        }
    }
};
