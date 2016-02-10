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

var switchBoard = require('./switching/switch-board'),
    router = require('./routing/router'),
    path = require('./routing/path-vector'),
    affinity = require('./routing/host-affinity'),
    bus = require('./endpoint/bus'),
    streamer = require('./endpoint/streamer'),
    messenger = require('./endpoint/messenger'),
    endpointManager = require('./endpoint/endpoint-manager'),
    api = require('./api/api');

module.exports = Loader;

/**
 * Loader will construct an Endpoint.js instance without
 * any configured links.
 * @module Loader
 */
function Loader(linkDirectory, config) {

    // Initialize the switchboard
    var switchBoardInstance = switchBoard(linkDirectory, config);

    // Create the router handler
    var routerInstance = router(switchBoardInstance, config);

    // Create the path vector handler, which will route packets along a defined
    // path
    var pathInstance = path(routerInstance, config);

    // Create the bus handler, which will establish and create a path using
    // controlled flooding
    var busInstance = bus(routerInstance, config);

    // Create the bridge handler, which will route packets along a stateful, chained
    // path from one host to another
    var affinityInstance = affinity(routerInstance, config);

    // Create the messenger handler, which will send messages along a bridge, or
    // a path if the bridge doesn't exist
    var messengerInstance = messenger(pathInstance, routerInstance, config);

    // Create the streaming handler, which will send messages along a bridge, or
    // a path if the bridge doesn't exist
    var streamerInstance = streamer(pathInstance, routerInstance, config);

    // Aggregate the items
    var services = {
        switchboard: switchBoardInstance,
        router: routerInstance,
        path: pathInstance,
        bus: busInstance,
        hostaffinity: affinityInstance,
        messenger: messengerInstance,
        streamer: streamerInstance
    };

    // Create the endpoint manager, which manages the endpoints
    var managerInstance = endpointManager(config, services);

    // Initialize the API layer
    var apiInstance = api(managerInstance, config);

    return apiInstance;
}
