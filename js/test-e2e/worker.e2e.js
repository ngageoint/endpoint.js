var checkFunc = require('./util/wait-for-textarea-length');

describe('Worker Pool', function() {

    // This 'init()' is done to clear the log, as webdriverio-runner doesn't do that between testsuites
    beforeEach(function(done) {
        browser.init(done);
    });

    it('it should work', function(done) {

        var i = 0;

        browser
            .url('http://localhost:8282/worker-pool/worker-pool.html')

            .click('a=Step 1: create workers')
            .then(checkFunc('#console', 6))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');
                expect(parts[i++]).toBe('created worker 0');
                expect(parts[i++]).toBe('created worker 1');
                expect(parts[i++]).toBe('created worker 2');
                expect(parts[i++]).toBe('worker connected');
                expect(parts[i++]).toBe('worker connected');
                expect(parts[i++]).toBe('worker connected');
            })

            .click('a=Step 2: execute work')
            .then(checkFunc('#console', 10))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');

                expect(parts[i++]).toBe('executing work on 3 workers');
                expect(parts[i++]).toBe('worker completed: worked work');
                expect(parts[i++]).toBe('worker completed: worked work');
                expect(parts[i++]).toBe('worker completed: worked work');
            })

            .click('a=Step 3: close workers')
            .then(checkFunc('#console', 13))
            .getText('#console')
            .then(function(html) {
                var parts = html.split('\n');

                expect(parts[i++]).toBe('terminated worker');
                expect(parts[i++]).toBe('terminated worker');
                expect(parts[i++]).toBe('terminated worker');
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
