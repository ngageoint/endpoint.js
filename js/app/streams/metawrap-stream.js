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

var through2 = require('through2');

/**
 * @module metawrap-stream
 */
module.exports = {};

/**
 * Takes an object and wraps it in another
 * object so we can transfer metadata
 * @returns {*}
 */
module.exports.encodeMetaWrapStream = function(meta) {
    if (meta) {
        var str = through2.obj(function(chunk, encoding, cb) {
            this.push({
                meta: meta,
                m: chunk
            });
            cb();
        });
        str.updateMeta = function(newMeta) {
            meta = newMeta;
        };
        return str;
    }
    else {
        return through2.obj(function(chunk, encoding, cb) {
            this.push({ m: chunk });
            cb();
        });
    }
};

/**
 * Parse the chunk if it's a string.
 * @returns {*}
 */
module.exports.decodeMetaWrapStream = function() {
    return through2.obj(function(chunk, encoding, cb) {
        this.push(chunk.m);
        cb();
    });
};
