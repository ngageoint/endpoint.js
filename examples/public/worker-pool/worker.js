/**
 * This worker will register itself with worker manager and
 * report its ID.  The parent will then connect directly to this worker
 * and execute work.
 */

this.endpointLogLevel = 'debug';
importScripts('../build/endpoint.demo.js');
var endpoint = this.endpoint;

var _this = this;
var api = {
    doWork: function(id) {
        return 'worked ' + id;
    },
    terminate: function() {
        setTimeout(function() {
            endpoint.getConfiguration().getLink('default-worker').close();
            _this.close();
        }, 250);
    }
};

var adapter = endpoint.registerAdapter(endpoint.getInstanceId(), '1.0', api);

// Tell parent about us
var parentFacade = endpoint.createFacade('worker-register-api', '1.0', { neighborhood: 'group' });
parentFacade.on('ready', function() {
    parentFacade.getApi().registerWorker(endpoint.getInstanceId())
        .then(function() {
            parentFacade.close();
        });
});
