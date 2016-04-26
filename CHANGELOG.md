<a name="0.4.1"></a>
## `[0.4.1]`

### Bug Fixes

* ENDPOINT-8 Stream infinite loop issue
* ENDPOINT-9 Stream Pause/Pause-ack performance improvement

<a name="0.4.0"></a>
## `[0.4.0]` (02-04-2016)

### Features

* Deploy to Github
* Can now create child facades of returned objects and call functions on them remotely
* Can now take child facades and pass them as arguments to other facade functions
* Added Process Link plugin, allowing parent/child process communication in Node.js

### Bug Fixes

* Mistake in createMethodIndex allowed properties to be included as function names
* Fix transport cleanup to properly cleanup readers
* Modified to work with IE bug where localstorage is echoed back
* Fixed bug in Query where multiple search requests could be queued at the same time

### Improvements

* Links can now specify the 'heartbeatTimeout' setting to control how long before a link times out.
* Can set maxChildObjects for Client Instances (global setting)
* Added Selenium integration tests

<a name="0.3.0"></a>
## `[0.3.0]` (11-29-2015)

### Features

* Socket.io communication between client and server
* WebRTC support
* Configuration API
* [Stream Transformers](security.md)
* [Interface Bridging](security.md)
* [Limiting Discovery](security.md)

### Bug Fixes

* When strategies are canceled, the executing call is not closed
* The random-occurrence 'write after end' error
* Bug where routing table constructor is missing a parameter
* Fixed bug when transports close they aren't closing connections using that transport

### Improvements

* Security Enhancements
* Zone Routing Protocol, or ZRP, allowing internal and external communication and routing (for cross-domain)
* Reduction in minified size by 10kb using custom grunt-contrib-uglify plugin
* Documentation and Test-case updates
* Allow passing of API details to facade from query, without having to re-query
* Allow specification of log level in server version
* Moved to Express.js for demo application
* Can now get the 'output stream' if there is one in a strategy's then() call as the second and third arguments
* Added new 'registerObjectEvent' to manage events for endpoints on generic objects that fit the EventEmitter model

<a name="0.2.2"></a>
## `[0.2.2]` (09-18-2015)

### Features

* Asynchronous Adapter Methods
* Synchronous Inspection
* IE8 and Firefox 3.6 support
* Methods on EndpointManager to create generic endpoints
* Endpoint instance going down now breaks affinity with all endpoints to that instance

### Bug Fixes

* Resolver wasn't being sent instance id / endpoint(adapter) id
* Malformed streams weren't being ended in client-instance
* Added 'buffered()' instead of using 'stream(true)' to specify binary streams, so that output streams inherit this value
* 'then()' now takes a second argument for error callback function, due to IE8 not supporting 'catch' keyword
* Bug in protocol link which could lead to multiple connections emitted for the same worker
* Fix a bug in heartbeat stream where the timeout notification occurs multiple times
* Fix a regression where external hosts are not being reported in routing-table

### Improvements

* Additional unit tests
* jsDocs updates
* README.md updates
* Error type is now sent in API responses
* transformStream and transformDuplexStream functions no longer require 'buffered' parameter
* API calls must be registered methods in adapter (check added)
* Fix Router to immediately drop connections if next hop is the one who reported the dead connection
* Ignore results sent from adapter if there is no 'then()' to process the result
* Added banner to endpoint.min.js file with NGA Copyright