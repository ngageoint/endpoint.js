var checkFunc = require('./util/wait-for-textarea-length');

describe('Authentication', function() {

    // This 'init()' is done to clear the log, as webdriverio-runner doesn't do that between testsuites
    beforeEach(function(done) {
        browser.init(done);
    });

    it('it should allow access with auth', function(done) {

        browser
            .url('http://localhost:8282/auth/auth.html')

            .click('a=Step 1: connect facade')
            .then(checkFunc('#console', 1))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[0]).toBe('facade connected');
            })

            .click('a=Step 2: call authentication api')
            .then(checkFunc('#console', 4))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[3]).toBe('successfully authorized');
            })

            .click('a=Step 3: call protected method')
            .then(checkFunc('#console', 5))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[4]).toBe('did something interesting call returned');
            })

            .click('a=Step 4: disconnect')
            .then(checkFunc('#console', 6))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[5]).toBe('facade disconnected');
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

    it('it should deny access without auth', function(done) {
        browser
            .url('http://localhost:8282/auth/auth.html')

            .click('a=Step 1: connect facade')
            .then(checkFunc('#console', 1))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[0]).toBe('facade connected');
            })

            .click('a=Step 3: call protected method')
            .then(checkFunc('#console', 4))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[3]).toBe('failed to do something interesting: User is not authenticated');
            })

            .click('a=Step 4: disconnect')
            .then(checkFunc('#console', 5))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[4]).toBe('facade disconnected');
            })

            .call(done);
    });

    afterEach(function(done) {
        browser.end(done);
    });

});
