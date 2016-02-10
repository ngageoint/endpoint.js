(function(endpoint) {

    var authenticationApi = {
        authorize: function(user, password) {
            if (password == 'password1') {
                var clientInstance = adapter.getCurrentContext().getClientInstance();
                clientInstance.authenticated = true;
            }
            else {
                throw new Error('unknown user');
            }
            return true;
        }
    };

    var protectedApi = {
        doSomethingInteresting: function() {
            // Ensure we're authorized
            var clientInstance = adapter.getCurrentContext().getClientInstance();
            if (!clientInstance.authenticated) {
                throw new Error('User is not authenticated');
            }
            return 'did some work';
        }
    };

    var companyApi = {
        getProtectedApi: function() {
            return protectedApi;
        },
        getAuthenticationApi: function() {
            return authenticationApi;
        }
    };

    var adapter = endpoint.registerAdapter('company-api', '1.0', companyApi);

})(window.endpoint);