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

var appUtils = require('./util/appUtils'),
    loader = require('./loader'),
    linkDirectory = require('./switching/link-directory'),
    configurationFactory = require('./config/configuration-factory'),
    logManager = require('./util/logger'),
    log = appUtils.getLogger(__filename);

/**
 * This file initializes all the individual pieces of Endpoint.js
 * and connects them together for a node.js standalone instance.
 * @param {Object} configJson - override default configuration
 * @module server
 */
module.exports = function(configJson, logLevel) {

    // Set the log level if the user is so inclined.
    if (logLevel) {
        logManager.logLevel = logLevel;
    }

    var linkDirectoryInstance = linkDirectory();

    // Default configuration based on being in a web browser.
    var config = configurationFactory(linkDirectoryInstance)
            .createDefaultServerConfiguration(configJson || {});

    // Get an instance of the API
    var apiInstance = loader(linkDirectoryInstance, config);

    // We're done!
    log.log(log.INFO, 'Endpoint.js Initialized [Instance ID: %s]', apiInstance.getInstanceId());

    return apiInstance;
};
