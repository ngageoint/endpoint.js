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

module.exports = Resolver;

/**
 * The resolver is used to determine if the facade criteria matches the metadata
 * for the adapter.  This is the default resolver for an adapter, but
 * a custom resolver can be used.
 * @example <caption>Using a custom resolver</caption>
 * var metadata = {
 *   tags: ['blue', 'green']
 * };
 *
 * var resolver = {
 *   resolve: function(metadata, criteria) {
 *     for (var i = 0; i < criteria.tags.length; i++) {
 *       if (metadata.tags.indexOf(tag) !== -1) {
 *         return true;
 *       }
 *     }
 *     return false;
 *   }
 * };
 *
 * var adapter = window.endpoint.registerAdapter('mapapi', '1.0',
 *   mapapi, metadata, resolver);
 * @param {Object} settings
 * @param {String} settings.id - the endpoint (adapter) id
 * @param {String} settings.instanceId - the endpoint.js instance id
 * @constructor
 */
function Resolver(settings) {
    if (!(this instanceof Resolver)) { return new Resolver(settings); }

    // Endpoint.js instance id.
    this._id = settings.id;
    this._instanceId = settings.instanceId;
}

/**
 * Respond to the key request.
 * @param {Object} metadata - adapter metadata set on adapter creation
 * @param {Object} criteria - criteria sent with the query
 * @param {RemoteAddress} remoteAddress - remote address information
 * @return boolean - resolved - whether the criteria matches this metadata.
 */
Resolver.prototype.resolve = function(criteria, metadata, remoteAddress) {

    // Match anything
    if (!criteria) {
        return true;
    }

    // Only resolve based on Endpoint.js instance id right now.
    if (criteria.hasOwnProperty('instanceId')) {
        if (criteria.instanceId !== this._instanceId) {
            return false;
        }
    }

    // Only resolved if the instance Id matches.
    if (criteria.hasOwnProperty('id')) {
        if (criteria.id !== this._id) {
            return false;
        }
    }

    return true;
};

