module.exports = {
    default: {
        src: ['js/app/**/*.js'],
        options: {
            destination: 'dist/jsdoc-<%= pkg.version %>',
            configure: 'jsdoc.conf.json'
        }
    }
};
