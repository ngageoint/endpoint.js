var markdownpdf = require('markdown-pdf'),
    fs = require('fs'),
    through2 = require('through2');

module.exports = function(grunt, config) {
    // This task is used to create documentation for the README.md and all referenced
    // files.
    grunt.registerTask('docs-pdf', function() {
        var mdDocs = ['README.md', 'docs/basic.md', 'docs/configuration.md',
            'docs/advanced.md', 'docs/security.md',
            'docs/integration.md', 'docs/architecture.md', 'docs/api.md'];
        var bookPath = 'dist/endpoint-' + config.pkg.version + '-docs.pdf';
        var done = this.async();
        var preProcessMd = function() {
            return through2(function(chunk, enc, cb) {
                var item = chunk.toString('utf8');
                item = item.replace(/docs\/images\//g, '{images_path}');
                item = item.replace(/images\//g, '{images_path}');
                item = item.replace(/{images_path}/g, __dirname + '/../../docs/images/');
                this.push(item, 'utf8');
                cb();
            });
        };
        markdownpdf({
            preProcessMd: preProcessMd,
            remarkable: {
                html: true
            },
            cssPath: 'docs/css/pdf.css'
        }).concat.from(mdDocs).to(bookPath, function() {
            console.log('Created PDF');
            done();
        });
    });
};
