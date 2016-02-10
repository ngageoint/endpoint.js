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

/**
 * Common constants used throughout the API.
 * @module
 */
module.exports = {

    /**
     * The valid types of endpoints within the system
     */
    EndpointType: {

        CLIENT: 'Client',

        CLIENT_INSTANCE: 'Client Instance',

        FACADE: 'Facade',

        ADAPTER: 'Adapter',

        OBJECT_INSTANCE: 'Object Instance',

        CALL: 'Call',

        QUERY: 'Query'

    },

    /**
     * The valid types of Links that can connect to
     * endpoints in the system
     */
    LinkType: {

        SERVER: 'server',

        WORKER: 'worker',

        TAB: 'tab',

        WINDOW: 'window'
    },

    /**
     * When a message is sent or received, this allows for determining
     * how wide to send it, or where it originated from.  These values
     * are set by the router as messages come in and leave the system.
     */
    Neighborhood: {

        UNIVERSAL: 3,

        GLOBAL: 2,

        GROUP: 1,

        LOCAL: 0
    }
};

