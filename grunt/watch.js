module.exports = {
    demo: {
        files: '<%= lint.dirs %>',
        tasks: ['demo'],
        options: {
            spawn: false
        }
    }
};
