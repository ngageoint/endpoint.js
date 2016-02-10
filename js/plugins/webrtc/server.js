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

var rtcSwitchboard = require('rtc-switch'),
    logManager = require('../../app/util/logger'),
    appUtils = require('../../app/util/appUtils'),
    log = appUtils.getLogger(__filename);

/**
 * This module will create the webrtc discovery api needed by webrtc
 * clients.  This uses the rtc.io switch-board to execute.
 * @param endpoint
 * @param {Object} [settings] - passed to the adapter, with a default neighborhood of 'global'
 * @module webrtc-server
 */
module.exports = function(endpoint, settings, logLevel) {

    // Set the log level if the user is so inclined.
    if (logLevel) {
        logManager.logLevel = logLevel;
    }

    settings = settings || {};
    settings.neighborhood = settings.neighborhood || 'global';

    // This was modeled off of 'rtm-switchboard/index.js'
    var board = rtcSwitchboard();

    var obj = {
        register: function() {
            var ctx = adapter.getCurrentContext();
            var str = ctx.getInputStream();
            var clientId = ctx.getClientInstance().getId();

            log.log(log.DEBUG, 'A webrtc client has connected: %s', clientId);

            var peer = board.connect();

            // Forward all readable data to peer.
            str.on('readable', function() {
                var msg;
                while ((msg = str.read()) !== null) {
                    log.log(log.TRACE, 'Received message: [%j]', msg);
                    peer.process(msg);
                }
            });

            // When the stream ends, then leave the peer
            str.on('finish', function() {
                log.log(log.DEBUG, 'A webrtc client has disconnected: %s', clientId);
                peer.leave();
            });

            // When the peer has data to write, send to the socket.
            peer.on('data', function(data) {
                log.log(log.TRACE, 'Sending message: [%j]', data);
                str.write(data);
            });
        }
    };

    var adapter = endpoint.registerAdapter('web-rtc-discovery', '1.0', obj, settings);
    return adapter;
};
