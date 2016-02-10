
# ![Endpoint.js](docs/images/endpoint-small.png) Endpoint.js [v0.4.0](CHANGELOG.md)

**Endpoint.js** enables modules within a web application to discover and use each other, whether that be on the same
web page, other browser windows and tabs, iframes, servers and web workers in a
[reactive way](https://en.wikipedia.org/wiki/Reactive_programming) by providing robust discovery, execution and streaming interfaces.

 - [What does it do?](#what-does-it-do)
 - [How does it work?](#how-does-it-work)
 - [How do I use it?](#how-do-i-use-it)
 - [Examples](#examples)
 - [Build](#build)
 - [Contributing](#contributing)
 - [Getting Support](#getting-support)
 - [Compatibility](#compatibility)
 - [Copyright and Legal](#copyright-and-legal)
 - [License](#license)

## What does it do?

Endpoint.js's core purpose is to be a plugin framework with data streaming capabilities.  If you have a map, a
sidebar, and a timeline within your application, you can use it to wrap and version each component,
enabling access to your functionality through a published API. By encouraging developers and companies to
design each component of their application in a re-usable manner, it enables individuals and groups to
contribute to emergent capabilities built upon existing investment, allowing organizations to respond to change.

Here are the core capabilities:

* **RPC and Events**: Communication between components within the same page, windows, frames, web workers, servers and processes
* **Data Orchestration**: Define data flows declaratively, routing data between remote endpoints before returning it to the client
* **Reactive**: Programming via streaming based on [NodeJS Streams](https://nodejs.org/api/stream.html)
* **Discovery**: Resolver API allows user-defined querying & resolution
* **Isomorphic**: Can execute on the browser or the server with the same code baseline
* **Extensible**: Add your own link types, handlers and stream transformers

## How does it work?

Under the covers, Endpoint.js is built on [NodeJS Streams](https://nodejs.org/api/stream.html), [NodeJS Events](https://nodejs.org/api/events.html) &
[Browserify](http://browserify.org/).  Streams wrap communication technologies such as PostMessage, LocalStorage, and Web Sockets.
Three foundation utilities, the Bus, the Messenger & the Streamer allow publishing of events, direct messaging, and streaming, respectively.
An Endpoint is a composition of the Bus, Messenger and Streamer with a unique identifier.  All important Endpoint.js classes, such as Facade,
Adapter, and Client-Instance are Endpoints which use the foundation utilities to communicate with each other.

## How do I use it?

Take a look at our [Basic Usage](docs/basic.md), [Configuration Guide](docs/configuration.md),
[API at a Glance](docs/api.md), [Advanced Usage](docs/advanced.md), [Security Guide](docs/security.md),
read the suggested [integration](docs/integration.md) document, or check out the
[Architecture Diagram](docs/architecture.md).

## Examples

To run the demos, use the following on the command line:

```bash
npm install
grunt demo
```

Open up a browser to one of the following examples:

- [General Demo (Contains Sidebar, Map, and a simple 'Plot point' widget)](http://127.0.0.1:8282/plot-point/plot-point.html)
- [API Example, including Stream](http://127.0.0.1:8282/general-api/general-api.html)
- Distributed Chat Example [port 8282](http://127.0.0.1:8282/chat-server/chat-server.html) and [port 8283](http://127.0.0.1:8283/chat-server/chat-server.html)
- [WebRTC Example](http://127.0.0.1:8282/chat-webrtc/chat-webrtc.html)
- [Worker Pool Example](http://127.0.0.1:8282/worker-pool/worker-pool.html)
- Cross Origin ([Plugin 1](http://localhost:8282/cross-origin/plugin1.html) at port 8282) and ([Plugin 2](http://localhost:8283/cross-origin/plugin2.html) at port 8283)
- [Child Facade Example](http://127.0.0.1:8282/sub-facade/sub-facade.html)
- [Authorization Example](http://127.0.0.1:8282/auth/auth.html) using child facades
- [Node.js Child Process Example](http://127.0.0.1:8282/child-process/child-process.html)

Additionally, an example of Endpoint.js being run on the express server is provided in examples/app.js.

## Build

To build Endpoint.js, use the following:

    npm install
    grunt production

The output files will be placed in dist/ folder.  To build plugins, use the following command:

    grunt plugins

To build the documentation, use the following command.  The files will be placed in dist/jsdoc/ folder. In
addition, a markdown file of all the markdown documentation will be placed in dist/endpoint-docs.pdf.

    grunt docs

To run unit tests (with chrome only for now), use the following command. Coverage reports are in reports/coverage:

    grunt test

To run integration tests (with chrome only for now), use the following commands. Logs are in reports/wdio:

    grunt integration-setup
    grunt integration

## Contributing

All pull request contributions to this project will be released under the Apache 2.0 or compatible license.
Software source code previously released under an open source license and then modified by NGA staff is considered a
"joint work" (see 17 USC &sect; 101); it is partially copyrighted, partially public domain, and as a whole is protected by
the copyrights of the non-government authors and must be released according to the terms of the original open source
license.

## Getting Support

Our team is working to add a website and mailing list.  In the meantime, you can contact the primary author at
datasedai@gmail.com or create an issue.

## Compatibility

Endpoint.js is verified compatible with IE8+ and Firefox 3.6+.  Chrome in general is supported.

If you want to use console on IE8, you must include the following ES5 shims:

    https://cdnjs.cloudflare.com/ajax/libs/es5-shim/4.1.13/es5-shim.min.js
    https://cdnjs.cloudflare.com/ajax/libs/es5-shim/4.1.13/es5-sham.min.js

You must also include the following on IE8 and certain versions of Firefox:

    https://cdnjs.cloudflare.com/ajax/libs/json2/20150503/json2.min.js

## Copyright and Legal

(C) 2016 Booz Allen Hamilton, All rights reserved

Powered by InnoVision, created by the GIAT

Endpoint.js was developed at the National Geospatial-Intelligence Agency (NGA) in collaboration with [Booz Allen Hamilton](http://www.boozallen.com). The government has "unlimited rights" and is releasing this software to increase the impact of government investments by providing developers with the opportunity to take things in new directions.

## License

Licensed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0)
