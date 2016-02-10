/**
 * This example will run in a new process. It will connect to Endpoint.js
 * being hosted by express server, and serve out API to Endpoint.js instances
 * living in the browser.
 */


var processPlugin = require('../../js/plugins/process/index');

var logLevel = 'info';

// Init Endpoint.js
var endpoint = require('../../js/app/server')(undefined, logLevel);

// Add the process link
var processLink = processPlugin(endpoint, 'default-process', logLevel);

// Keep Alive
setInterval(function(){}, Math.POSITIVE_INFINITY);

// Register an API
// This example API will reply with a basic response.
var api = {
    getMessageFromChild: function(input) {
        return 'got your input [' + input + ']';
    }
};

endpoint.registerAdapter('child-process-api', '1.0', api, { neighborhood: 'universal' });
