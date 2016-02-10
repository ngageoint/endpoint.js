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
/* globals __filename, SharedWorker */

'use strict';

var support = require('./link-support'),
    configuration = require('./configuration'),
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

module.exports = ConfigurationFactory;

/**
 * Configuration Factory is used to create default configurations used with
 * Endpoint.js.  An example would be a web-browser specific one, where
 * a web worker is used for all communication unless it isn't supported,
 * in which case local storage is used.  Another example is a Web Worker,
 * which only uses a worker link by default, but might use a Web Socket to
 * connect to a server.
 * @constructor
 */
function ConfigurationFactory(linkDirectory) {
    if (!(this instanceof ConfigurationFactory)) return new ConfigurationFactory(linkDirectory);
    this._linkDirectory = linkDirectory;
}

/**
 * This configuration is used if we're running out of browserify, meaning
 * the application has been loaded via a web application
 * @param {LinkDirectory} linkDirectory - the link directory the configuration adds to
 */
ConfigurationFactory.prototype.createDefaultBrowserConfiguration = function(configJson) {

    var wnd = appUtils.getGlobalObject();

    // Determine if we're a web worker.
    if (support.isWorkerHub(wnd) ||
        support.isWorker(wnd)) {
        log.log(log.DEBUG, 'Creating default web worker configuration');

        return this.createWebWorkerConfiguration(configJson);
    }
    else {
        log.log(log.DEBUG, 'Creating default browser configuration');

        var config = configuration(this._linkDirectory, configJson);
        if (!configJson.links) {
            // Assume we're a 'window' object, and add all applicable links
            var links = [];

            // Always add the window link.  location.origin is polyfilled via
            // ../util/polyfills.
            var windowLinkConfig = {
                linkId: 'default-window',
                type: 'window',
                settings: {
                    origin: wnd.location.origin,
                    external: false
                }
            };
            links.push(windowLinkConfig);

            // Add worker support by default
            var workerLinkConfig = {
                linkId: 'default-worker',
                type: 'worker',
                settings: {}
            };
            links.push(workerLinkConfig);

            var sharedWorkerSupport = support.supportsSharedWorker();

            // If we don't support shared worker, then add
            // local storage so tabs can communicate (eww)
            if (!sharedWorkerSupport && support.supportsLocalStorage()) {
                log.log(log.DEBUG, 'Adding tab link to configuration');
                var tabLinkConfig = {
                    linkId: 'default-tab',
                    type: 'tab',
                    settings: {
                        channel: 'endpointjs-default'
                    }
                };
                links.push(tabLinkConfig);
            }

            // Create the configuration
            log.log(log.DEBUG, 'Adding %s links to configuration', links.length);
            config.addLinks(links);

            // If we support shared worker, then create the worker & add it.
            if (config.get('createSharedWorker') && sharedWorkerSupport) {
                var worker = this._createSharedWorker(config.get('sharedWorkerUrl'));
                var workerLink = this._linkDirectory.getLink('default-worker');
                workerLink.addWorker(worker);
            }

            // If we're an Iframe, then tell our parent that we're here.
            var parentWindow = wnd.parent;
            if (parentWindow && parentWindow !== wnd) {
                // If the document referrer is set, see if our origin matches, if not
                // then don't announce to the parent (since default-window is for same
                // origin only)
                var announce = true;
                if (wnd.document && typeof (wnd.document.referrer) == 'string') {
                    if (wnd.document.referrer.indexOf(wnd.location.origin) == -1) {
                        announce = false;
                    }
                }
                if (announce) {
                    var window = this._linkDirectory.getLink('default-window');
                    window.announceWindow(parentWindow);
                }
            }
        }

        // Setup a listener so that if the window is closed, close all links in the
        // link directory.
        var _this = this;
        appUtils.addEventListener(wnd, 'beforeunload', function() {
            _this._linkDirectory.close();
        });

        return config;
    }
};

/**
 * This configuration is used if we're running out of node.js
 * @param {LinkDirectory} linkDirectory - the link directory the configuration adds to
 */
ConfigurationFactory.prototype.createDefaultServerConfiguration = function(configJson) {
    log.log(log.DEBUG, 'Creating default server configuration');

    if (!configJson.links) {
        // Create the configuration with the 'server' link only.
        var serverLinkConfig = {
            linkId: 'default-server',
            type: 'server',
            settings: {
                channel: 'endpointjs-default'
            }
        };

        // Create the configuration
        configJson.links = [serverLinkConfig];
    }

    return configuration(this._linkDirectory, configJson);
};

/**
 * This configuration is used when we detect that we're in a web worker.
 * It will create a worker link only.
 * @param {LinkDirectory} linkDirectory - the link directory the configuration adds to
 */
ConfigurationFactory.prototype.createWebWorkerConfiguration = function(configJson) {

    var config = configuration(this._linkDirectory, configJson);
    if (!configJson.links) {
        // Web worker by default only has one link, a worker link.
        var workerLinkConfig = {
            linkId: 'default-worker',
            type: 'worker',
            settings: {
                channel: 'endpointjs-default'
            }
        };

        // Create the configuration
        config.addLinks([workerLinkConfig]);

        // Add myself as a listener
        var workerLink = this._linkDirectory.getLink('default-worker');
        workerLink.addHub(appUtils.getGlobalObject());
    }

    return config;
};

/**
 * Detect the 'endpoint' script location, and create a shared worker to
 * the Endpoint.js script, thereby creating an Endpoint.js hub.
 * @private
 */
ConfigurationFactory.prototype._createSharedWorker = function(scriptName) {
    if (!scriptName) {
        scriptName = appUtils.getScriptName();
    }
    log.log(log.DEBUG, 'Creating shared worker hub: [URL: %s]', scriptName);
    try {
        return new SharedWorker(scriptName);
    }
    catch (e) {
        log.log(log.WARN, 'Issue creating shared worker [message: %s]', e.message);
    }
};
