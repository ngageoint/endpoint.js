
# Advanced Endpoint.js

Under the covers, Endpoint.js is built on [NodeJS Streams](https://nodejs.org/api/stream.html), [NodeJS Events](https://nodejs.org/api/events.html) &
[Browserify](http://browserify.org/).  Streams wrap communication technologies such as PostMessage, LocalStorage, and Web Sockets.
Three foundation utilities, the Bus, the Messenger & the Streamer allow publishing of events, direct messaging, and streaming, respectively.
An Endpoint is a composition of the Bus, Messenger and Streamer with a unique identifier.  All important Endpoint.js classes, such as Facade,
Adapter, and Client-Instance are Endpoints which use the foundation utilities to communicate with each other.

## Table of Contents

 - [Stateful vs Stateless Endpoints](#stateful-vs-stateless-endpoints)
 - [Storing Data in Client Instance](#storing-data-in-client-instance)
 - [Advanced Query: Controlling the Bus](#advanced-query-controlling-the-bus)
 - [Advanced Query: Resolver, Criteria and Metadata](#advanced-query-resolver-criteria-and-metadata)
 - [Child Facades](#child-facades)
 - [Passing Child Facades as Arguments](#passing-child-facades-as-arguments)
 - [Streams](#streams)
 - [Remote Routing: The Strategy](#remote-routing-the-strategy)
 - [Strategy: Synchronous Inspection](#strategy-synchronous-inspection)
 - [Asynchronous Adapter Methods](#asynchronous-adapter-methods)
 - [Versioning and Maintaining Older Interfaces](#versioning-and-maintaining-older-interfaces)
 - [Special Endpoint Methods](#special-endpoint-methods)

## Stateful vs Stateless Endpoints

Endpoint.js is built on three foundation classes, the bus, messenger and streamer.  These are the **stateless**
interfaces. You can use these directly from an existing adapter or facade, or create your own generic endpoint.
For more information, see [Special Endpoint Methods](#special-endpoint-methods).

Endpoint.js has a **stateful** API built in as well, the Facade, Adapter and Client Instance classes described
 in the basic usage section. While it is recommended to use the stateful API, you are free to build your
 endpoints however you wish.

## Storing Data in Client Instance

Because Endpoint.js connections are stateful, as described above, you can store data on the client instance. This is useful when multiple
calls are made to the client instance, or when the instance is closed.  You can then retrieve the client instance from the context, as described elsewhere in this documentation.  You can choose any random variable name that you want (that's not already used by Endpoint.js) and store data:

```javascript
var ctx = adapter.getCurrentContext();
var inst = ctx.getClientInstance();
inst.username = 'abc';
inst.credentials = 'xxx';

// ...

if (!inst.credentials) {
  throw new Error('user not authorized!');
}
```

While the client instance is global for the root facade and all child facades, you can store data specific to a single
facade by storing the data on object instance.

```javascript
var ctx = adapter.getCurrentContext();
var inst = ctx.getObjectInstance();
inst.facadeSpecificData = 'stuff';
```

## Advanced Query: Controlling the Bus

Endpoint.js has two methods for controlling the bus.

The first involves limiting the distribution of bus events.  There are four levels, local, group, global and
universal. Descriptions of each and how to use this functionality can be read about in the
[security.md](security.md#limiting-discovery) documentation. Adapters will by default listen and respond to
requests from all instances within the same 'group'.  Facades and Queries will by default request only 'local'
adapters.

The second method involves limiting which interfaces or hosts the bus uses to send out events.
Limiting by interface can be done by creating
a bridge.  Documentation on how to use this feature including examples can be found in the
[security.md](security.md#limiting-bus-events) documentation as well. By default, Endpoint.js will emit events
to all connected links, whether they be internal or external, unless a bridge id is explicitly specified when
creating a Facade or Query.

The following arguments are available as settings in Facade and Query:

```javascript
var settings = {
    hostId: <host>,
    bridgeId: <bridge>,
    neighborhood: (local|group|global|universal)
};
```

The hostId is a specific endpoint.js instance id (endpoint.getInstanceId()) and the bridge Id is the id of a specific
bridge (bridge.getId()).

## Advanced Query: Resolver, Criteria and Metadata

Endpoint.js supports a capability to define the query criteria for adapters. When registering a new adapter, you can specify two additional arguments, 'metadata' and 'resolver':

```javascript
var metadata = {
   tags: ['blue', 'green']
};

var resolver = {
   resolve: function(criteria, metadata, address) {
      // Address is the path vector that was used to reach this adapter.
      // Criteria is the value sent from the Query or Facade.
      // Metadata is the adapter's own metadata that was specified on registration
      for (var i = 0; i < criteria.tags.length; i++) {
         if (metadata.tags.indexOf(tag) !== -1) {
               return true;
            }
      }
        return false;
    }
};

var settings = {
  metadata: metadata,
  resolver: resolver
};

var adapter = window.endpoint.registerAdapter('mapapi', '1.0', mapapi, settings);
```

The metadata value is any generic javascript object, and the resolver value is any object with a function called 'resolve' which returns true if the query criteria matches the adapter metadata, or false if not.  Endpoint.js will not respond to adapter requests from facades if false is returned.  The default resolver in Endpoint.js supports 'instanceId' and 'id' for specifying a specific Endpoint.js instance.  These values can be retrieved as follows:

```javascript
var instanceId = window.endpoint.getInstanceId();
var id = adapter.getId();
```

To use criteria with a facade or query:

```javascript
var criteria = {
   tags: ['blue']
};

var settings = {
  criteria: criteria
};

var query = window.endpoint.createQuery('mapapi', '1.0', settings);

// or

var facade = window.endpoint.createFacade('mapapi', '1.0', settings);
```

## Child Facades

The basic usage only allows you to call functions on an object assigned to an adapter.  What if you want to call functions
on a returned object?  By default, Endpoint.js will only serialize the object and send it back.  In order to call functions on the remote object, you can tell Endpoint that the returned object should be wrapped in a child facade by using the 'facade()' syntax:

```javascript
var api = facade.getApi();
api.getComplexObject()
  .facade()
  .then(function(complexObj) {
    var complexApi = complexObj.getApi();
    complexApi.callFunc().then(...);
  });
```

This will allow you to immediately call the API functions on complexObj.  You can close the facade like you would any other, using the close command:

```javascript
complexObj.close();
```

Child facades are tied to the lifecycle of their parent.  If you close the parent, all the children will immediately be closed. Be sure to close your un-used facades!  If you do not, then you will have a memory leak.  To prevent this, the maximum objects that can be stored for one client instance is 100, and can be configured with maxClientObjects.

Child facades are full facades, meaning you can use streaming functions and call functions.  However, all facades within the same hierarchy share the same events object (which you can get by calling facade.getEvents() on any facade).

See the Child Facade example in the /examples folder.

**REMEMBER**: Make sure to clean up your facades, even when you catch an exception.  If you forget to close them, they will stick around!

## Passing Child Facades as Arguments

In addition to using child facades, you can pass them as arguments to other facade methods.  When executing against the adapter, the object passed as argument to the adapter function will be replaced with the real object, as if it had actually been passed.

To pass a parent facade to a child function, for example:

```javascript
var parentApi = parentFacade.getApi();
parentApi.getChild()
  .facade()
  .then(function(childFacade) {
    var childApi = childFacade.getApi();
    childApi.callFunc(parentApi).then(...);
  });
```

Similarly, you can pass the child to a parent function, or whatever you wish.  You can pass either the facade or the API, it does not matter.  You could replace 'parentApi' in the argument list above with 'parentFacade'.  You can only pass facade objects that belong to the same ownership hierarchy, so you can not share facades or child facades with another separate facade.

See the Child Facade example in the /examples folder.

## Streams

The core of Endpoint.js is built on [NodeJS Streams](https://nodejs.org/api/stream.html). At the same time, they can be used as part of the API to send object or buffer based data to remote endpoints. To use a stream:

```javascript
var api = facade.getApi();
var stream = api.plotPoint().stream();
stream.write({
   x: 5,
    y: 6
});
```

You can apply stream() to any facade function.  Streams are by default object streams, but you can send binary or
buffered data as well, by using the 'buffered()' function:

```javascript
var api = facade.getApi();
var stream = api.plotPoint().buffered().stream();
stream.write('buffered data!');
```

To access the stream within an adapter, use the context:

```javascript
var api = {
   plotPoint: function(x, y) {
      var context = adapter.getCurrentContext();
      if (context.hasInputStream()) {
         var stream = context.getInputStream();
            stream.on('readable', function() {
               var point;
                while ((point = stream.read()) !== null) {
                  /* code to plot point */
                }
            });
        }
        else {
         /* code to plot point */
        }
    }
};
var adapter = window.endpoint.registerAdapter('mapapi', '1.0', api);
```

Streams stay alive after the facade function ends, until they are explicitly ended, or 
the facade is closed:

```javascript
stream.end();
```

If you want to obtain the output stream from a called function, you can use the second and third arguments of
the 'then()' function to do so:

```javascript
var api = facade.getApi();
var stream = api.plotPoint()
    .then(function(result, outputStream) {
        // you can read from outputStream here.
    });
```

If specified, the third argument is the 'reverse' stream, allowing you to write backwards to the duplex connection.

Streams in Endpoint.js are also fully duplex, meaning you can read and write to them.  There are hundreds of pre-existing NPM modules that use and exploit the potential of streams.  Several examples:
* [Scuttlebutt](https://github.com/dominictarr/scuttlebutt) - Gossip protocol using streams
* [Highland.js](http://highlandjs.org/) - Functional Reactive Programming using streams
* [through2](https://github.com/rvagg/through2) - A library for easily transforming streams

For more advanced and useful documentation about streams, see the [Streams Handbook](https://github.com/substack/stream-handbook) on github.

## Remote Routing: The Strategy

Data can be routed from remote instances of Endpoint.js to another remote instance of Endpoint.js without ever touching the local instance. With traditional service based architecture, a call is made to a REST service.  The data is then returned to the client, and any further modifications of the data must be done there. With Endpoint.js, you can execute a remote function and stream the data to another remote function for processing before sending it back to the client.

This is done with the Strategy, a mechanism for defining a streaming data route within Endpoint.js.  Every time you execute a call on a Facade, you are executing a strategy.  The simplest strategy is an RPC call:

```javascript
var strategy = facade.getApi().plotPoint(5, 6);
strategy.then(function(returnValue) {
   console.log('point was plotted with return value: ' + returnValue);
});
```

Strategies are similar to promises in that they will asynchronously call the .then() function when the API function finishes.
Likewise, they can also be used to catch errors:

```javascript
var strategy = facade.getApi().plotPoint(5, 6);
strategy.catch(function(message) {
   console.log('could not plot the point, error = ' + message);
});
```

If you are developing your application for IE8, 'catch' is a reserved word.  In this case, you can specify the catch function
as the second argument to .then():

```javascript
var strategy = facade.getApi().plotPoint(5, 6);
strategy.then(
    function(returnValue) {
        // success
    },
    function(errorMessage) {
        // error
    }
);
```

In the previous section, we discussed how streams can be used to stream data to a remote function. Likewise, we can also use streams to receive data from a remote function:

```javascript
var api = facade.getApi();
api.getPointStream()
   .pipe(function(chunk, encoding, done) {
      console.log('point was plotted, x = ' + chunk.x +
         ' y = ' + point.y);
        done();
    });
```

Here, we are using NodeJS Streams to pipe the data from the external API function to a local callback function.  This is the same as a '[_transform](https://nodejs.org/api/stream.html#stream_transform_transform_chunk_encoding_callback)' function used in NodeJS streams.  The first argument to pipe() will transform the forward flowing data, while if a second argument is specified, it will transform the reverse flowing data on the duplex stream.

Likewise, you can specify a stream instead:
```javascript
var stream = through2.obj(function(chunk, encoding, done) {
      console.log('point was plotted, x = ' + chunk.x +
         ' y = ' + point.y);
        done();
    });

var api = facade.getApi();
api.getPointStream()
   .pipe(stream);
```

In this case, the first argument represents data streamed in the forward direction, while the second specifies data streamed in the reverse direction.

On the Adapter side, you can access and write to the output stream:

```javascript
var api = {
   getPointStream: function() {
      var context = adapter.getCurrentContext();
      if (context.hasOutputStream()) {
         var stream = context.getOutputStream();
         stream.write({
               x: 5, y: 6
            });
            stream.end();
        }
        else {
         throw new Error('Must provide output stream');
        }
    }
};
```

The stream will stay open until ended.  The stream could be cached in an instance variable and written to occasionally.

Perhaps the most interesting thing you can do is pipe to another Facade function.  This is called Remote Routing.
Consider these two adapters:

```javascript
var mapapi = {
   getPoint: function(x, y) {
      var stream = getOutputStream().write({
         x: x,
            y: y
        });
    }
};

var transformapi = {
   convertToXml: function(type) {
      var context = adapter.getCurrentContext();
      switch (type) {
        case 'point':

         var input = context.getInputStream();
            var output = context.getOutputStream();

         input.on('readable', function() {
               var point;
                while ((point = input.read()) !== null) {
                  output.write('<point><x>' + point.x
                     + '</x><y>' + point.y + '</y>');
                }
            });

         break;
        }
    }
};
```

The client could look like this:

```javascript
var mapApiFacade = window.endpoint.createFacade(...);
var transformApiFacade = window.endpoint.createFacade(...);
// Be sure to check they are 'ready' before using!

mapApiFacade.getApi().getPoint(5, 6)
   .pipe(transformApiFacade.getApi().convertToXml, 'point')
   // .pipe(transformApiFacade.getApi().convertToXml('point')) ALSO WORKS!
   .pipe(function(chunk, encoding, done) {
      console.log('output xml: ' + chunk);
        done();
    });
```

We first call getPoint() on the mapapi adapter to convert our coordinates into a JavaScript object.  We then send that data to a transform api function to convert it to XML.  We specify to the transform api that the data is specifically a 'point'.  Then, we output the XML. The 'context' variable has some additional functions to make transforming data in an adapter function more 'sane'.  See 'transformDuplexStream' and 'transformStream' in the jsdocs.

You can pipe data to any number of streams, functions, or facade calls within a Strategy.

## Strategy: Synchronous Inspection

Because Endpoint.js is a communication framework, all operations are executed asynchronously from the facade.
This can lead to programming headaches trying to understand or maintain a complex set of operations that
need to be executed serially.

For instance, the following code will add a vector layer, create a coordinate, and add a point to a map:

```javascript
mapapi.addVectorLayer('new_layer_id')
    .then(function() {
        mapapiFactory.coordinate(x, y)
            .then(function(coord) {
                mapapi.addPoint('new_feature_id', 'new_layer_id', coord);
            });
    });
```

Not only is this code hard to follow, it's unmaintainable because if you wanted to add or remove a call, you'd have
to track down the trailing brace and ensuring the hierarchy is correct.  Endpoint.js provides synchronous inspection,
a common method used in promise frameworks to keep code maintainable:

```javascript
mapapi.addVectorLayer('new_layer_id')
    .then(function() {
        return mapapiFactory.coordinate(x, y);
    })
    .then(function(coord) {
        mapapi.addPoint('new_feature_id', 'new_layer_id', coord);
    });
```

In this example, you can return a strategy from a 'then' method, and each of the methods after that 'then' method
will be appended onto that strategy.

## Asynchronous Adapter Methods

If your adapter method must execute code asynchronously, you can do so by setting asynch mode while the method is
executing:

```javascript
context.setAsyncMode();
```

Then, when the call completes, you can set the asynchronous result

```javascript
var result = 'result';
context.setAsyncResult(result);
```

Otherwise, if there is an error, you can pass an Error object to the error method as well:

```javascript
var error = new Error('something went wrong');
context.setAsyncError(error);
```

## Versioning and Maintaining Older Interfaces

Eventually you'll need to increment the version number for your adapter.  Endpoint.js recommends that each time you create a new interface version, you allow the existing version to remain as a bridge to the new version.  Then, you publish both as adapters with separate versions.

For example, I release the 'mapapi' adapter with the following interface:

```javascript
var mapapi_v1 = {
  plotCircle: function(x, y, radius) {
    /* code to plot a circle */
  }
};
var adapter_v1 = window.endpoint.registerAdapter('mapapi', '1.0', mapapi_v1);
```

For version 2.0, I'd like to change the plotCircle function to plotFeature, and pass a type. I expose my new API, and then update my old API to call my new API:

```javascript
var mapapi_v2 = {
  plotFeature: function(type, x, y, metadata) {
    /* code to plot a circle if 'type' == 'circle' */
  }
};
var adapter_v2 = window.endpoint.registerAdapter('mapapi', '2.0', mapapi_v2);

var mapapi_v1_interface = {
  plotCircle: function(x, y, radius) {
    mapapi_v2.plotFeature('circle', x, y, { radius: radius });
  }
};
var adapter_v1 = window.endpoint.registerAdapter('mapapi', '1.0', mapapi_v1);
```

Then, for every new release, you just have to create a daisy chain for the most recent version to your API.  Eventually you will deprecate v1, etc.  For dealing with streams, you can use the context 'transformDuplexStream', and 'setInputStream' / 'setOutputStream' functions to override and transform the stream that's seen by your latest instance.

## Special Endpoint Methods

Endpoints such as facade or adapter provide additional functions to allow you to manage and cleanup resources when
closed.

If you want to create a generic endpoint, you can do so via the endpoint manager:

```javascript
var ep = window.endpoint.getEndpointManager().createEndpoint('my-id', 'my-type', 'my-identification');
//ep.registerBusEvent(...);
ep.close();
```

If you want to tie an event listener to a facade, adapter, or client instance's lifespan, you can use registerObjectEvent:

```javascript
adapter.registerObjectEvent(someObject, 'someEvent', function() {
    // some callback
});
```

The listener will automatically be removed when the facade closes.

Likewise, you can retrieve all internal services from the Endpoint Manager:

```javascript
var endpointManager = window.endpoint.getEndpointManager();
var router = endpointManager.getService('router');
//or
var bus = endpointManager.getService('bus');
```

See loader.js for a list of all the services available.
