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

inherits(WebRTC, ProtocolLink);

module.exports = WebRTC;

/**
 * Create a WebRTC link.
 * @param instanceId
 * @param linkId
 * @param settings
 * @constructor
 */
function WebRTC(instanceId, linkId, settings) {
    if (!(this instanceof WebRTC)) { return new WebRTC(instanceId, linkId, settings); }
    this._channel = settings.channel || 'data-channel';
    this._external = settings.hasOwnProperty('external') ? !!settings.external : true;
    ProtocolLink.call(this, instanceId, linkId, settings);
}

WebRTC.prototype.isExternal = function() {
    return this._external;
};

WebRTC.prototype.getCost = function() {
    return 25;
};

WebRTC.prototype.getType = function() {
    return 'webrtc';
};

WebRTC.prototype.addConference = function(conference) {
    log.log(log.DEBUG, 'Adding new conference to WebRTC link');
    var data = {};

    var session = conference.createDataChannel(this._channel, {
        ordered: true,
        maxRetransmits: 12
    });

    var _this = this;
    session.on('channel:opened:' + this._channel, function(id, dc) {
        log.log(log.DEBUG2, 'WebRTC channel [%s] opened from %s', _this._channel, id);

        data[id] = {
            readStream: through2.obj(),
            channel: dc,
            id: id
        };

        var decodeFunction = stringifyStream.decodeFunction;

        dc.onmessage = function(event) {
            var msg = decodeFunction(true, event.data);
            log.log(log.TRACE, 'Received message: [%s]', event.data);
            msg.channel = dc;
            data[id].readStream.write(msg);
        };

        _this._handleReader(data[id].readStream);

        if (session.id > id) {
            _this.announceChannel(dc);
        }
    });

    session.on('channel:closed:' + this._channel, function(id) {
        log.log(log.DEBUG2, 'WebRTC channel [%s] closed from %s', _this._channel, id);
        data[id].readStream.push(null);
        delete data[id];
    });

};

WebRTC.prototype._createSenderStream = function(metadata) {
    var writeStream = through2.obj();
    var encodeFunction = stringifyStream.encodeFunction;
    writeStream.on('readable', function() {
        var msg;
        while ((msg = writeStream.read()) !== null) {
            log.log(log.TRACE, 'Sending message: [%j]', msg);
            metadata.channel.send(encodeFunction(true, msg));
        }
    });
    return writeStream;
};

WebRTC.prototype.announceChannel = function(dataChannel) {
    this._announce({channel:dataChannel});
};
