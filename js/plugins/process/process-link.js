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

var ProtocolLink = require('../../app/link/protocol-link'),
    inherits = require('util').inherits,
    through2 = require('through2'),
    stringifyStream = require('../../app/streams/stringify-stream'),
    appUtils = require('../../app/util/appUtils'),
    log = appUtils.getLogger(__filename);

inherits(ProcessLink, ProtocolLink);

module.exports = ProcessLink;

/**
 * Create a ProcessLink link.
 * @param instanceId
 * @param linkId
 * @param settings
 * @constructor
 */
function ProcessLink(instanceId, linkId, settings) {
    if (!(this instanceof ProcessLink)) { return new ProcessLink(instanceId, linkId, settings); }
    this._external = settings.hasOwnProperty('external') ? !!settings.external : false;
    ProtocolLink.call(this, instanceId, linkId, settings);
}

ProcessLink.prototype.isExternal = function() {
    return this._external;
};

ProcessLink.prototype.getCost = function() {
    return 0.5;
};

ProcessLink.prototype.getType = function() {
    return 'process';
};

ProcessLink.prototype.addProcess = function(proc) {
    log.log(log.DEBUG, 'Adding new process to ProcessLink link');

    // on message
    var decodeFunction = stringifyStream.decodeFunction;

    // read stream
    var readStream = through2.obj();

    // function to read messages
    function messageFunc(data) {
        var msg = decodeFunction(true, data);
        log.log(log.TRACE, 'Received message: [%s]', data);
        msg.process = proc;
        msg.cleanUp = cleanUp;
        readStream.write(msg);
    }

    // cleanup function
    function cleanUp() {
        readStream.end();
        proc.removeListener('message', messageFunc);
    }

    // Listen for messages
    proc.on('message', messageFunc);

    // Wait for new messages
    this._handleReader(readStream);

    // on child dies
    proc.on('exit', function() {
        log.log(log.DEBUG, 'Child process has exited');
        cleanUp();
    });

    // Identify to child process
    if (proc.send && proc !== process) {
        this._announceProcess(proc);
    }
};

ProcessLink.prototype._createSenderStream = function(metadata) {
    var writeStream = through2.obj();
    var encodeFunction = stringifyStream.encodeFunction;
    writeStream.on('readable', function() {
        var msg;
        while ((msg = writeStream.read()) !== null) {
            log.log(log.TRACE, 'Sending message: [%j]', msg);
            metadata.process.send(encodeFunction(true, msg));
        }
    });
    writeStream.on('end', function() {
        if (metadata.cleanUp) {
            metadata.cleanUp();
        }
    })
    return writeStream;
};

ProcessLink.prototype._announceProcess = function(proc) {
    this._announce({process:proc});
};
