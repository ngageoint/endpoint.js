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
/* globals __filename, WorkerGlobalScope, SharedWorker */

'use strict';

var appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

/**
 * This namespace has functions to test for support of various
 * transports
 * @namespace link-support
 */
module.exports = {

    /**
     * This function can be used to detect if we're a worker hub.
     */
    isWorkerHub: function(worker) {
        if ('onconnect' in worker) {
            return true;
        }
        return false;
    },

    /**
     * This function can be used to detect if we're a worker.
     */
    isWorker: function(worker) {
        if (typeof (WorkerGlobalScope) != 'undefined' && worker instanceof WorkerGlobalScope) {
            return true;
        }
        return false;
    },

    /**
     * Test whether this browser supports local storage
     * @returns {boolean}
     */
    supportsLocalStorage: function() {
        var globalObject = appUtils.getGlobalObject();
        var localStorage = globalObject.localStorage;

        var setItemAllowed = true;
        try {
            localStorage.setItem('__test_support', '');
            localStorage.removeItem('__test_support');
        } catch (e) {
            setItemAllowed = false;
        }

        var supported = localStorage && setItemAllowed &&
            (typeof (globalObject.addEventListener) == 'function' ||
                typeof (globalObject.attachEvent) == 'function');

        log.log(log.DEBUG3, 'Local Storage Supported: %s', supported);

        return supported;
    },

    /**
     * Whether the 'shared worker' class exists, and whether we can create
     * a shared worker.  This also requires the 'script name' to be set,
     * which is determined in the 'browser.js' bootstrap code
     */
    supportsSharedWorker: function() {
        if (typeof (SharedWorker) !== 'function') {
            return false;
        }
        var scriptName = appUtils.getScriptName();
        if (scriptName) {
            if (!(/endpoint/.test(scriptName))) {
                log.log(log.ERROR, 'Endpoint.js Script must be synchronously loaded and have endpoint in the ' +
                    'name to use Shared Worker transport');
                return false;
            }
            // We know we're in a window, so we're going to use HREF tag to parse urls.
            // Node.js URL library is too large for browser.
            var scriptLink = appUtils.getGlobalObject().document.createElement('a');
            scriptLink.href = scriptName;
            // Get the window origin.
            var obj = appUtils.getGlobalObject().location;
            if (obj.protocol == scriptLink.protocol &&
                obj.hostname == scriptLink.hostname &&
                obj.port == scriptLink.port) {
                return true;
            }
        }

        log.log(log.WARN, 'Cannot create shared worker, unknown script name or cross-domain issue.');
        return false;
    }

};
