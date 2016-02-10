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
/*globals global, process */
'use strict';

var logger = require('./logger').Logger,
    constants = require('./constants'),
    isString = require('util').isString;

/**
 * A set of utilities, such as creating loggers or setting the script name.  Also contains
 * event subscription utility functions.
 * @namespace
 * @property {String} _scriptName
 */
var appUtils = {

    /**
     * The name of the executing script, populated by loader.js
     */
    _scriptName: null,

    /**
     * This function will determine the Endpoint.js script name
     * @returns {*}
     */
    initScriptName: function() {
        if (!this._scriptName) {
            var wnd = this.getGlobalObject();
            if (wnd.document) {
                // The most recently executing script should be Endpoint.js.  Lets
                // get the address for it.
                var scripts = wnd.document.getElementsByTagName('script');
                var script = scripts[scripts.length - 1];
                this._scriptName = script.src;
            }
        }
    },

    /**
     * Ensure the UUID is the right size
     * @param uuid
     */
    isUuid: function(uuid) {
        if (isString(uuid) && uuid.length == 36) {
            return true;
        }
        return false;
    },

    /**
     * Ensure the External UUID is the right size
     * @param uuid
     */
    isExtUuid: function(uuid) {
        if (isString(uuid) && uuid.length == 40 && uuid.indexOf('-ext') === 36) {
            return true;
        }
        return false;
    },

    /**
     * Return the script name
     * @returns {string}
     */
    getScriptName: function() {
        return this._scriptName;
    },

    // This module returns a reference to the global (Window) object.
    // See the link below for an in depth explanation as to why this
    // is necessary.
    //
    // http://stackoverflow.com/questions/7290086/javascript-use-strict-and-nicks-find-global-function
    //
    // The gist is that:
    //
    // (1) we want to operate in strict mode at all times in all files
    // (2) outside of strict mode, 'this' would refer to the global
    //     Window object, but when running in strict mode, 'this' is
    //     undefined
    // (3) Because of RequireJS, we often wrap our code in a closure,
    //     which prevents some other popular techniques from working
    // (4) The approach below works in all Browsers, Engines, ES3,
    //     ES5, strict, nested scope, etc. and will pass JSHint/JSLint
    //
    getGlobalObject: function() {
        return global;
    },

    /**
     * Execute the given function on the next tick.
     * @param func
     */
    nextTick: function(func) {
        process.nextTick(func);
    },

    /**
     * __filename doesn't properly work in browserify on windows.
     * @param location
     * @returns {*}
     */
    getScriptBasename: function(location) {
        if (location &&
            typeof (location) == 'string' &&
            (location[0] == '/' || location[0] == '\\')) {
            location = location.replace(/\\/g, '/');
            var pieces = location.split('/');
            location = pieces[pieces.length - 1];
        }
        return location;
    },

    /**
     * This function will instantiate a logger and return it.
     * @param location
     */
    getLogger: function(location) {
        return logger(this.getScriptBasename(location));
    },

    /**
     * IE Safe event listener
     * @param event
     * @param cb
     * @param bubble
     */
    addEventListener: function(obj, event, cb, bubble) {
        if ('addEventListener' in obj) {
            obj.addEventListener(event, cb, bubble);
        }
        else {
            obj.attachEvent('on' + event, cb);
        }
    },

    /**
     * IE Safe event listener
     * @param event
     * @param cb
     * @param bubble
     */
    removeEventListener: function(obj, event, cb, bubble) {
        if ('removeEventListener' in obj) {
            obj.removeEventListener(event, cb, bubble);
        }
        else {
            obj.detachEvent('on' + event, cb);
        }
    },

    /**
     * Attempt to parse the neighborhood, and if undefined, use default.
     */
    getNeighborhood: function(specifiedNeighborhood, defaultNeighborhood) {
        var nDefault = constants.Neighborhood[(defaultNeighborhood + '').toUpperCase()];
        var nSpecified = constants.Neighborhood[(specifiedNeighborhood + '').toUpperCase()];
        return typeof (nSpecified) == 'undefined' ? nDefault : nSpecified;
    }

};

module.exports = appUtils;
