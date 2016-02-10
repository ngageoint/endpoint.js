/*
 *  (C) 2016
 *  Booz Allen Hamilton, All rights reserved
 *  Powered by InnoVision, created by the GIAT
 *
 *  Integrated Module Controller was developed at the
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
/*globals global*/
'use strict';

var uuid = require('endpoint-uuid');

(function(endpoint) {

    var my = {};
    var connected = {};
    var thisDoc = document._currentScript.ownerDocument;

    function init() {

        my._container = document.getElementById('chat');

        var elem = thisDoc.getElementById('chat-api-template');
        my._template = $(elem).html();

        elem = thisDoc.getElementById('chat-api-local-message');
        my._local = $(elem).html();

        elem = thisDoc.getElementById('chat-api-remote-message');
        my._remote = $(elem).html();
    }

    function connect(bridgeId, id) {
        // Create a chat connection to the given id.

        $(my._container).append(my._template);
        var item = $(my._container).children().last();

        var settings = {
            bridgeId: bridgeId,
            neighborhood: 'global',
            criteria: {
                adapterId: my._adapter.getId(),
                desiredInstanceId: id
            }
        };
        connected[id] = endpoint.createFacade('webrtc-chat-api', '0.1', settings);

        connected[id].on('ready', function() {
            var str = connected[id].getApi().chat(my._adapter.getId()).stream();
            setup(item, str, id);
        });
    }

    // Establishes a change stream
    function chat(remoteId) {
        if (!connected[remoteId]) {
            var ctx = my._adapter.getCurrentContext();
            var inst = ctx.getClientInstance();
            connected[remoteId] = inst;
            var str = ctx.getInputStream();
            $(my._container).append(my._template);
            var item = $(my._container).children().last();
            setup(item, str, remoteId);
        }
    }

    function setup(template, str, instanceId) {

        var btn = template.find('.btn-chat');
        var txt = template.find('.btn-input');
        var inside = template.find('.chat');

        var dateFormat = 'MMMM Do YYYY, h:mm:ss a';

        var enterFunc = function() {
            var chat = txt.val();
            if (chat.length > 0) {
                txt.val("");

                str.write(chat);

                var msg = my._local.replace('{time}', window.moment().format(dateFormat));
                msg = msg.replace('{msg}', chat);

                // Add as something I said
                inside.append(msg);
            }
        };

        btn.on('click', enterFunc);
        txt.keypress(function(e) {
            if (e.which == 13) {
                enterFunc();
            }
        });

        str.on('readable', function() {
            var msg;
            while ((msg = str.read()) !== null) {

                var res = my._remote.replace('{time}', window.moment().format(dateFormat));
                res = res.replace('{msg}', msg);

                inside.append(res);
            }
        });

        var disconnect = function() {
            template.remove();
            str.end();
            delete connected[instanceId];
        };

        connected[instanceId].on('closed', disconnect);
        str.on('finish', disconnect);

    }

    // This adapter is used for the main application to tell us that a new connection has occured.
    var localApi = {
        reportConnection: function(bridgeId, id) {
            // Connect to the other side.
            if (id > endpoint.getInstanceId()) {
                connect(bridgeId, id);
            }
        }
    };
    var settings = {
        neighborhood: 'local'
    };
    endpoint.registerAdapter('webrtc-chat-local-api', '1.0', localApi, settings);

    // This is the API other clients use to requset a chat
    var remoteApi = {
        chat: chat
    };
    var resolver = {
        resolve: function(criteria) {
            // Don't connect to myself.
            if (criteria.adapterId && criteria.adapterId != my._adapter.getId() &&
                criteria.desiredInstanceId && criteria.desiredInstanceId == endpoint.getInstanceId()) {
                return true;
            }
            return false;
        }
    };
    var remoteApiSettings = {
        neighborhood: 'universal',
        resolver: resolver
    };
    my._adapter = endpoint.registerAdapter('webrtc-chat-api', '0.1', remoteApi, remoteApiSettings);

    init();

})(window.endpoint);
