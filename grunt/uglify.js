module.exports = {
    options: {
        banner: '/**\n' +
            ' * <%= pkg.name %> - v<%= pkg.version %>\n' +
            ' * Built <%= grunt.template.today("yyyy-mm-dd") %>\n' +
            ' * Created in collaboration with Booz Allen Hamilton (www.boozallen.com)\n' +
            ' * (C) ' + new Date().getFullYear() + ' Booz Allen Hamilton, All rights reserved\n' +
            ' * Powered by InnoVision, created by the GIAT\n' +
            ' */\n'
    },
    default: {
        files: [{
            src: 'dist/endpoint-<%= pkg.version %>.js',
            dest: 'dist/endpoint-<%= pkg.version %>.min.js'
        }]
    },
    webrtc: {
        files: [{
            src: 'dist/endpoint-webrtc-<%= pkg.version %>.js',
            dest: 'dist/endpoint-webrtc-<%= pkg.version %>.min.js'
        }]
    }
};
