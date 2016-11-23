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
    uuid = require('uuid'),
    isArray = require('util').isArray,
    workerLink = require('../link/worker'),
    tabLink = require('../link/tab'),
    windowLink = require('../link/window'),
    serverLink = require('../link/server'),
    constants = require('../util/constants'),
    linkAssociation = require('./link-association'),
    log = appUtils.getLogger(__filename);

module.exports = Configuration;

/**
 * Configuration is used by the client to add and remove links from
 * an executing instance of Endpoint.js.
 * @param {Object} settings - List of default links
 * @param {Number} settings.instanceId - unique identifier used to identify this endpoint.js
 * @param {Number} settings.maxHops - maximum hops that can be specified in a route
 * @param {Number} settings.maxHostAffinities - maximum affinities allowed between an external host and local hosts
 * @param {Number} settings.maxAdapterInstances - maximum instances that can be created for a specific adapter
 * @param {Array} settings.links - default links to add to the system
 * @constructor
 */
function Configuration(linkDirectory, settings) {
    if (!(this instanceof Configuration)) return new Configuration(linkDirectory, settings);

    // Parse the configuration
    var configOptions = [
        ['instanceId', uuid()],
        ['maxHops', 10],
        ['maxHostAffinities', 25],
        ['maxAdapterInstances', 1000],
        ['maxClientObjects', 100],
        ['createSharedWorker', true],
        ['sharedWorkerUrl', null]
    ];

    // Set options.
    this._options = {};
    configOptions.forEach(function(option) {
        this._options[option[0]] = settings && settings.hasOwnProperty(option[0]) ? settings[option[0]] : option[1];
    }, this);

    // Used to add/remove links from the link directory.
    this._linkDirectory = linkDirectory;
    this._linkAssociation = linkAssociation();

    // Used to create a custom link type.
    this._customLinkTypes = {};

    // Generic link counter used when the link id isn't specified
    this._linkCounter = 1;

    // Add the links, if any are specified.
    if (settings.links) {
        this.addLinks(settings.links);
    }
}

/**
 * Add the given links to Endpoint.js
 * @param linksJson
 */
Configuration.prototype.addLinks = function(linksJson) {
    // Add each link given in settings if there are any
    if (linksJson && linksJson.length > 0) {
        log.log(log.DEBUG2, 'Adding: %s default links', linksJson.length);
        linksJson.forEach(function(link) {
            this.addLink(link);
        }, this);
    }
};

/**
 * Return the given option
 * @returns {*}
 */
Configuration.prototype.get = function(option) {
    return this._options[option];
};

/**
 * This will allow developers to add their own custom link type.
 * @param {String} linkType - name
 * @param {Function} linkFunction - a function which will be called with three parameters, instanceId,
 *   linkId and 'settings'.  Should return a class which implements the same interface as 'Link'
 */
Configuration.prototype.addCustomLinkType = function(linkType, linkFunction) {
    this._customLinkTypes[linkType] = linkFunction;
};

/**
 * This function is used to add a new link to Endpoint.js.  It contains the link type
 * as well as an identifier to retrieve the link if desired at another time
 * @param {Object} linkConfig
 * @param {String} linkConfig.linkId - unique link identifier (automatically assigned if not set)
 * @param {String} linkConfig.type - the type of the link
 * @param {String} linkConfig.settings - unique options for this link, passed to constructor
 * @todo leader election for specific links
 */
Configuration.prototype.addLink = function(linkConfig) {
    var msg;

    if (!linkConfig.type) {
        msg = 'No link type specified';
        log.log(log.ERROR, msg);
        throw new Error(msg);
    }

    var linkId = linkConfig.linkId || this._linkCounter++;
    var linkInstanceId = this.get('instanceId');
    var linkSettings = linkConfig.settings || {};

    var link;
    switch (linkConfig.type) {
        case constants.LinkType.SERVER:
            link = serverLink(linkInstanceId, linkId, linkSettings);
            break;

        case constants.LinkType.WORKER:
            link = workerLink(linkInstanceId, linkId, linkSettings);
            break;

        case constants.LinkType.WINDOW:
            link = windowLink(linkInstanceId, linkId, linkSettings);
            break;

        case constants.LinkType.TAB:
            link = tabLink(linkInstanceId, linkId, linkSettings);
            break;

        default:
            // See if it's a custom link type.
            if (this._customLinkTypes[linkConfig.type]) {
                link = this._customLinkTypes[linkConfig.type](linkInstanceId, linkId, linkSettings);
            }
            else {
                msg = 'Link type unknown: ' + linkConfig.type;
                log.log(log.ERROR, msg);
                throw new Error(msg);
            }
    }

    // Add the link to the link directory and return it.
    this._linkDirectory.addLink(link);
    return link;
};

/**
 * Return the given link if it is registered.
 * @param linkId
 */
Configuration.prototype.getLink = function(linkId) {
    return this._linkDirectory.getLink(linkId);
};

/**
 * Used to remove a specific link by id, closing all the connections maintained in the
 * link
 * @param {String} linkId
 */
Configuration.prototype.removeLink = function(linkId) {
    this._linkDirectory.removeLink(this.getLink(linkId));
};

/**
 * Return the link association object
 * @returns {*}
 */
Configuration.prototype.getLinkAssociation = function() {
    return this._linkAssociation;
};

/**
 * Create a bridge between the given link ids to allow relay.
 * @param links - a link id, or an array of link ids.
 * @param selfRelay - allow links on one link to communicate through this instance (default false)
 * @return {LinkBridge}
 */
Configuration.prototype.createBridge = function(links, selfRelay) {
    if (!isArray(links)) {
        if (typeof (links) != 'undefined') {
            links = [links];
        }
        else {
            links = [];
        }
    }
    var grp = this._linkAssociation.createBridge(!!selfRelay);
    links.forEach(function(link) {
        grp.addLinkId(link);
    });
    return grp;
};
