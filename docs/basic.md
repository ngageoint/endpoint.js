# Basic Endpoint.js

Endpoint.js's core purpose is to be a plugin framework with data streaming capabilities.  If you have a map, a
sidebar, and a timeline within your application, you can use it to wrap and version each component,
enabling access to your functionality through a published API. By encouraging developers and companies to
design each component of their application in a re-usable manner, it enables individuals and groups to
contribute to emergent capabilities built upon existing investment, allowing organizations to respond to change.

Using Endpoint.js is as simple as creating one or more adapters, and using a facade to access the API and call
functions.  More advanced scenarios are described [here](advanced.md).

## Table of Contents

 - [Creating an Adapter](#creating-an-adapter)
 - [Creating a Facade](#creating-a-facade)
 - [Facade Manager](#facade-manager)
 - [What can be an adapter?](#what-can-be-an-adapter)
 - [Writing an Adapter Function, Emitting Events](#writing-an-adapter-function-emitting-events)
 - [Querying for an Adapter Directly](#querying-for-an-adapter-directly)
 - [Stateless APIs](#stateless-apis)

## Creating an Adapter

An **Adapter** is one of the two main parts of the Endpoint.js API (along with Facade) and performs two roles:
* Expose functions of an object to be executed remotely
* Emit events to remote clients

To register a new adapter 'mapapi' version '1.0', use the following syntax:

```javascript
var adapter = window.endpoint.registerAdapter('mapapi', '1.0', mapapi);
```

Endpoint.js will determine all functions exposed in the 'mapapi' object and export those functions. You can also emit an event to all connected clients via the 'emit' function:

```javascript
adapter.getEvents().emit('event', 'arg1', 'arg2', ...);
```

## Creating a Facade

A **Facade** is one of the two main parts of the Endpoint.js API (along with Adapter) and connects to an Adapter. The connection state is maintained on the adapter side with a **Client-Instance**.

A Facade fulfills two roles:
* Execute functions on the adapter
* Receive events from the adapter

To create a facade, use the following syntax:

```javascript
var facade = window.endpoint.createFacade('mapapi', '1.0');
facade.on('ready', function() {
   var api = facade.getApi();
   var events = facade.getEvents();
   // Subscribe to events, e.g., events.on('...')
   // Call api functions, e.g., api.plotPoint(5, 6);
});
facade.on('closed', function() {
   console.log('facade was closed');
});
facade.on('timeout', function() {
   console.log('facade failed to find an adapter');
});
```

Facade will emit 'ready' when it connects to an adapter.  It will connect to the first adapter it finds, ignoring others.  It emits closed when either the close() method is invoked, or if the remote Adapter or Client-Instance is closed.  If it cannot find an adapter (within about 10 seconds) then it will emit timeout.

The getApi() function will return an object containing the methods from the remote adapter, while getEvents() can be used to receive events (NodeJS EventEmitter). After a function executes, .then() can be used (like a pseudo-promise) to get the result of the function or to execute some other code (as shown in the example).

## Facade Manager

Facades will not automatically reconnect when they are disconnected. You can use the facade manager to manage facade
connections.

```javascript
var facadeMgr = endpoint.manageFacades(
    ['sidebar-api', '0.1'],
    ['mapapi', '1.0'],
    ['mapapi-factory', '1.0']
);

facadeMgr.on('reconnect', function() {
    var sidebar = facadeMgr.getApi('sidebar-api');
    var mapapi = facadeMgr.getApi('mapapi');
    var mapapiEvents = facadeMgr.getEvents('mapapi');
    var mapapiFactory = facadeMgr.getApi('mapapi-factory');
});

facadeMgr.on('ready', function() {
    /* do stuff */
});
```

Facade Manager will not emit ready until every requested facade has connected.
If any facades disconnect, then it will reconnect and re-emit a 'reconnect' event.  The facade-manager will also emit 'reconnect' just before it emits 'ready' for the first time.
If you need processes to restart as a result of a reconnect, we recommend you placing these in reconnect instead of ready.

## What can be an adapter?

Any javascript object can be an adapter, even an object with no functions.  This is useful if you just want to set-up an affinity or point-to-point eventing service with clients.

You can wrap all types of objects and execute methods on them from anywhere within the Endpoint.js network:
* JavaScript Object
* DOM Elements
* AngularJS Service
* etc..

## Writing an Adapter Function, Emitting Events

The following is an example of an adapter function:

```javascript
var api = {
   plotPoint: function(x, y) {
        var point = /* code to plot point */
        return point;
    }
};
```

Any JavaScript function can be an adapter function.  Any JavaScript object can be returned to a Facade within the same Endpoint.js instance, while any JSON object can be returned to any Endpoint.js instance.

When a call executes, it is assigned a context.  To get the context, use the following code:

```javascript
var api = {
   plotPoint: function(x, y) {
      var context = adapter.getCurrentContext();
        var clientInstance = context.getClientInstance();
        /* code to plot point */
        clientInstance.getEvents().emit('point-plotted');
    }
};
```

The *adapter* variable is the one that is returned from registerAdapter().  The client instance can be used to store data relevant to the specific Facade connected, and it is maintained across API calls.

If you want to send an event to all Client-Instances connected, you can use adapter.emit(), whereas you can send an event to a specific Client-Instance by using the emit function on that specific instance:

```javascript
context.getClientInstance().getEvents().emit('event', 'arg1');
```

You can also store client instances for later use, in this pub-sub example:

```javascript
var api = {
   instances: {},
    subscribe: function() {
      var context = adapter.getCurrentContext();
        var clientInstance = context.getClientInstance();
      this.instances[clientInstance.getId()] = clientInstance;
        var _this = this;
        clientInstance.on('closed', function() {
         delete _this.instances[clientInstance.getId()];
        });
    },
    emitSubscribed: function(event) {
      for (var instance in this.instances) {
         this.instances[instance].getEvents().emit(event);
        }
    }
};
```

## Querying for an Adapter Directly

To query for an adapter directly, use the 'query' API:

```javascript
var query = window.endpoint.createQuery('mapapi', '1.0');
query.on('api', function() {
   console.log('found api');
});
query.on('closed', function() {
    console.log('query finished / timed out');
    var totalApis = query.getFoundApisCount();
    var apis = query.getFoundApis();
});
```

The query will execute forever, and periodically re-emit a request for the facade if it can't find it.
Multiple results may be returned via the 'api' event.  If you need an immediate response,
you can listen for this event. Once you receive an API response, you can create a Facade directly from that response:

```javascript
var query = window.endpoint.createQuery('mapapi', '1.0');
query.on('api', function(api) {
    var settings = {
        api: api
    };
    var facade = window.endpoint.createFacade('mapapi', '1.0', settings);
    facade.on('ready', function() {
        console.log('facade connected');
    });
});
```

If you want a facade query to timeout, you can specify the option 'tryForever', and then listen for the timeout
event:

```javascript
var settings = {
    tryForever: false
};

var query = window.endpoint.createQuery('mapapi', '1.0', settings);
query.on('timeout', function() {});

//or
var facade = window.endpoint.createFacade('mapapi', '1.0', settings);
facade.on('timeout', function() {});
```

## Stateless APIs

Endpoint.js also has stateless APIs if you do not wish to use the stateful APIs (adapter, facade). You can
directly access the bus, the messenger, and the streamer as follows:

```javascript
var manager = window.endpoint.getEndpointManager();
var bus = manager.getService('bus');
var messenger = manager.getService('messenger');
var streamer = manager.getService('streamer');
```

You can then add event handlers for each of them:

Bus:
```javascript
bus.on('adapter-request', function(address, source, arg1, arg2, ...) {
    // address is an object that provides access to the path vector (see address.js)
    // source is an integer representing where the message originated, either 0 for local, 1 for group, or 3
    //   for universal
    // arg1, 2, ... are the original arguments emitted on the bus
});
bus.emit('adapter-request', arg1, arg2, ...);
// There is also bus.emitDirect to send to a specific bridge or host id.
```

Adapter.js uses the bus to respond to adapter requests of the form 'adapter|name|version'.

Messenger:
```javascript
messenger.register('some-identifier', function(message, source) {
    // message is whatever the sent message was (any object)
    // source is an integer representing where the message originated, either 0 for local, 1 for group, or 3
    //   for universal
});
messenger.sendMessage(address, 'some-identifier', message);
// address is a path vector. see address.js for details
```

Adapter.js uses the messenger to respond to adapter requests.  In addition, all call traffic between a facade
and a client instance is done using the messenger.

Streamer:
```javascript
streamer.addHandler('my-id');
streamer.on('stream-my-id', function(stream, opts) {
    // access metadata via stream.meta
    // opts.objectMode says whether it is binary or not
});
streamer.createStream('my-id', address, metadata, opts);
```
