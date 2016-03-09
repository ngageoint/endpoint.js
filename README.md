# ![Endpoint.js](docs/images/endpoint-small.png) Endpoint.js [v0.4.0](CHANGELOG.md)

[![Build Status](https://travis-ci.org/ngageoint/endpoint.js.svg?branch=master)](https://travis-ci.org/ngageoint/endpoint.js)

**Endpoint.js** enables modules within a web application to discover and use each other, whether that be on the same
web page, other browser windows and tabs, iframes, servers, web workers and processes in a
[reactive way](https://en.wikipedia.org/wiki/Reactive_programming) by providing discovery, execution and streaming interfaces.

![Ad-hoc Network](docs/images/network.png) A robust ad-hoc application network, enabling multi-hop communication across any topology, including browser windows, tabs, web workers, web servers, processes, and peer-to-peer

![Increased Performance](docs/images/performance.png) Increased application performance, allowing easy off-loading and routing of complex processing to background workers, processes or browser tabs

![Save Time](docs/images/time.png) Develop Here, Deploy There: Develop to uniform APIs, reducing deployment and integration details to a configuration exercise

![Built-in Security](docs/images/security.png) Built-in security features enables fine-grained control over movement of data

## How do I use it (aka "Documentation")?

Take a look at our [Basic Usage](docs/basic.md), [Configuration Guide](docs/configuration.md),
[API at a Glance](docs/api.md), [Advanced Usage](docs/advanced.md), [Security Guide](docs/security.md),
read the suggested [integration](docs/integration.md) document, or check out the
[Architecture Diagram](docs/architecture.md).

## Build

You must have node.js, npm and grunt-cli installed before building Endpoint.js:

    npm install -g grunt-cli

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

## Contributing

All pull request contributions to this project will be released under the Apache 2.0 or compatible license.
Software source code previously released under an open source license and then modified by NGA staff is considered a
"joint work" (see 17 USC &sect; 101); it is partially copyrighted, partially public domain, and as a whole is protected by
the copyrights of the non-government authors and must be released according to the terms of the original open source
license.

## Getting Support

Our team is working to add a website and mailing list.  In the meantime, you can create an issue.

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

This documentation uses icons designed by Freepik.

## License

Licensed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0)
