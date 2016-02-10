module.exports = {
    unit: {
        frameworks: ['jasmine', 'browserify'],
        preprocessors: {
            'js/test/**/*.js': ['browserify'],
            'js/app/**/*.js': ['coverage']
        },
        reporters: ['coverage'],
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
