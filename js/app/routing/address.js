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

module.exports = Address;

/**
 * A remote address tells Endpoint.js how to route a packet to a given remote
 * endpoint.js instance.  When a message is sent to an external host, the path vector will
 * be like so: [host1, host2, host3], where successive hosts are appended.  This needs to
 * be reversed before messages can be sent to an external: [host3, host2, host1].
 * To save for performance, we don't reverse the vector until it's needed.
 * @param pathVector - array of boundary routers defining the path to the remote instance
 * @param reversed - whether the vector has been reversed already
 * @constructor
 */
function Address(pathVector, reversed) {
    if (!(this instanceof Address)) { return new Address(pathVector, reversed); }
    if (!pathVector) {
        this._pathVector = [];
    }
    else if (isArray(pathVector)) {
        this._pathVector = pathVector.slice(0);
    }
    else {
        this._pathVector = [pathVector.toString()];
    }
    this._reversed = !!reversed;
}

/**
 * A representation of the path vector as a string.
 */
Address.prototype.toString = function() {
    return this.getPathVector().join('.');
};

/**
 * Return the identifier, which identifies how to get to the local network.
 */
Address.prototype.getPathVector = function() {
    if (!this._reversed) {
        this._pathVector = this._pathVector.reverse();
        this._reversed = true;
    }
    return this._pathVector.slice(0);
};

/**
 * Create a new address that routes through the given route.  The
 * assumption is that this route ends at the same place the
 * next one begins.  This function will attempt to find a way
 * to reduce the path to the given host by using common instances
 * along the way.
 * @param {Address} address
 */
Address.prototype.routeThrough = function(address) {
    if (!this.isValid()) {
        throw new Error('invalid address');
    }
    var thisVector = this.getPathVector();
    var thatVector = address.getPathVector();
    if (thisVector[thisVector.length - 1] !== thatVector[0]) {
        var msg = 'While merging two addresses, end of first must be beginning of second';
        log.log(log.ERROR, msg);
        throw new Error(msg);
    }
    else {
        // Nominal:
        // Route 1: A -> B -> C -> D
        // Route 2: D -> C -> E -> F
        // Route New: A -> B -> C -> E -> F

        // External:
        // Route 1: A -> B -> edge-ext -> C -> D
        // Route 2: D -> C -> edge-ext -> E -> F
        // Route New: A -> B -> E -> F (skip edge-ext)

        // Create intermediate structure to map what index each item occurs at
        var thatHash = {};
        for (var i = 0; i < thatVector.length; i++) {
            thatHash[thatVector[i]] = i;
        }

        var smallestScore = null;
        var smallestThisIndex = null;
        var smallestThatIndex = null;

        for (var thisIndex = 0; thisIndex < thisVector.length; thisIndex++) {
            var thatIndex = thatHash[thisVector[thisIndex]];
            if (thatIndex !== undefined) {
                var score = thisIndex + thatIndex;
                if (smallestThisIndex === null || score < smallestScore) {
                    smallestThisIndex = thisIndex;
                    smallestThatIndex = thatIndex;
                }
            }
        }

        // If the item at the smallest index is an external edge, then skip that.
        if (appUtils.isExtUuid(thatVector[smallestThatIndex])) {
            smallestThatIndex += 1;
        }

        // Create a new array:
        // thisVector: 0->smallestThisIndex
        // thatVector: (smallestThatIndex -> end).reverse()
        var newVector = thisVector.slice(0, smallestThisIndex)
            .concat(thatVector.slice(smallestThatIndex));

        return new Address(newVector, true);
    }
};

/**
 * This function protects us by ensuring that we do not allow affinity under the following
 * circumstances:
 * - loops or node revisits
 * - invalid uuid (neither a uuid or an -ext address)
 * - max hops
 * @param address
 * @private
 */
Address.prototype.isValid = function(maxHops) {
    var vector = this.getPathVector();
    if (typeof (maxHops) != 'undefined' && vector.length > maxHops) {
        log.log(log.WARN, 'max hops violation: %s', this);
        return false;
    }
    var hash = {};
    for (var i = 0; i < vector.length; i++) {
        if (!(appUtils.isUuid(vector[i]) || (appUtils.isExtUuid(vector[i])))) {
            log.log(log.WARN, 'uuid violation: %s', this);
            return false;
        }
        if (hash[vector[i]]) {
            log.log(log.WARN, 'loop violation: %s', this);
            return false;
        }
        hash[vector[i]] = true;
    }
    return true;
};
