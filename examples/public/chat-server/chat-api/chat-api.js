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

    function init(divId) {

        my._container = document.getElementById(divId);

        var elem = thisDoc.getElementById('chat-api-template');
        my._template = $(elem).html();

        elem = thisDoc.getElementById('chat-api-local-message');
        my._local = $(elem).html();

        elem = thisDoc.getElementById('chat-api-remote-message');
        my._remote = $(elem).html();
    }

    function connect(api) {
        // Create a chat connection to the given id.

        $(my._container).append(my._template);
        var item = $(my._container).children().last();

        var settings = {
            api: api
        };
        connected[api.id] = endpoint.createFacade('chat-api', '0.1', settings);

        connected[api.id].on('ready', function() {
            var str = connected[api.id].getApi().chat(my._adapter.getId()).stream();
            setup(item, str, api.id);
        });
    }

    function lookForHosts() {

        // Start looking for new windows to connect to.
        function doLook() {
            var settings = {
                criteria: {
                    myInstanceId: my._adapter.getId()
                },
                neighborhood: 'universal'
            };
            var others = endpoint.createQuery('chat-api', '0.1', settings);
            others.on('api', function(response) {
                if (!connected[response.id]) {
                    connect(response);
                }
            });
            others.on('closed', function() {
                doLook();
            });
        };

        doLook();

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

    /**
     * The api as exposed via sidebar-api v. 0.1
     */
    var api = {
        chat: chat
    };

    // Don't allow connections from myself.
    var resolver = {
        resolve: function(criteria, metadata) {
            var remoteId = my._adapter.getId();
            if (remoteId == criteria.myInstanceId) {
                return false;
            }
            if (connected[criteria.myInstanceId]) {
                return false;
            }
            return true;
        }
    };

    // Register the adapter.
    var settings = {
        resolver: resolver,
        neighborhood: 'universal'
    }
    my._adapter = endpoint.registerAdapter('chat-api', '0.1', api, settings);

    init('chat');

    lookForHosts();

})(window.endpoint);
