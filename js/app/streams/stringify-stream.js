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

var through2 = require('through2'),
    isBuffer = require('util').isBuffer,
    Buffer = require('buffer').Buffer;

/**
 * The buffer stringify stream supports two forms of encoding node.js
 * buffers.  The first will perform a base64 encoding of buffer objects
 * in place, and then run that through JSON.stringify.  The second method
 * will put 'placeholders' where the buffers were, and transfer the raw
 * 'buffer' objects in a modified packet.
 * @module stringify-stream
 */
module.exports = {};

/**
 * Stringify the chunk if it's an object.
 * @returns {*}
 */
module.exports.encode = function(inPlace) {
    return through2.obj(function(chunk, encoding, cb) {
        this.push(module.exports.encodeFunction(inPlace, chunk));
        cb();
    });
};

/**
 * TODO: Be able to support typed arrays and array buffer encoding,
 * for object mode streams that contain binary.
 * This is the function used by the encode stream
 * @param chunk
 * @returns {*}
 */
module.exports.encodeFunction = function(inPlace, chunk) {
    var obj;
    if (inPlace) {
        chunk = traverse('', chunk, function(key, value) {
            if (value._isBuffer || isBuffer(value)) {
                value = {
                    type: 'buffer-i',
                    data: value.toString('base64')
                };
            }
            return value;
        });
        obj = JSON.stringify(chunk);
    }
    else {
        var transfer = [];
        var i = 0;
        chunk = traverse('', chunk, function(key, value) {
            if (chunk._isBuffer || isBuffer(value)) {
                var newValue = {
                    type: 'buffer-o',
                    index: i++
                };
                transfer.push(value.toArrayBuffer());
                return newValue;
            }
            return value;
        });
        obj = JSON.stringify(chunk);
        obj = {
            data: obj,
            transfer: transfer
        };
    }
    return obj;
};

/**
 * Parse the chunk if it's a string.
 * @returns {*}
 */
module.exports.decode = function(inPlace) {
    return through2.obj(function(chunk, encoding, cb) {
        this.push(module.exports.decodeFunction(inPlace, chunk));
        cb();
    });
};

/**
 * This is the function used by the decode stream
 * @param chunk
 * @returns {*}
 */
module.exports.decodeFunction = function(inPlace, chunk) {
    var obj;
    if (inPlace) {
        obj = JSON.parse(chunk);
        obj = traverse('', obj, function(key, value) {
            if (value && value.type == 'buffer-i') {
                return new Buffer(value.data, 'base64');
            }
            return value;
        });
    }
    else {
        obj = JSON.parse(chunk.data);
        obj = traverse('', obj, function(key, value) {
            if (value && value.type == 'buffer-o') {
                return new Buffer(chunk.transfer[value.index]);
            }
            return value;
        });
    }
    return obj;
};

/**
 * Traverse the object stack and execute func on it.
 * @param funcCB
 */
function traverse(key, value, funcCB) {
    var v1 = funcCB(key, value);
    if (value === v1) {
        if (v1 && typeof (v1) == 'object') {
            for (var k in v1) {
                if (Object.prototype.hasOwnProperty.call(v1, k)) {
                    if (v1[k]) {
                        v1[k] = traverse(k, v1[k], funcCB);
                    }
                }
            }
        }
    }
    else {
        return v1;
    }
    return value;
}
