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

var appUtils = require('../util/appUtils'),
    log = appUtils.getLogger(__filename);

module.exports = Messenger;

/**
 * The messenger is a simple point to point system that uses addressing
 * and the router to send messages
 * @augments EventEmitter
 * @param {PathVector} pathInstance - an instance of the PathVector class
 * @param {Router} routerInstance - an instance of the Router class
 * @param {Configuration} config - system configuration
 * @constructor
 */
function Messenger(pathInstance, routerInstance, config) {
    if (!(this instanceof Messenger)) return new Messenger(pathInstance, routerInstance, config);

    this._id = config.get('instanceId');

    this._listeners = {};

    // Save a reference to the path vector
    this._pathInstance = pathInstance;

    // Subscribe to router events.
    this._routerInstance = routerInstance;
    this._routerInstance.addHandler('message');
    this._routerInstance.on('message', this._handleMessagePacket.bind(this));
    this._routerInstance.on('message-error', this._handleMessageError.bind(this));
}

/**
 * Register a listener with the messenger.  This should be unique across the
 * Endpoint.js.
 * @param id
 * @param callback
 * @return address
 */
Messenger.prototype.register = function(id, callback) {
    if (!this._listeners[id]) {
        if (typeof (callback) == 'function') {
            this._listeners[id] = callback;
        }
        else {
            var error = new Error('Must register a function callback');
            log.log(log.ERROR, error.message);
            throw error;
        }
    }
    else {
        log.log(log.WARN, 'The listener [id: %s] cannot be registered because ' +
            'it is already registered', id);
    }
};

/**
 * Stop listening for messages for this id.
 * @param id
 */
Messenger.prototype.unRegister = function(id) {
    if (this._listeners[id]) {
        delete this._listeners[id];
    }
    else {
        log.log(log.WARN, 'The listener [id: %s] cannot be removed because ' +
            'it is not registered', id);
    }
};

/**
 * Send a message to a specific host
 * @param remoteAddress - address of remote endpoint.js instance
 * @param remoteId - endpoint id
 * @param message
 */
Messenger.prototype.sendMessage = function(remoteAddress, remoteId, message) {
    var msg = {
        id: remoteId,
        msg: message
    };
    log.log(log.TRACE, 'Outbound Messenger Packet: %j', message);
    this._pathInstance.sendPacket(remoteAddress, 'message', msg);
};

/**
 * Local delivery for remote packet.
 * @param packet
 * @private
 */
Messenger.prototype._handleMessagePacket = function(packet, fromUuid, source) {
    if (packet.id) {
        if (this._listeners[packet.id]) {
            log.log(log.TRACE, 'Inbound Messenger Packet: %j', packet);
            // Local delivery.
            try {
                this._listeners[packet.id](packet.msg, source);
            }
            catch (e) {
                log.log(log.WARN, 'Issue delivering message packet [id: %s] [exception: %s] [trace: %s]',
                    packet.id, e.toString(), e.stack);
            }
        }
        else {
            log.log(log.WARN, 'Unknown messenger id: %j', packet);
        }
    }
    else {
        log.log(log.ERROR, 'Malformed messenger packet: %j', packet);
    }
};

/**
 * If there is an issue in the router routing the message, then
 * log the issue.
 * @param fromUuid
 * @param toUuid
 * @param packet
 * @private
 */
Messenger.prototype._handleMessageError = function(packet, toUuid) {
    log.log(log.ERROR, 'Couldn\'t route message for %j: %j', toUuid, packet);
};
