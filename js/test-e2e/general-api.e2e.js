var checkFunc = require('./util/wait-for-textarea-length');

describe('General API', function() {

    it('it should work', function() {
        var i = 0;
        browser.url('http://localhost:8282/general-api/general-api.html');

        browser.click('a=Step 1: create adapter');
        checkFunc('#console', 1);
        var html = browser.getText('#console');
        var parts = html.split('\n');
        expect(parts[i++]).toBe('Created Adapter');

        browser.click('a=Step 2: create facade');
        checkFunc('#console', 3);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i++]).toBe('Created Facade');
        expect(parts[i++]).toBe('Facade is ready');

        browser.click('a=Step 3: call facade');
        checkFunc('#console', 9);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i++]).toBe('apiFunction called with input: passed parameter');
        expect(parts[i++]).toBe('Facade Received Event: data');
        expect(parts[i++]).toBe('simplePipe setting up pipe');
        expect(parts[i++]).toBe('got result: returned value');
        expect(parts[i++]).toBe('transforming value in stream: passed parameter');
        expect(parts[i++]).toBe('read value from output stream: passed parameter [transformed]');

        browser.click('a=Step 4: write stream');
        checkFunc('#console', 11);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i++]).toBe('transforming value in stream: written data to stream');
        expect(parts[i++]).toBe('read value from output stream: written data to stream [transformed]');

        browser.click('a=Step 5: close stream');
        checkFunc('#console', 13);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i++]).toBe('Closed input stream');
        expect(parts[i++]).toBe('output stream was forced closed');

        var log = browser.log('browser');
        console.log('Analyzing ' + log.value.length + ' log entries');
        log.value.forEach(function(entry) {
            expect(entry.message).not.toMatch(/\[error\]/);
            expect(entry.message).not.toMatch(/\[warn\]/);
        });
    });

});
