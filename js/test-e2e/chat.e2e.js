var multi = require('./util/multi-window');

describe('Chat', function() {

    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

    // This 'init()' is done to clear the log, as webdriverio-runner doesn't do that between testsuites
    beforeEach(function(done) {
        browser.init(done);
    });

    it('it should work', function(done) {

        var i1 = 0;
        var i2 = 0;

        var wnd = multi();

        wnd.then
            .url('http://localhost:8282/chat-server/chat-server.html')

            .then(function() {
                return this.switchTab(wnd.second());
            })

            .url('http://localhost:8283/chat-server/chat-server.html')

            .waitForExist('.btn-input')

            .pause(2000)//wait for the other chat window to connect

            .setValue('.btn-input', 'test')
            .click('button.btn-chat')

            .waitForExist('.message')

            // Switch to next window
            .then(function() {
                return this.switchTab(wnd.first());
            })

            .waitForExist('.message')

            .setValue('.btn-input', 'test back')
            .click('button.btn-chat')
            .pause(1000)

            .log('browser')
            .then(function(log) {
                console.log('Analyzing ' + log.value.length + ' log entries');
                log.value.forEach(function(entry) {
                    expect(entry.message).not.toMatch(/\[error\]/);
                    // Allow warn!
                });

                return wnd.clean(this);
            })

            .call(done);
    });

    afterEach(function(done) {
        browser.end(done);
    });

});
