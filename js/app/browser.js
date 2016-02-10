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

/* globals __filename */
/* jshint -W097 */
'use strict';

// Polyfills for basic EMCAScript tech (for IE8 and Firefox 3.6)
require('./util/polyfills');

var appUtils = require('./util/appUtils'),
    logManager = require('./util/logger'),
    loader = require('./loader'),
    linkDirectory = require('./switching/link-directory'),
    configurationFactory = require('./config/configuration-factory'),
    log = appUtils.getLogger(__filename);

/**
 * This file initializes all the individual pieces of Endpoint.js
 * and connects them together for a web browser.
 * @module browser
 */

// If a manual log level is set, then set the log.
if (appUtils.getGlobalObject().endpointLogLevel) {
    logManager.logLevel = appUtils.getGlobalObject().endpointLogLevel;
}

// What is the name of this script?
appUtils.initScriptName();

// If we're already initialized, then don't do anything.
if (!appUtils.getGlobalObject().endpoint) {

    var linkDirectoryInstance = linkDirectory();

    var configJson = {};
    if (appUtils.getGlobalObject().endpointConfig) {
        configJson = appUtils.getGlobalObject().endpointConfig || {};
    }

    // Default configuration based on being in a web browser.
    var config = configurationFactory(linkDirectoryInstance)
        .createDefaultBrowserConfiguration(configJson);

    // Get an instance of the API
    var apiInstance = loader(linkDirectoryInstance, config);

    // Set the api instance on the window.
    appUtils.getGlobalObject().endpoint = apiInstance;

    // We're done!
    log.log(log.INFO, 'Endpoint.js Initialized [Instance ID: %s]', apiInstance.getInstanceId());
}
else {
    log.log(log.INFO, 'Endpoint.js Already Initialized');
}

