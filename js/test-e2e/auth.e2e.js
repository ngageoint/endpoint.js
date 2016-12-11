var checkFunc = require('./util/wait-for-textarea-length');

describe('Authentication', function() {

    it('it should allow access with auth', function() {

        browser.url('http://localhost:8282/auth/auth.html');

        browser.click('a=Step 1: connect facade');
        checkFunc('#console', 1);
        var html = browser.getText('#console');
        var parts = html.split('\n');
        expect(parts[0]).toBe('facade connected');

        browser.click('a=Step 2: call authentication api');
        checkFunc('#console', 4);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[3]).toBe('successfully authorized');

        browser.click('a=Step 3: call protected method');
        checkFunc('#console', 5);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[4]).toBe('did something interesting call returned');

        browser.click('a=Step 4: disconnect');
        checkFunc('#console', 6);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[5]).toBe('facade disconnected');

        var log = browser.log('browser');
        console.log('Analyzing ' + log.value.length + ' log entries');
        log.value.forEach(function(entry) {
            expect(entry.message).not.toMatch(/\[error\]/);
            expect(entry.message).not.toMatch(/\[warn\]/);
        });

    });

    it('it should deny access without auth', function() {

        browser.url('http://localhost:8282/auth/auth.html');

        browser.click('a=Step 1: connect facade');
        checkFunc('#console', 1);
        var html = browser.getText('#console');
        var parts = html.split('\n');
        expect(parts[0]).toBe('facade connected');

        browser.click('a=Step 3: call protected method');
        checkFunc('#console', 4);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[3]).toBe('failed to do something interesting: User is not authenticated');

        browser.click('a=Step 4: disconnect');
        checkFunc('#console', 5);
        html = browser.getText('#console');
        parts = html.split('\n');
        expect(parts[4]).toBe('facade disconnected');

    });

});
