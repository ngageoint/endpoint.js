module.exports = {
    serve: {
        files: [
            {
                // OpenLayers 3 CSS
                cwd: 'dist',
                src: '**/*',
                dest: 'test/dist',
                expand: true
            }
        ]
    }
};
