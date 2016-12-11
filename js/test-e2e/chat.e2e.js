var multi = require('./util/multi-window');

describe('Chat', function() {

    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

    it('it should work', function() {

        var i1 = 0;
        var i2 = 0;

        var wnd = multi();

        browser.url('http://localhost:8282/chat-server/chat-server.html');

        wnd.second();

        browser.url('http://localhost:8283/chat-server/chat-server.html');

        browser.waitForExist('.btn-input');

        wnd.first();

        //wait for the other chat window to connect
        browser.waitForExist('.btn-input');

        browser.setValue('.btn-input', 'test');
        browser.click('button.btn-chat');

        browser.waitForExist('.message');

        // Switch to next window
        wnd.second();

        browser.waitForExist('.message');

        browser.setValue('.btn-input', 'test back');
        browser.click('button.btn-chat');
        browser.pause(1000);

        var log = browser.log('browser');
        console.log('Analyzing ' + log.value.length + ' log entries');
        log.value.forEach(function(entry) {
            expect(entry.message).not.toMatch(/\[error\]/);
            // Allow warn!
        });

        wnd.clean();
    });

});
