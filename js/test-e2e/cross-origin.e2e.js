var multi = require('./util/multi-window');
var checkFunc = require('./util/wait-for-textarea-length');

describe('Cross Origin', function() {

    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

    // This 'init()' is done to clear the log, as webdriverio-runner doesn't do that between testsuites
    beforeEach(function(done) {
        browser.init(done);
    });

    it('it should work', function(done) {

        var i1 = 0;
        var i2 = 0;

        var wnd = multi();

        wnd.then
            .url('http://localhost:8282/cross-origin/plugin1.html')

            .click('a=Step 1: create adapter')
            .then(checkFunc('#console', 1))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i1++]).toBe('Created Adapter');
                return this.switchTab(wnd.second());
            })

            .url('http://localhost:8283/cross-origin/plugin2.html')
            .pause(1000)

            .click('a=Step 2: create facade')
            .then(checkFunc('#console', 2))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i2++]).toBe('Created Facade');
                expect(parts[i2++]).toBe('Facade is ready');
            })

            .click('a=Step 3: call facade')
            .then(checkFunc('#console', 6))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i2++]).toBe('Facade Received Event: data');
                expect(parts[i2++]).toBe('got result: returned value');
                expect(parts[i2++]).toBe('transforming value in stream: passed parameter');
                expect(parts[i2++]).toBe('read value from output stream: passed parameter [transformed]');

            })

            .click('a=Step 4: write stream')
            .then(checkFunc('#console', 8))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i2++]).toBe('transforming value in stream: written data to stream');
                expect(parts[i2++]).toBe('read value from output stream: written data to stream [transformed]');
            })

            .click('a=Step 5: close stream')
            .then(checkFunc('#console', 10))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i2++]).toBe('Closed input stream');
                expect(parts[i2++]).toBe('output stream was forced closed');
            })

            .log('browser')
            .then(function(log) {
                console.log('Analyzing ' + log.value.length + ' log entries');
                log.value.forEach(function(entry) {
                    expect(entry.message).not.toMatch(/\[error\]/);
                    expect(entry.message).not.toMatch(/\[warn\]/);
                });

                return this.switchTab(wnd.first());
            })

            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i1++]).toBe('apiFunction called with input: passed parameter');
                expect(parts[i1++]).toBe('simplePipe setting up pipe');
            })

            .log('browser')
            .then(function(log) {
                console.log('Analyzing ' + log.value.length + ' log entries');
                log.value.forEach(function(entry) {
                    expect(entry.message).not.toMatch(/\[error\]/);
                    expect(entry.message).not.toMatch(/\[warn\]/);
                });

                return wnd.clean(this);
            })

            .call(done);
    });

    afterEach(function(done) {
        browser.end(done);
    });

});
