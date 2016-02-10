# API

This page contains a very high level view of all methods used in the application, up to date as of version 0.4.0.
This will most likely NOT be updated between minor releases, and is meant as an 'at a glance' view, to allow
developers to understand the scope of the user facing API.  To get the latest API methods, see the JSDocs.

## Table of Contents

 - [High Level API](#high-level-api)
 - [Configuration APIs](#configuration-apis)
 - [Stateless APIs](#stateless-apis)
 - [Stateful APIs](#stateful-apis)
    - [Adapter APIs](#adapter-apis)
    - [Facade APIs](#facade-apis)
 - [Link APIs](#link-apis)

## High Level API

Main API, Retrieved with 'window.endpoint':
```javascript
api.getInstanceId()
api.getEndpointManager()
api.getConfiguration()
api.createQuery(name, version, settings)
api.createFacade(name, version, settings)
api.manageFacades([[name1, version1, settings1], ...])
api.registerAdapter(name, version, object, settings)
```

Endpoint Manager, Retrieved with 'api.getEndpointManager()':
```javascript
endpointManager.getInstanceId()
endpointManager.getConfiguration()
endpointManager.getService(serviceName)
endpointManager.createEndpoint(id, type, identification)
endpointManager.closeAll()
```

Facade Manager, Retrieved with 'api.manageFacades()':
```javascript
facadeManager.getFacade(name)
facadeManager.getApi(name)
facadeManager.getEvents(name)
facadeManager.close()
```

## Configuration APIs

Configuration, Retrieved with 'api.getConfiguration()':
```javascript
configuration.addLinks(linksJson)
configuration.get(optionName)
configuration.addCustomLinkType(linkType, linkFunction)
configuration.addLink(linkConfig)
configuration.getLink(linkId)
configuration.removeLink(linkId)
configuration.createBridge(links, selfRelay)
```

Link Bridge, Retrived with 'configuration.createBridge()':
```javascript
linkBridge.getId()
linkBridge.hasLinkId(linkId)
linkBridge.addLinkId(linkId)
linkBridge.removeLinkId(linkId)
linkBridge.close()
```

## Stateless APIs

Bus, Retrieved with 'endpointManager.getService('bus')':
```javascript
bus.emitDirect(destinationBridgeId, destinationHostId, neighborhood, eventName, args ...)
bus.emit(neighborhood, eventName, args ...)
```

Messenger, Retrieved with 'endpointManager.getService('messenger')':
```javascript
messenger.register(id, callback)
messenger.unRegister(id)
messenger.sendMessage(address, remoteId, message)
```

Streamer, Retrieved with 'endpointManager.getService('streamer')':
```javascript
streamer.createStream(type, remoteAddress, meta, opts)
streamer.getStreamInfo(streamId)
streamer.addHandler(name)
streamer.removeHandler(name)
streamer.hasHandler(name)
```

## Stateful APIs

### Adapter APIs

Adapter, Retrieved with 'api.registerAdapter()':
```javascript
adapter.getName()
adapter.getVersion()
adapter.getObject()
adapter.getEvents()
adapter.getMetadata()
adapter.setMetadata(metadata)
adapter.getCurrentContext()
adapter.getId()
adapter.close()
adapter.registerBusEvent(event, callback)
adapter.registerObjectEvent(object, event, callback)
adapter.registerMessenger(id, callback)
adapter.registerStreamer(id, callback)
adapter.attachEndpoint(endpoint)
```

Client Instance, Retrieved with 'context.getClientInstance()':
```javascript
clientInstance.getAdapter()
clientInstance.getRemoteAddress()
clientInstance.getRemoteId()
clientInstance.getEvents()
clientInstance.getId()
clientInstance.close()
clientInstance.attachEndpoint(endpoint)
clientInstance.registerBusEvent(event, callback)
clientInstance.registerObjectEvent(object, event, callback)
clientInstance.registerMessenger(id, callback)
clientInstance.registerStreamer(id, callback)
```

Call Context, Retrieved with 'adapter.getCurrentContext()':
```javascript
context.getClientInstance()
context.getObjectInstance()
context.isBuffered()
context.setAsyncMode()
context.isAsync()
context.setAsyncResult(result)
context.setAsyncError(exception)
context.hasInputStream()
context.hasOutputStream()
context.getInputStream()
context.getOutputStream()
context.transformDuplexStream(forwardTransformFunc, reverseTransformFunc)
context.transformStream(transformFunc)
```

### Facade APIs

Client, Retrieved with 'facade.getClient()':
```javascript
client.getName()
client.getVersion()
client.getRemoteAddress()
client.getRemoteId()
client.getNeighborhood()
client.getEvents()
client.getId()
client.close()
client.attachEndpoint(endpoint)
client.registerBusEvent(event, callback)
client.registerObjectEvent(object, event, callback)
client.registerMessenger(id, callback)
client.registerStreamer(id, callback)
```

Facade, Retrieved with 'api.createFacade() or facadeManager.getFacade()':
```javascript
facade.getName()
facade.getVersion()
facade.getClient()
facade.getEvents()
facade.getRemoteAddress()
facade.getRemoteId()
facade.isReady()
facade.getApi()
facade.getId()
facade.close()
facade.attachEndpoint(endpoint)
facade.registerBusEvent(event, callback)
facade.registerObjectEvent(object, event, callback)
facade.registerMessenger(id, callback)
facade.registerStreamer(id, callback)
```

Query, Retrieved with 'api.createQuery()':
```javascript
query.getFoundApis()
query.getFoundApisCount()
query.close()
query.attachEndpoint(endpoint)
query.registerBusEvent(event, callback)
query.registerObjectEvent(object, event, callback)
query.registerMessenger(id, callback)
query.registerStreamer(id, callback)
```

Strategy, Retrieved with 'facade.getApi().&lt;any function call&gt;() or facadeManager.getApi(name).&lt;any function call&gt;()':
```javascript
strategy.pipe(/* stream or strategy or function */, /* [reverse stream or function, if specified] */)
strategy.then(thenFunc)
strategy.catch(catchFunc)
strategy.stream()
strategy.facade()
strategy.buffered()
strategy.execute()
strategy.cancel()
```

## Link APIs

Server Link, Retrieved with 'configuration.getLink('default-server')':
```javascript
serverLink.addSocket(worker)
serverLink.close()
```

Tab Link, Retrieved with 'configuration.getLink('default-tab')':
```javascript
tabLink.close()
```

Window Link, Retrieved with 'configuration.getLink('default-window')':
```javascript
windowLink.announceWindow(obj)
windowLink.close()
```

Web Worker Link, Retrieved with 'configuration.getLink('default-worker')':
```javascript
workerLink.addWorker(worker)
workerLink.addHub(workerGlobalScope)
workerLink.close()
```
