module.exports = {
    build: {
        src: 'js/app/browser.js',
        dest: 'dist/endpoint-<%= pkg.version %>.js'
    },
    demo: {
        src: 'js/app/browser.js',
        dest: 'examples/public/build/endpoint.demo.js',
        options: {
            alias: [
                'events:endpoint-events',
                'util:endpoint-util',
                'buffer:endpoint-buffer',
                'node-uuid:endpoint-uuid',
                'through2:endpoint-through2'
            ],
            browserifyOptions: {
                debug: true
            }
        }
    },
    webrtc: {
        src: 'js/plugins/webrtc/browser.js',
        dest: 'dist/endpoint-webrtc-<%= pkg.version %>.js'
    },
    webrtcdemo: {
        src: 'js/plugins/webrtc/browser.js',
        dest: 'examples/public/build/endpoint-webrtc.demo.js',
        options: {
            browserifyOptions: {
                debug: true
            }
        }

    }
};
