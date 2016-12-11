var selenium = require('selenium-standalone');

module.exports = function(grunt) {

    var settings = {
        // check for more recent versions of selenium here:
        // https://selenium-release.storage.googleapis.com/index.html
        version: '2.53.1',
        baseURL: 'https://selenium-release.storage.googleapis.com',
        drivers: {
            chrome: {
                // check for more recent versions of chrome driver here:
                // https://chromedriver.storage.googleapis.com/index.html
                version: '2.26',
                arch: process.arch,
                baseURL: 'https://chromedriver.storage.googleapis.com'
            },
            ie: false
        },
        logger: function(message) {
            console.log('SELENIUM INSTALL: ' + message);
        }
    };

    // Install Selenium
    grunt.registerTask('selenium-install', function() {
        var done = this.async();
        selenium.install(settings, done);
    });

    // Start Selenium
    grunt.registerTask('selenium-start', function() {
        var done = this.async();
        selenium.start(
            settings,
            function(err, chld) {
                process.on('exit', function() {
                    chld.kill();
                });
                done(err);
            }
        );
    });

};
