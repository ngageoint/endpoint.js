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
    var thisdoc = document._currentScript.ownerDocument;

    function init(divId) {

        my._container = document.getElementById(divId);

        // Create the UI from template
        var elem = thisdoc.getElementById('custom-layers-api-template');
        var template = $(elem).html();
        $(my._container).html(template);

        $(document).on('click', '#plot-button', function() {
            var x = $('#point-x').val();
            var y = $('#point-y').val();
            plot(x, y);
        });
    }

    function plot(x, y) {
        x = parseFloat(x);
        y = parseFloat(y);
        if (!my._layerId) {
            my._layerId = uuid();
            my._mapapi.addVectorLayer(my._layerId)
                .then(function() {
                    return my._mapapiFactory.coordinate(x, y);
                })
                .then(function(coord) {
                    my._mapapi.addPoint(uuid(), my._layerId, coord);
                });
        }
        else {
            my._mapapiFactory.coordinate(x, y)
                .then(function(coord) {
                    my._mapapi.addPoint(uuid(), my._layerId, coord);
                })
                .catch(function(msg) {
                    console.log('error: ' + msg);
                });
        }
    }

    /**
     * The api as exposed via sidebar-api v. 0.1
     */
    var api = {
        plot: plot
    };

    // Register the adapter.
    my._adapter = endpoint.registerAdapter('plot-point-api', '0.1', api);

    my._facadeMgr = endpoint.manageFacades(
        ['sidebar-api', '0.1'],
        ['mapapi', '1.0'],
        ['mapapi-factory', '1.0']
    );

    my._facadeMgr.on('reconnect', function() {
        my._sidebar = my._facadeMgr.getApi('sidebar-api');
        my._mapapi = my._facadeMgr.getApi('mapapi');
        my._mapapiFactory = my._facadeMgr.getApi('mapapi-factory');
    });

    my._facadeMgr.on('ready', function() {
        my._sidebar.addTab('Plot Point').then(
            function(divId) {
                init(divId);
            }
        );
    });

})(window.endpoint);
