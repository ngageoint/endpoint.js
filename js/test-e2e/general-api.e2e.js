var checkFunc = require('./util/wait-for-textarea-length');

describe('General API', function() {

    // This 'init()' is done to clear the log, as webdriverio-runner doesn't do that between testsuites
    beforeEach(function(done) {
        browser.init(done);
    });

    it('it should work', function(done) {
        var i = 0;
        browser
            .url('http://localhost:8282/general-api/general-api.html')

            .click('a=Step 1: create adapter')
            .then(checkFunc('#console', 1))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i++]).toBe('Created Adapter');
            })

            .click('a=Step 2: create facade')
            .then(checkFunc('#console', 3))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i++]).toBe('Created Facade');
                expect(parts[i++]).toBe('Facade is ready');
            })

            .click('a=Step 3: call facade')
            .then(checkFunc('#console', 9))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i++]).toBe('apiFunction called with input: passed parameter');
                expect(parts[i++]).toBe('Facade Received Event: data');
                expect(parts[i++]).toBe('simplePipe setting up pipe');
                expect(parts[i++]).toBe('got result: returned value');
                expect(parts[i++]).toBe('transforming value in stream: passed parameter');
                expect(parts[i++]).toBe('read value from output stream: passed parameter [transformed]');

            })

            .click('a=Step 4: write stream')
            .then(checkFunc('#console', 11))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i++]).toBe('transforming value in stream: written data to stream');
                expect(parts[i++]).toBe('read value from output stream: written data to stream [transformed]');
            })

            .click('a=Step 5: close stream')
            .then(checkFunc('#console', 13))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i++]).toBe('Closed input stream');
                expect(parts[i++]).toBe('output stream was forced closed');
            })

            .log('browser')
            .then(function(log) {
                console.log('Analyzing ' + log.value.length + ' log entries');
                log.value.forEach(function(entry) {
                    expect(entry.message).not.toMatch(/\[error\]/);
                    expect(entry.message).not.toMatch(/\[warn\]/);
                });
            })
            .call(done);
    });

    afterEach(function(done) {
        browser.end(done);
    });

});
