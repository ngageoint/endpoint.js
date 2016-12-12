var multi = require('./util/multi-window');
var checkFunc = require('./util/wait-for-textarea-length');

describe('Cross Origin', function() {

    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

    it('it should work', function(done) {

        var i1 = 0;
        var i2 = 0;

        var wnd = multi();

        browser.url('http://localhost:8282/cross-origin/plugin1.html');

        browser.click('a=Step 1: create adapter');
        checkFunc('#console', 1);
        var html = browser.getText('#console');
        var parts = html.split('\n');
        expect(parts[i1++]).toBe('Created Adapter');

        wnd.second();

        browser.url('http://localhost:8283/cross-origin/plugin2.html');
        browser.pause(1000);

        browser.click('a=Step 2: create facade');
        checkFunc('#console', 2);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i2++]).toBe('Created Facade');
        expect(parts[i2++]).toBe('Facade is ready');

        browser.click('a=Step 3: call facade');
        checkFunc('#console', 6);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i2++]).toBe('Facade Received Event: data');
        expect(parts[i2++]).toBe('got result: returned value');
        expect(parts[i2++]).toBe('transforming value in stream: passed parameter');
        expect(parts[i2++]).toBe('read value from output stream: passed parameter [transformed]');

        browser.click('a=Step 4: write stream');
        checkFunc('#console', 8);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i2++]).toBe('transforming value in stream: written data to stream');
        expect(parts[i2++]).toBe('read value from output stream: written data to stream [transformed]');

        browser.click('a=Step 5: close stream');
        checkFunc('#console', 10);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i2++]).toBe('Closed input stream');
        expect(parts[i2++]).toBe('output stream was forced closed');

        var log = browser.log('browser');
        console.log('Analyzing ' + log.value.length + ' log entries');
        log.value.forEach(function(entry) {
            expect(entry.message).not.toMatch(/\[error\]/);
        });

        wnd.first();

        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i1++]).toBe('apiFunction called with input: passed parameter');
        expect(parts[i1++]).toBe('simplePipe setting up pipe');

        log = browser.log('browser');
        console.log('Analyzing ' + log.value.length + ' log entries');
        log.value.forEach(function(entry) {
            expect(entry.message).not.toMatch(/\[error\]/);
        });

        wnd.clean();

    });

});
