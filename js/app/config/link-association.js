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

'use strict';

var linkBridgeFactory = require('./link-bridge');

module.exports = LinkAssociation;

/**
 * Link Association maintains the associations of links within
 * {LinkBridge} objects.  Link Bridges are created and maintained in
 * this class.  When they close, the associations are removed. Link
 * Associations are maintained even if the link they represent doesn't
 * exist.  The associations allow for secure Bus traffic by ensuring that
 * events are only passed to desired links.
 * @constructor
 */
function LinkAssociation() {
    if (!(this instanceof LinkAssociation)) return new LinkAssociation();

    // This is a list of link bridges indexed by link bridge id.
    this._linkBridges = {};

    // A list of associations between links
    this._linkAssociations = {};

    // Pointers for add/remove association functions
    this._addLinkAssociationPtr = this._addLinkAssociation.bind(this);
    this._removeLinkAssociationPtr = this._removeLinkAssociation.bind(this);
    this._removeBridgePtr = this._removeBridge.bind(this);
}

/**
 * Add an association between link1 and link2.
 * @param link1
 * @param link2
 * @private
 */
LinkAssociation.prototype._addLinkAssociation = function(link1, link2) {
    var assocA = this._linkAssociations[link1];
    if (!assocA) {
        assocA = this._linkAssociations[link1] = {
            _assoc: {},
            _count: 0
        };
    }
    var assocB = assocA._assoc[link2];
    if (!assocB) {
        assocA._count += 1;
        assocA._assoc[link2] = 0;
    }
    assocA._assoc[link2] += 1;
};

/**
 * Remove the association between link1 and link2.
 * @param link1
 * @param link2
 * @private
 */
LinkAssociation.prototype._removeLinkAssociation = function(link1, link2) {
    var assocA = this._linkAssociations[link1];
    if (assocA) {
        var assocB = assocA._assoc[link2];
        if (assocB) {
            assocA._assoc[link2] -= 1;
            if (assocA._assoc[link2] === 0) {
                delete assocA._assoc[link2];
                assocA._count -= 1;
            }
            if (assocA._count === 0) {
                delete this._linkAssociations[link1];
            }
        }
    }
};

/**
 * Returns the bridge if it exists
 * @param bridgeId
 */
LinkAssociation.prototype.getBridge = function(bridgeId) {
    return this._linkBridges[bridgeId];
};

/**
 * Create a new link bridge and return it.
 * @param selfRelay - allow sending of data
 */
LinkAssociation.prototype.createBridge = function(selfRelay) {
    var linkBridge = linkBridgeFactory(selfRelay);
    this._linkBridges[linkBridge.getId()] = linkBridge;
    linkBridge.on('add-association', this._addLinkAssociationPtr);
    linkBridge.on('remove-association', this._removeLinkAssociationPtr);
    linkBridge.on('closed', this._removeBridgePtr);
    return linkBridge;
};

/**
 * When a link bridge is closed, then remove the listeners.
 * @param id
 * @private
 */
LinkAssociation.prototype._removeBridge = function(id) {
    var linkBridge = this._linkBridges[id];
    if (linkBridge) {
        delete this._linkBridges[id];
        linkBridge.removeListener('add-association', this._addLinkAssociationPtr);
        linkBridge.removeListener('remove-association', this._removeLinkAssociationPtr);
        linkBridge.removeListener('closed', this._removeBridgePtr);
    }
};

/**
 * Given a linkA, see if it's associated with linkB.
 * @param linkId
 */
LinkAssociation.prototype.isAssociated = function(linkA, linkB) {
    var data = this._linkAssociations[linkA];
    if (data && data._assoc[linkB]) {
        return true;
    }
    return false;
};
