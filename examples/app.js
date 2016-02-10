var express = require('express');
var webrtcServer = require('../js/plugins/webrtc/server');
var processPlugin = require('../js/plugins/process/index');
var spawn = require('child_process').spawn;
var path = require('path');
var app = express();

app.use(express.static(__dirname + '/public'));

var logLevel = 'info';

// The following will setup two external endpoints (8282 and 8283).  It will
// additionally setup an internal endpoint (8181) which the server hosted at 8283 will
// use to connect to the one at 8282.
var printDetails = function(server, name) {
    var host = server.address().address;
    var port = server.address().port;
    console.log('Endpoint.js Link (%s) listening at http://%s:%s', name, host, port);
}

var serverA_external = app.listen(8282, function () {
    printDetails(serverA_external, 'External - Host A');
});

var serverA_internal = app.listen(8281, '127.0.0.1', function () {
    printDetails(serverA_internal, 'Internal - Host A');
});

var serverB_external = app.listen(8283, function () {
    printDetails(serverB_external, 'External - Host B');
});

var serverC_external = app.listen(8284, function () {
    printDetails(serverC_external, 'External - Host C - Cross-Origin Example');
});

// Initialize the IMC Links

/**
 * Create IMC A
 */

var imcA = require('../js/app/server')(undefined, logLevel);

// Add the socket.io connection hub for the external server.
var ioA_ext = require('socket.io')(serverA_external);
imcA.getConfiguration().getLink('default-server').addSocket(ioA_ext, true);

// Add an internal link to imcA
var serverLinkConfig = {
    linkId: 'trusted-server',
    type: 'server',
    settings: {
        channel: 'endpointjs-trusted',
        external: false
    }
};
imcA.getConfiguration().addLink(serverLinkConfig);

// Add the socket.io connection hub for the internal server.
var ioA_int = require('socket.io')(serverA_internal);
imcA.getConfiguration().getLink('trusted-server').addSocket(ioA_int, true);

/**
 * Create IMC B
 */

var imcB = require('../js/app/server')(undefined, logLevel);

// Add the socket.io connection hub for the external server.
var ioB_ext = require('socket.io')(serverB_external);
imcB.getConfiguration().getLink('default-server').addSocket(ioB_ext, true);

// Add an internal link to imcB (use same config as server A)
var trustedLinkB = imcB.getConfiguration().addLink(serverLinkConfig);

// Tell imcB internal link to connect to imcA internal link.
var clientB = require('socket.io-client');
var clientInstanceB = clientB.connect('http://127.0.0.1:8281');
trustedLinkB.addSocket(clientInstanceB, false);

/**
 * Bridge the two links!
 */
imcA.getConfiguration().createBridge(['trusted-server', 'default-server']);
imcB.getConfiguration().createBridge(['trusted-server', 'default-server']);

// Setup WebRTC plugin
webrtcServer(imcA, {
    neighborhood: 'universal'
});

/**
 * The following will create a process link and add one for
 * this process.  It will then create a child process
 */
var processLink = processPlugin(imcA, 'default-process', logLevel);

// Add the process link to imcA
var proc = spawn('node', ['examples/child/child.js'], {
    stdio: [null, null, null, 'ipc']
});

// Show Child output on screen
proc.stdout.on('data', function(data) {
    console.log('[CHILD] %s', data);
});

// Add the child to our process list
processLink.addProcess(proc);

// Bridge the External server connection and the child process link, to allow communication
imcA.getConfiguration().createBridge(['default-server', 'default-process']);
