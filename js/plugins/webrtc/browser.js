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

var EventEmitter = require('events').EventEmitter,
    logManager = require('../../app/util/logger'),
    webrtcLink = require('./webrtc-link'),
    toPull = require('stream-to-pull-stream'),
    quickConnect = require('rtc-quickconnect'),
    appUtils = require('../../app/util/appUtils');

/**
 * @module webrtc-plugin
 */

// Whether the custom link has been added to endpoint.
var globalObj = appUtils.getGlobalObject();
var endpoint = globalObj.endpoint;
if (!endpoint) {
    throw new Error('Cannot find Endpoint.js (window.endpoint)');
}

// Set our logging to match Endpoint.js
logManager.logLevel = globalObj.endpointLogLevel;

// Initialize the webrtc link inside Endpoint.js
var linkType = 'webrtc';
var linkCreateFunction = function(instanceId, linkId, settings) {
    return webrtcLink(instanceId, linkId, settings);
};
globalObj.endpoint.getConfiguration().addCustomLinkType(linkType, linkCreateFunction);

/**
 * Provide a mechanism to initialize & subscribe to discovery API
 * @example
 * var plugin = require('webrtc-plugin')(window.endpoint);
 * plugin.on('ready', function(conference) {
 *   // create webrtc link and add conference
 * });
 * @param endpoint - a reference to endpoint.js instance
 * @param {Object} [opts]
 * @param {String} [opts.linkId] - the link to broadcast web-rtc-discovery to, or all links if undefined
 * @param {String} [opts.room] - the room to use on the signal host
 * @param {String} [opts.quickconnect] - options to send to rtc-quickconnect (rtc.io)
 * @param {Object} [opts.settings] - settings passed to facade (neighborhood defaults to global)
 * @return {EventEmitter} emits the 'ready' event when connected to signal host
 */
globalObj.endpointWebRTC = function(opts) {

    var emitter = new EventEmitter();

    opts = opts || {};
    var settings = opts.settings || {};
    settings.neighborhood = settings.neighborhood || 'global';

    if (settings.linkId) {
        var bridge = endpoint.getConfiguration().createBridge([settings.linkId]);
        settings.bridgeId = bridge.getId();
    }

    // Look for the webrtc discovery api.
    var fmgr = endpoint.manageFacades(['web-rtc-discovery', '1.0', settings]);

    var rtc;
    fmgr.on('ready', function() {

        // Init the transfer stream
        var stream = fmgr.getApi('web-rtc-discovery').register().stream();

        var ended = false;
        stream.on('finish', function() {
            ended = true;
        });

        // Create the messenger.
        var messenger = function() {
            return function(callback) {
                if (ended) {
                    callback(new Error('stream has ended'));
                    return;
                }
                var duplex = toPull.duplex(stream);
                callback(null, duplex.source, duplex.sink);
            };
        };

        var quickOpts = opts.quickconnect || {};
        quickOpts.room = settings.room || quickOpts.room || 'endpointjs-room';
        quickOpts.messenger = messenger;

        // Create the RTC connection
        var rtc = quickConnect('fake', quickOpts);

        emitter.emit('ready', rtc);

    });

    return emitter;
};
