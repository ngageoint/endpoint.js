# Custom Configuration

By default, Endpoint.js will detect the environment it's being used in and configure itself accordingly, however
you can modify that process with the configuration API.

## Table of Contents

- [Configuration Parameters](#configuration-parameters)
  - [Adding Additional Links](#adding-additional-links)
  - [Custom Link Types](#custom-link-types)
  - [Host Affinity](#host-affinity)
- [Server Configuration](#server-configuration)
  - [Using Socket.io to listen for browser connections](#using-socket-io-to-listen-for-browser-connections)
  - [Hosting WebRTC Switchboard](#hosting-webrtc-switchboard)
  - [Child Processes](#child-processes)
- [Browser Configuration](#browser-configuration)
  - [Synchronizing Browser Windows](#synchronizing-browser-windows)
  - [Shared Workers vs. Local Storage](#shared-workers-vs-local-storage)
  - [Configuring Shared Worker](#configuring-shared-worker)
  - [Creating a child window and Registering with Endpoint.js](#creating-a-child-window-and-registering-with-endpoint-js)
  - [Creating a dedicated web worker and Registering with Endpoint.js](#creating-a-dedicated-web-worker-and-registering-with-endpoint-js)
  - [Using Socket.io to connect to a web server](#using-socket-io-to-connect-to-a-web-server)
  - [Using WebRTC to connect to another browser](#using-webrtc-to-connect-to-another-browser)
- [Bridging](#bridging)
- [Logging](#logging)

## Configuration Parameters

The following parameters affect the overall behavior of Endpoint.js:

- __maxHops__: The maximum size of a path vector from one host to another external host.  The default is 10, and should only be changed for very large networks.
- __maxHostAffinities__: External hosts will only be allowed to create host affinities with this many external hosts through a specific link. See the [Host Affinity](#host-affinity) section.  Default is 25.
- __maxAdapterInstances__: The maximum amount of instances of an adapter that can be used simultaneously.  The default is 1000.
- __links__: An array describing all links to add. (described below)
- __createSharedWorker__: Whether to attempt to create a shared worker. The default is true.
- __sharedWorkerUrl__: Load a custom shared worker instead of the default Endpoint.js instance. The default is the same URL Endpoint.js uses.
- __maxClientObjects__: How many child facades can be created for any client instance.

### Adding Additional Links

By default, the web, server and web worker versions of Endpoint.js will create relevant links:

- When in a **browser**, Endpoint.js will add the Window/Iframe Link (default-window) and the Worker Link (default-worker) by default.  If shared workers are supported, it will attempt to create one (to be used for communication purposes). If not, then it will add the 'tab' link (default-tab) and try to use local storage to communicate with neighbors.
- When on a **server**, Endpoint.js will add the Server Link (default-server) by default. However, it will not initialize Socket.io.  You have to do this and pass the socket to Endpoint.js as a hub.
- When in a **web worker**, Endpoint.js will add the Worker Link by default and automatically listen for connections.

You can, however, override this and specify your own links.  To do so, specify the 'links' parameter on the
Endpoint.js configuration options when creating the Endpoint.js instance.  Refer to the next few sections for how
to specify this value when bootstrapping.

```javascript
var endpointConfig = {
    links: [link1, link2]
};
```

When creating a link, several options and settings can be specified.  To create a link, use this syntax:

```javascript
var link = {
    linkId: 'id (any unique value)',
    type: 'type (tab, window, server, or worker, or <custom>)',
    settings: {
        // ... settings here are described below for each type of link
    }
};
```

The following setting is global to all links:

- transformFactory: a function that allows specification of stream transformers on every connected link.  See 'security' documentation for 'Stream Transformation' for more details.
- heartbeatTimeout: a interval in milliseconds.  A ping is sent at half of this interval, and if no response is received, the link dies after this interval.

#### Tab

- channel: The name of the local storage key used to communicate between windows.  Defaults to 'local-channel'

#### Window

- origin: The 'PostMessage' origin.  Incoming messages will be checked for this origin before being passed, and outgoing messages will be posted with this origin specified.  This setting has no default, and MUST be specified.
- external: Whether the link should be considered external or internal.  If doing cross-domain communicate, it is strongly recommended this be set to 'true' (default).

#### Worker

There are no settings for worker currently.

#### Server

- channel: The name of the socket.io key used to communicate messages.  Defaults to 'local-channel'
- external: Whether the link should be considered external or internal.  If doing client/server, it is strongly recommended this be set to 'true' (default).  Internal connections (in a trusted subsystem) can set this to 'false'.  However, it is recommended that these internal ports be protected behind a firewall.
- maxClients: The maximum amount of clients that can connect to this instance at a time.  This defaults to 250.  It is recommended that a load balanced approach be used to host clients with Endpoint.js.  If this is not possible, increase this value.

### Custom Link Types

Endpoint.js also allows you to specify your own link types.  To do so, implement the following Link interface
and register the link:

```javascript
var LinkInterface = {

    // Return the name of the link
    getType: function() {},

    // A unique identifier that will distinguish this link from others in this instance
    getId: function() {},

    // Used in prioritzation decisions when routing messages
    getCost: function() {},

    // Whether to trust routing information from instances connected via this link
    isExternal: function() {},

    // How long before a link times out (if no response to ping)
    getHeartbeatTimeout: function() {},

    // For transforming the link (must take an instance of LinkTransform)
    getTransformFactory: function() {},

    // Cleanup when the link is closed
    close: function() {}
};
```

Register Link with Endpoint.js:
```javascript

var config = endpoint.getConfiguration();
var linkType = 'custom-link';
var linkCreateFunction = function(instanceId, linkId, settings) {
    // instanceId is this endpoint.js instance id
    // linkId is the link is the linkId passed in the 'addLink' call
    // settings is the settings object passed in the 'addLink' call
    // return an object implementing LinkInterface, defined above
};
config.addCustomLinkType(linkType, linkCreateFunction);
```

Then, add your link type to the configuration:
```javascript
var link = endpoint.getConfiguration().addLink({
    type: 'custom-link',
    linkId: 'some-unique-id',
    settings: {
        someSetting: true
    }
});
```

Links must implement EventEmitter and emit certain events to the link directory to be discovered:

- Event: __connection__; Arguments: link (LinkInterface), vertexId (String), streams (Object)
 - link: An instance of the link object created in 'linkCreateFunction' above.
 - vertexId: An identifier for the connection represented in 'streams.read' and 'streams.write'.
 - streams.read: A NodeJS stream representing the read pipe for the connection.
 - streams.write: A NodeJS stream representing the write pipe for the connection.
- Event: __connection-close__; Arguments: link, vertexId
 - link: An instance of the link object created in 'linkCreateFunction' above.
 - vertexId: An identifier for the connection represented in 'streams.read' and 'streams.write'.

### Host Affinity

When a facade connects to a remote adapter (not located on the same endpoint instance), it needs feedback to know
when the remote adapter closes.  Likewise, the adapter needs to know when the facade closes. Normally, the facade
will send a 'close' protocol message to the adapter when it closes.  This will trigger the client instance to close.
However, when a host goes down unexpectedly, these connections will not be cleanly closed.

Host Affinity allows for reporting of broken links to local endpoints. When a facade connects to an adapter, it will
ask the affinity service to establish an affinity with the remote system.  The affinity service will then communicate
with the affinity services on every host in the routed path and ask for an affinity record to be created.

When the link layer on any of these hosts detects that an affected link has died due to heartbeat timeouts, it will
be reported to the host affinity service in the routing layer, which will then report the closure to local
endpoints, and then forward that message to any 'concerned' Endpoint.js instances, creating a 'chain reaction' until
all hosts along the original path are notified.

In order to prevent a malicious host from creating thousands of affinity records, every external host is allowed a
total of 25 total affinity records (configurable, see above).  When this amount is exceeded, facades will still be
able to connect to adapters, but this feedback will not occur.

Internal hosts are allowed to create as many affinity records between themselves as they like.  This capability is
only limited in external connections.

## Server Configuration

To set a custom configuration for Endpoint.js in the Server, specify the following parameters when using it:

```javascript
var endpoint = require('endpointjs')(config);
```

### Using Socket.io to listen for browser connections

If you wish to use socket.io to establish Browser/Server communication, you must:
1. Import socket.io npm module manually
2. Import/init server software manually (using express in the example below)
3. Create the socket
4. Pass the socket to the "Server" link

```javascript
var endpoint = require('endpointjs')();
var io = require('socket.io')(server);
endpoint.getConfiguration().getLink('default-server').addSocket(io, true);
```

The second argument in 'addSocket' specifies whether the socket should be monitored for 'connection' events.

### Hosting WebRTC Switchboard

WebRTC works by executing the following process:
1. Connect to a signal host and broadcast my existence
2. Discover other host via this signal host
3. Exchange IP addresses, discovered using STUN servers
4. Connect directly to each other using WebRTC API

In order to discover other hosts, Endpoint.js must host a switchboard.  To use it, execute the following code:

```javascript
var webrtcServer = require('endpointjs/js/plugins/webrtc/server');

// Settings used by webrtc-discovery-api adapter
var settings = {
   neighborhood: 'universal'
};

// Setup WebRTC plugin
webrtcServer(endpointInstance, settings);
```

This code will create an endpoint.js adapter that listens for signal requests from the client. An example of
a WebRTC switchboard is implemented in app.js in the examples/ folder. See the section
[Using WebRTC to connect to another browser](#using-webrtc-to-connect-to-another-browser) for information about
how to use WebRTC to connect to the switchboard.

### Child Processes

Because Endpoint.js is extensible, we took the liberty of creating a child process plugin and example.  The plugin is located
in js/plugins/process. Part of the example is in examples/app.js, and the other part is in examples/child.

The plugin allows you to attach a 'process' link type to any endpoint.js instance. After that, you can fork or spawn a
new process and have it communicate to its parent using Endpoint.js:

```javascript
var endpoint = require('endpointjs')();
var processLink = processPlugin(endpoint, 'default-process');
var proc = require('child_process').spawn('node', ['examples/child/child.js'], {
    stdio: [null, null, null, 'ipc']
});
processLink.addProcess(proc);
```

When using 'spawn', you must establish the 'ipc' channel by using the 'stdio' argument, as shown above. Fork should create it automatically. See the example or run the integration test to see it in action.

## Browser Configuration

To set a custom configuration for Endpoint.js in the browser, specify the following parameter on the window object before including Endpoint.js:

```javascript
window.endpointConfig = config;
```

Or, in a web worker:

```javascript
this.endpointConfig = config;
```

### Synchronizing Browser Windows

Endpoint.js does not provide out of the box leader election or consensus algorithms. Our suggested method to handle this
issue is to place all synchronization logic in a shared worker, and allow that instance to be authoritative on the browser side.
An example of this is provided in 'comm-worker.js' in the examples folder.

### Shared Workers vs. Local Storage

When using Endpoint.js, a very useful feature is the ability to relay information between different windows and
tabs using Shared Workers.  This is much more efficient than Local Storage.  However, Shared Workers have the
requirement that the script be loaded from the same domain as the main web page.  This means that you will
not be able to use shared workers if you load Endpoint.js off of a CDN or alternate host.

If you would like to use this capability, it's recommended you host Endpoint.js on the same server hosting
your web application. If this is not possible, Endpoint.js will revert to using LocalStorage communication which
will not perform as well when large amount of tabs/windows are being used.

### Configuring Shared Worker

By default, Endpoint.js will try to spawn a shared worker to communicate with other windows/tabs on the same origin.
This instance will not contain any functionality other than to act as a relay.  You can modify the specific URL
used for the shared worker as well as whether to create it at all by setting the following configuration:

```javascript
window.endpointConfig = {
    sharedWorkerUrl: 'comm-worker.js'
};
```

If you specify link configuration manually, then these settings will do nothing.  They only work when the
default link configuration is used for browser.

### Creating a child window and Registering with Endpoint.js

Child windows are opened with this command:

```javascript
var wnd = window.open('<url>', '<name>');
```

Child windows can communicate with the parent window via localstorage or shared worker, but this isn't the most efficient mechanism.  To enable bi-directional communiation, the parent Endpoint.js window can announce itself to the child window via the API:

```javascript
var config = window.endpoint.getConfiguration();
var windowLink = config.getLink('default-window');
windowLink.announceWindow(wnd);
```

You may want to delay the announceWindow() call for a few milliseconds until the window loads.
An iframe will immediately register, and you do not need to register it with the parent Endpoint.js instance.

### Creating a dedicated web worker and Registering with Endpoint.js

To create a worker and register it with Endpoint.js from a javascript file, create the file like so:

worker.js:
```javascript
importScripts('endpoint.min.js');
var adapter = this.endpoint.registerAdapter( ...<other arguments> );
```

The 'endpoint.min.js' code must be included at the beginning with the importScripts() command in order for Endpoint.js to be able to communicate with this worker.
Then, create the worker in your application:

```javascript
var worker = new Worker('worker.js');
var config = window.endpoint.getConfiguration();
var workerLink = config.getLink('default-worker');
workerLink.addWorker(worker);
```

A worker can also be defined inline as shown:

```html
<script type="text/js-worker" id="worker">
   importScripts('endpoint.min.js');
   var adapter = this.endpoint.registerAdapter( ...<other arguments> );
</script>
```

To create & add the worker to Endpoint.js, you can then use the following code:

```javascript
var workerText = document.getElementById('worker').textContent;
var blob = new Blob(workerText);
var blobURL = window.URL.createObjectURL(blob);
var worker = new Worker(blobURL);

var config = window.endpoint.getConfiguration();
var workerLink = config.getLink('default-worker');
workerLink.addWorker(worker);
```

Workers registered in this manner are checked periodically (every minute) to see if they are responsive.  It's
recommended that control be returned to Endpoint.js occasionally in order to ensure that connection isn't lost with
the main thread.

### Using Socket.io to connect to a web server

If you wish to use socket.io to establish Browser/Server communication, you must:
1. Import socket.io client manually
2. Create the socket
3. Add the "Server" link type to Endpoint.js
4. Pass the socket to the "Server" link

```javascript
var sock = io();
var link = window.endpoint.getConfiguration().addLink({
    type: 'server',
    settings: {
        channel: 'endpointjs-default'
    }
});
link.addSocket(sock);
```

After establishing a connection, if you wish to share the connection between other internal connections in your
group neighborhood, you must create a bridge.  Check the [security.md](security.md) documentation for more detail.

### Using WebRTC to connect to another browser

Endpoint.js uses [rtc.io](http://rtc.io/) to connect to other hosts via WebRTC. The Endpoint.js WebRTC plugin is
not bundled with Endpoint by default. When you build the plugins, the plugin will be located in the dist/ folder.
Please note, you will need to read the section [Hosting WebRTC Switchboard](#hosting-webrtc-switchboard).

An example of WebRTC is shown in the 'chat-webrtc' example in the examples/ folder.

To subscribe to a WebRTC signaller:

```javascript
// And listen for other people to join!
var rtc = window.endpointWebRTC({
    settings: {
        neighborhood: 'universal'
    }
});
```

The first argument to endpointWebRTC is an options object with the following parameters:

- __linkId__: Will only broadcast webrtc discovery api request to this link id if specified
- __room__: Overrides the 'room' argument in 'quickconnect' object if specified
- __quickconnect__: An object passed directly to the 'rtc-quickconnect' package
- __settings__: An object passed to the webrtc discovery facade that searched for the switchboard.

## Logging

Endpoint.js has an extensive logging capability.  By default, only warnings or errors will be shown.

However, you can override this by setting the following variable before Endpoint.js code is loaded:
```javascript
window.endpointLogLevel = 'trace';
```

Or on the server:
```javascript
var endpoint = require('endpointjs')({}, 'trace');
```
