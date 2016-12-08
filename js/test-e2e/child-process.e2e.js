var checkFunc = require('./util/wait-for-textarea-length');

describe('Child Process', function() {

    it('it should work', function() {

        var i = 0;
        browser.url('http://localhost:8282/child-process/child-process.html');

        browser.click('a=Step 1: create facade');
        checkFunc('#console', 2);
        var html = browser.getText('#console');
        var parts = html.split('\n');
        expect(parts[i++]).toBe('Created Facade');
        expect(parts[i++]).toBe('Facade is ready');

        browser.click('a=Step 2: call facade');
        checkFunc('#console', 3);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i++]).toBe('got result: got your input [my input]');

        browser.click('a=Step 3: close facade');
        checkFunc('#console', 4);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[i++]).toBe('Facade has closed');

        var log = browser.log('browser');
        console.log('Analyzing ' + log.value.length + ' log entries');
        log.value.forEach(function(entry) {
            expect(entry.message).not.toMatch(/\[error\]/);
            expect(entry.message).not.toMatch(/\[warn\]/);
        });
    });

});
