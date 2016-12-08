var config = {
    unit: {
        frameworks: ['jasmine', 'browserify'],
        preprocessors: {
            'js/test/**/*.js': ['browserify'],
            'js/app/**/*.js': ['coverage']
        },
        reporters: ['coverage', 'progress'],
        coverageReporter: {
            type: 'html',
            dir: 'reports/coverage'
        },
        files: {
            src: [
                'js/test/**/*.js'
            ]
        },
        browserify: {
            debug: true,
            transform: ['require-globify', 'browserify-istanbul']
        },
        port: 9876,
        colors: true,
        singleRun: true,
        autoWatch: false,
        browsers: ['Chrome'],
        logLevel: 'INFO'
    }
};

// setup for Sauce Labs

if (process.env.CI) {
    var customLaunchers = {
        sl_chrome: {
            base: 'SauceLabs',
            browserName: 'chrome',
            version: 'latest'
        },
        sl_firefox: {
            base: 'SauceLabs',
            browserName: 'firefox',
            version: 'latest'
        }
    };

    config.unit.sauceLabs = {
        testName: 'Endpoint.js Unit Tests',
        tunnelIdentifier: process.env.TRAVIS_JOB_NUMBER,
        username: process.env.SAUCE_USERNAME,
        accessKey: process.env.SAUCE_ACCESS_KEY,
        startConnect: false
    };

    config.unit.customLaunchers = customLaunchers;
    config.unit.browsers = Object.keys(customLaunchers);
    config.unit.reporters = ['dots', 'saucelabs'];
}

module.exports = config;
