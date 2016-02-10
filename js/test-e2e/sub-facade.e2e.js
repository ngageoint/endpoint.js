var checkFunc = require('./util/wait-for-textarea-length');

describe('Child Facade', function() {

    // This 'init()' is done to clear the log, as webdriverio-runner doesn't do that between testsuites
    beforeEach(function(done) {
        browser.init(done);
    });

    it('it should work', function(done) {
        browser
            .url('http://localhost:8282/sub-facade/sub-facade.html')

            .click('a=Step 1: create adapter')
            .then(checkFunc('#console', 1))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[0]).toBe('Created Adapter');
            })

            .click('a=Step 2: create facade')
            .then(checkFunc('#console', 3))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[1]).toBe('Created Facade');
                expect(parts[2]).toBe('Facade is ready');
            })

            .click('a=Step 3: get child facade')
            .then(checkFunc('#console', 4))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[3]).toBe('Got child facade');
            })

            .click('a=Step 4: call child facade')
            .then(checkFunc('#console', 5))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[4]).toBe('executed child facade');
            })

            .click('a=Step 5: pass child facade to parent facade')
            .then(checkFunc('#console', 7))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[5]).toBe('parent is executing child ...');
                expect(parts[6]).toBe('executed child facade');
            })

            .click('a=Step 6: close facade')
            .then(checkFunc('#console', 9))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[7]).toBe('Facade has closed');
                expect(parts[8]).toBe('Child facade has closed');
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
