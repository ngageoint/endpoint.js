this.endpointLogLevel = 'trace';
importScripts('../build/endpoint.demo.js');

// This function will establish an adapter that windows can use to determine
// who should execute the server connection.

var clientInstances = {};
var leader = null;

// This is the server-delegate implementation / API
var obj = {
    register: function() {
        var instance = adapter.getCurrentContext().getClientInstance();

        // Save the instance for later as a candidate leader
        clientInstances[instance.getId()] = instance;

        // If this instance closes remove it as a candidate
        instance.on('closed', function() {
            delete clientInstances[instance.getId()];

            // If this guy was the leader, then select a new leader.
            if (instance.getId() == leader) {
                leader = Object.keys(clientInstances)[0];
                if (leader) {
                    clientInstances[leader].getEvents().emit('leader');
                }
            }
        });

        // If there currently is no leader, then assign one.
        if (!leader) {
            leader = instance.getId();
            clientInstances[leader].getEvents().emit('leader');
        }
    }
};

// Register the adapter to allow others to find it
var adapter = this.endpoint.registerAdapter('server-delegate', '1.0', obj);
