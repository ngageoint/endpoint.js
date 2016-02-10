/**
 * This code is placed here so that we can ensure we get 'connection' events from the worker link.
 * Because of all the script includes, this code would not execute immediately if placed in demo.html.
 */

// Bridge the local and server connection.  If there is none, then this does nothing.
var config = window.endpoint.getConfiguration();

// This will send a message to my web workers asking for the 'leader-election' api.
var workerLink = config.getLink('default-worker');

function setupLeader() {
    workerLink.removeListener('connection', setupLeader);

    var internalBridge = config.createBridge(['default-worker']);
    var settings = {
        bridgeId: internalBridge.getId(),
        neighborhood: 'group'
    };
    var leaderFacade = window.endpoint.manageFacades(['server-delegate', '1.0', settings]);
    leaderFacade.on('ready', function() {
        // When the leader tells us to become the delegate for the server connection, then do so.
        leaderFacade.getEvents('server-delegate').on('leader', function() {

            var sock = io();
            var link = config.addLink({
                linkId: 'server-connection',
                type: 'server',
                settings: {
                    channel: 'endpointjs-default'
                }
            });
            link.addSocket(sock);

            config.createBridge(['server-connection', 'default-worker']);
        });
        leaderFacade.getApi('server-delegate').register();
    });
}

workerLink.on('connection', setupLeader);