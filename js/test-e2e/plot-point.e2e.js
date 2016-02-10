describe('Plot Point', function() {

    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

    // This 'init()' is done to clear the log, as webdriverio-runner doesn't do that between testsuites
    beforeEach(function(done) {
        browser.init(done);
    });

    it('it should work', function(done) {

        browser
            .url('http://localhost:8282/plot-point/plot-point.html')

            .waitForExist('a=Plot Point')
            .click('a=Plot Point')

            .setValue('#point-x', 33)
            .setValue('#point-y', 44)

            .click('#plot-button')

            .waitForExist('circle')

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
