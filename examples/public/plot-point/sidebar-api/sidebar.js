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

    function init() {
        var thisdoc = document._currentScript.ownerDocument;

        // Create the panel
        my._panelId = uuid();
        var panel = thisdoc.createElement("div");
        panel.setAttribute('id', my._panelId);

        my._containerId = uuid();
        my._container = thisdoc.createElement("div");
        my._container.setAttribute('id', my._containerId);
        panel.appendChild(my._container);

        // Load the tabs template up
        var elem = thisdoc.getElementById('sidebar-template');
        var template = $(elem).html();
        $(my._container).html(template);

        // Add the sidebar to the page
        document.body.appendChild(panel);

        // Create the tabs using jquery ui
        my._tabs = document.getElementById('sidebar-api-tabs');
        my._tabsList = document.getElementById('sidebar-api-tabs-ul');
        $(my._tabs).tabs();

        // This contains the div objects, as well as name, etc.
        my._tabsOrdered = [];

        $(panel).BootSideMenu({side:"right", autoClose:false});

    }

    function render() {
        // Re-render the tabs
        var counter = 1;
        $('#sidebar-api-tabs > div').remove();
        $('#sidebar-api-tabs-ul > li').remove();

        for (var i = 0; i < my._tabsOrdered.length; i++) {
            var tab = my._tabsOrdered[i];

            var elem = document.createElement('div');
            elem.setAttribute('id', 'sidebar-api-tabs-' + counter);
            elem.appendChild(tab.div);
            $('#sidebar-api-tabs').append(elem);

            var elem2 = document.createElement('li');
            elem2.innerHTML = "<a id='sidebar-api-tabs-ul-" + counter + "' href='#sidebar-api-tabs-" + counter + "'>" + tab.name + "</a>";
            $('#sidebar-api-tabs-ul').append(elem2);

            counter += 1;
        }

        $('#sidebar-api-tabs').tabs().tabs('refresh');
    }

    function collapse() {

    }

    function expand() {

    }

    function getTabs() {
        return this._tabsOrdered;
    }

    function addTab(name) {
        var id = uuid();
        // Create the div
        var newDiv = document.createElement('div');
        newDiv.setAttribute('id', id);
        // Add the div to the
        my._tabsOrdered.push({
            id: id,
            name: name,
            div: newDiv
        });
        render();
        return id;
    }

    function focusTab(counter) {
        $('#sidebar-api-tabs-ul-' + counter).click();
    }

    /**
     * The api as exposed via sidebar-api v. 0.1
     */
    var api = {
        collapse: collapse,
        expand: expand,
        getTabs: getTabs,
        addTab: addTab,
        focusTab: focusTab
    };

    init();

    // Register the adapter.
    my._adapter = endpoint.registerAdapter('sidebar-api', '0.1', api);

})(window.endpoint);
