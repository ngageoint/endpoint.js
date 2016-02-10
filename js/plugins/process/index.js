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

var processLink = require('./process-link'),
    logManager = require('../../app/util/logger'),
    appUtils = require('../../app/util/appUtils'),
    log = appUtils.getLogger(__filename);

/**
 * This module will register the process link with an endpoint.js instance
 * @param endpoint
 * @param linkName - the name of the first link to create
 * @module process-link
 */
module.exports = function(endpoint, linkName) {

    // Initialize the webrtc link inside Endpoint.js
    var linkType = 'process';
    var linkCreateFunction = function(instanceId, linkId, settings) {
        return processLink(instanceId, linkId, settings);
    };
    endpoint.getConfiguration().addCustomLinkType(linkType, linkCreateFunction);

    var link;
    if (linkName) {
        link = endpoint.getConfiguration().addLink({
            linkId: 'default-process',
            type: 'process'
        });

        // Add myself.
        link.addProcess(process);

        // If this process ends, before ending close the link
        process.on('exit', function() {
            link.close();
        });
    }

    log.log(log.DEBUG, 'Added Process link to endpoint instance: %s', endpoint.getInstanceId());
    return link;
};
