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

'use strict';

var EventEmitter = require('events').EventEmitter,
    inherits = require('util').inherits,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(FacadeManager, EventEmitter);

module.exports = FacadeManager;

/**
 * What facade manager does is manages a list of facades, reconnects them
 * if necessary for the user.  It is sort of a dependency manager.
 * @augments EventEmitter
 * @param {Api} api - references the Api class to call createFacade function.
 * @constructor
 */
function FacadeManager(api) {
    if (!(this instanceof FacadeManager)) { return new FacadeManager(api); }

    EventEmitter.call(this);

    this._facades = {};
    this._api = api;
    this._ready = false;
    this._closed = false;
    this._totalFacades = 0;
    this._facadesReady = 0;
}

/**
 * Returns the facade with the given name
 * @param name
 * @returns {*}
 */
FacadeManager.prototype.getFacade = function(name) {
    if (!this._facades[name]) {
        throw new Error('Do not know of that facade');
    }
    return this._facades[name];
};

/**
 * Return the api of the facade
 * @param name
 */
FacadeManager.prototype.getApi = function(name) {
    if (!this._ready) {
        throw new Error('Facade Manager isn\'t ready');
    }
    return this.getFacade(name).getApi();
};

/**
 * Return the events of the facade
 * @param name
 */
FacadeManager.prototype.getEvents = function(name) {
    if (!this._ready) {
        throw new Error('Facade Manager isn\'t ready');
    }
    return this.getFacade(name).getEvents();
};

/**
 * Manage a facade.
 * @param facade
 */
FacadeManager.prototype.addFacade = function(name, version, settings) {

    if (this._facades[name]) {
        throw new Error('Can only managed one facade of a specific type');
    }

    var facade = this._api.createFacade(name, version, settings);

    this._totalFacades += 1;
    this._facades[facade.getName()] = facade;

    facade.on('closed', function() {
        log.log(log.DEBUG2, 'Facade was closed for %s', facade.getId());
        delete this._facades[facade.getName()];
        this._totalFacades -= 1;
        if (facade.isReady()) {
            // Code below will add a new one.
            this._facadesReady -= 1;
        }
        if (!this._closed) {
            log.log(log.WARN, 'Facade was closed.  Re-creating for %s', facade.getId());
            this.addFacade(name, version, settings);
        }
    }.bind(this));

    facade.on('ready', function() {
        this._facadesReady += 1;
        if (this._facadesReady === this._totalFacades) {
            var wasReady = true;
            if (!this._ready) {
                wasReady = false;
                this._ready = true;
            }
            this.emit('reconnect');
            if (!wasReady) {
                this.emit('ready');
            }
        }
    }.bind(this));

};

/**
 * Close all the facades
 */
FacadeManager.prototype.close = function() {
    this._closed = true;
    var facades = Object.keys(this._facades);
    facades.forEach(function(facade) {
        this._facades[facade].close();
    }, this);
};
