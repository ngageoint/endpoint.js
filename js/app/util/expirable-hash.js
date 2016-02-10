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

var periodicTimer = require('./periodic-timer'),
    inherits = require('util').inherits,
    EventEmitter = require('events').EventEmitter;

inherits(ExpirableHash, EventEmitter);

module.exports = ExpirableHash;

/**
 * A Javascript Hash object where the objects expire after a certain amount of
 * time in milliseconds
 * @constructor
 */
function ExpirableHash(duration, name) {
    if (!(this instanceof ExpirableHash)) { return new ExpirableHash(duration, name); }
    EventEmitter.call(this);
    this._duration = duration * 1000;
    this._items = 0;
    this._itemsArray = [];
    this._itemsHash = {};
    this._timer = periodicTimer(name || 'Expirable Hash', this._duration);
    this._timer.on('period', this._check.bind(this));
}

/**
 * Add a key to the dictionary
 * @param key
 * @param value
 */
ExpirableHash.prototype.add = function(key, value) {
    this._clean();
    this.remove(key);
    var item = {
        k: key,
        v: value,
        t: (new Date()).getTime() + this._duration
    };
    this._items += 1;
    this._itemsArray.push(item);
    this._itemsHash[key] = item;
    this._timer.addReference();
};

/**
 * Get a key from the dictionary.
 * @param key
 */
ExpirableHash.prototype.get = function(key) {
    // Check for expired keys
    this._check();
    var item = this._itemsHash[key];
    if (item) {
        return item.v;
    }
};

/**
 * Update the time value of the given key
 * @param key
 */
ExpirableHash.prototype.touch = function(key) {
    var val = this.get(key);
    if (val) {
        this.remove(key);
        this.add(key, val);
    }
};

/**
 * Remove a key from the dictionary
 * @param key
 */
ExpirableHash.prototype.remove = function(key) {
    var item = this._itemsHash[key];
    if (item) {
        this._items -= 1;
        item.v = item.k = null;
        item.t = 0;
        delete this._itemsHash[key];
        this._timer.removeReference();
    }
};

/**
 * Remove expired keys
 * @private
 */
ExpirableHash.prototype._check = function() {
    var now = (new Date()).getTime();
    while (this._itemsArray.length > 0) {
        var item = this._itemsArray[0];
        if (item.t > now) {
            break;
        }
        else if (item.t > 0) {
            this.emit('expired', item.k, item.v);
            this.remove(item.k);
        }
        this._itemsArray.shift();
    }
};

/**
 * Clean up the hash if the amount of dead items is double the
 * amount of items in the hash.  But only if the amount of items
 * is greater than 10.
 * @private
 */
ExpirableHash.prototype._clean = function() {
    if (this._itemsArray.length > 10 &&
        this._itemsArray.length > (this._items * 2)) {
        var newArray = [];
        this._itemsArray.forEach(function(item) {
            if (item.t > 0) {
                newArray.push(item);
            }
        });
        this._itemsArray = newArray;
    }
};
