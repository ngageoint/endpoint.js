var checkFunc = require('./util/wait-for-textarea-length');

describe('Worker Pool', function() {

    it('it should work', function() {

        var i = 0;

        browser.url('http://localhost:8282/worker-pool/worker-pool.html');

        browser.click('a=Step 1: create workers');
        checkFunc('#console', 6);
        var html = browser.getText('#console');
        var parts = html.split('\n');
        expect(parts[i++]).toBe('created worker 0');
        expect(parts[i++]).toBe('created worker 1');
        expect(parts[i++]).toBe('created worker 2');
        expect(parts[i++]).toBe('worker connected');
        expect(parts[i++]).toBe('worker connected');
        expect(parts[i++]).toBe('worker connected');

        browser.click('a=Step 2: execute work');
        checkFunc('#console', 10);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i++]).toBe('executing work on 3 workers');
        expect(parts[i++]).toBe('worker completed: worked work');
        expect(parts[i++]).toBe('worker completed: worked work');
        expect(parts[i++]).toBe('worker completed: worked work');

        browser.click('a=Step 3: close workers');
        checkFunc('#console', 13);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i++]).toBe('terminated worker');
        expect(parts[i++]).toBe('terminated worker');
        expect(parts[i++]).toBe('terminated worker');

        var log = browser.log('browser');
        console.log('Analyzing ' + log.value.length + ' log entries');
        log.value.forEach(function(entry) {
            expect(entry.message).not.toMatch(/\[error\]/);
            expect(entry.message).not.toMatch(/\[warn\]/);
        });
    });

});
