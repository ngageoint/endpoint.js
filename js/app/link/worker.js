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

var ProtocolLink = require('./protocol-link'),
    inherits = require('util').inherits,
    appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename),
    through2 = require('through2'),
    stringifyStream = require('../streams/stringify-stream'),
    readTransport = require('../transport/postmessage-reader'),
    sendTransport = require('../transport/postmessage-sender');

inherits(WorkerLink, ProtocolLink);

module.exports = WorkerLink;

/**
 * A Shared worker accepts connections from multiple sources, while
 * a normal worker is only one source.
 * @todo There is not currently a way to determine if a port
 * closes (no event), so we rely on the protocol events
 * and heartbeat.
 * @augments ProtocolLink
 * @param {String} instanceId - unique identifier for this endpoint.js instance
 * @param {String} linkId - unique identifier for this link instance
 * @param {Object} settings - settings for the link.  There are none currently
 * @constructor
 */
function WorkerLink(instanceId, linkId, settings) {
    if (!(this instanceof WorkerLink)) { return new WorkerLink(instanceId, linkId, settings); }

    // There can only be one hub (if we're a worker).  So if someone adds
    // a worker that is a hub, then set it here.
    this._workerHub = null;

    // Call parent
    ProtocolLink.call(this, instanceId, linkId, settings);

    log.log(log.DEBUG2, 'Worker Link initialized: [Settings: %j]', settings);
}

/**
 * Adds a worker to the worker link (expects it to use Endpoint.js!)
 * @param worker
 */
WorkerLink.prototype.addWorker = function(worker) {
    var port = this.addHub(worker);
    this.announceWorker(port);
};

/**
 * Used with dedicated workers and shared workers to create
 * instances that can be connected/announced to.
 * @param hub
 */
WorkerLink.prototype.addHub = function(worker) {

    // Account for shared workers
    if ('port' in worker) {
        worker = worker.port;
    }

    // Determine if we're a shared worker.
    if ('onconnect' in worker) {

        if (this._workerHub !== null) {
            var msg = 'Already assigned a worker hub';
            log.log(log.ERROR, msg);
            throw new Error(msg);
        }

        // Save so we can remove the event listener on close.
        this._workerHub = worker;

        // Add an event listener for new connections (assuming this is a shared worker)
        this._connectEventPtr = this._onConnect.bind(this);
        appUtils.addEventListener(worker, 'connect', this._connectEventPtr, false);

        log.log(log.DEBUG2, 'Worker scope detected, using hub mode');
        return null;
    }
    else {
        // Immediately add this worker
        var event = {
            ports: [worker]
        };
        var port = this._onConnect(event);

        log.log(log.DEBUG2, 'Using worker client mode');
        return port;
    }
};

/**
 * When a client connects to a shared worker, the port will
 * be given here.
 * @param event
 * @private
 */
WorkerLink.prototype._onConnect = function(event) {
    var port = event.ports[0];

    // Create our transport
    var transportStream = readTransport({
        target: port,
        checkOrigin: false
    });

    // Metadata for creating sender streams
    var meta = {
        port: port,
        cleanUp: cleanUp
    };

    // This stream will add the port to the
    // stream metadata.
    var readStream = through2.obj(function(chunk, encoding, cb) {
        chunk.meta = meta;
        this.push(chunk);
        cb();
    });

    transportStream
        .pipe(stringifyStream.decode(true))
        .pipe(readStream);

    // Tell our parent about it.
    this._handleReader(readStream);

    // If the port/worker is startable, then start it
    if ('start' in port) {
        port.start();
    }

    // Attach a function to the worker, so that if the link is closed, we can cleanup memory
    // resources
    function cleanUp() {
        transportStream.close();
    }

    return port;
};

/**
 * Will manually create a 'send' transport stream for the specific destination
 * @param destinationUuid
 * @param [metadata]
 * @returns {*}
 * @private
 */
WorkerLink.prototype._createSenderStream = function(metadata) {

    var sender = sendTransport({
        target: metadata.meta.port,
        sendOrigin: false
    });

    var encoder = stringifyStream.encode(true);
    encoder.pipe(sender);

    encoder.on('finish', function() {
        if (metadata.meta.cleanUp) {
            metadata.meta.cleanUp();
        }
    });

    return encoder;
};

/**
 * The cost to transmit to this link.  Worker is
 * the most efficient link type.
 * @returns {number}
 */
WorkerLink.prototype.getCost = function() {
    return 1.1;
};

/**
 * Return the type of this link.
 * @returns {string}
 */
WorkerLink.prototype.getType = function() {
    return 'worker';
};

/**
 * Manually announce to the given worker.
 * @param obj
 */
WorkerLink.prototype.announceWorker = function(port) {
    this._announce({
        meta: {
            port: port
        }
    });
};

/**
 * Remove event listeners, close streams
 */
WorkerLink.prototype.close = function() {

    // Remove connect event listener for new ports
    if (this._workerHub) {
        appUtils.removeEventListener(this._workerHub, 'connect', this._connectEventPtr, false);
    }

    // Close any streams (this will send goodbyes)
    ProtocolLink.prototype.close.call(this);
};
