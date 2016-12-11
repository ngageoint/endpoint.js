var checkFunc = require('./util/wait-for-textarea-length');

describe('Child Facade', function() {

    it('it should work', function() {

        browser.url('http://localhost:8282/sub-facade/sub-facade.html');

        browser.click('a=Step 1: create adapter');
        checkFunc('#console', 1);
        var html = browser.getText('#console');
        var parts = html.split('\n');
        expect(parts[0]).toBe('Created Adapter');

        browser.click('a=Step 2: create facade');
        checkFunc('#console', 3);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[1]).toBe('Created Facade');
        expect(parts[2]).toBe('Facade is ready');

        browser.click('a=Step 3: get child facade');
        checkFunc('#console', 4);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[3]).toBe('Got child facade');

        browser.click('a=Step 4: call child facade');
        checkFunc('#console', 5);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[4]).toBe('executed child facade');

        browser.click('a=Step 5: pass child facade to parent facade');
        checkFunc('#console', 7);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[5]).toBe('parent is executing child ...');
        expect(parts[6]).toBe('executed child facade');

        browser.click('a=Step 6: close facade');
        checkFunc('#console', 9);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[7]).toBe('Facade has closed');
        expect(parts[8]).toBe('Child facade has closed');

        var log = browser.log('browser');
        console.log('Analyzing ' + log.value.length + ' log entries');
        log.value.forEach(function(entry) {
            expect(entry.message).not.toMatch(/\[error\]/);
            expect(entry.message).not.toMatch(/\[warn\]/);
        });
    });

});
