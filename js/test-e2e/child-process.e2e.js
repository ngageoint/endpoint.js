var checkFunc = require('./util/wait-for-textarea-length');

describe('Child Process', function() {

    // This 'init()' is done to clear the log, as webdriverio-runner doesn't do that between testsuites
    beforeEach(function(done) {
        browser.init(done);
    });

    it('it should work', function(done) {
        var i = 0;
        browser
            .url('http://localhost:8282/child-process/child-process.html')

            .click('a=Step 1: create facade')
            .then(checkFunc('#console', 2))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i++]).toBe('Created Facade');
                expect(parts[i++]).toBe('Facade is ready');
            })

            .click('a=Step 2: call facade')
            .then(checkFunc('#console', 3))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i++]).toBe('got result: got your input [my input]');
            })

            .click('a=Step 3: close facade')
            .then(checkFunc('#console', 4))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i++]).toBe('Facade has closed');
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
