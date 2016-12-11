describe('Plot Point', function() {

    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

    it('it should work', function(done) {

        browser.url('http://localhost:8282/plot-point/plot-point.html');

        browser.waitForExist('a=Plot Point');
        browser.click('a=Plot Point');

        browser.setValue('#point-x', 33);
        browser.setValue('#point-y', 44);

        browser.click('#plot-button');

        browser.waitForExist('circle');

        var log = browser.log('browser');
        console.log('Analyzing ' + log.value.length + ' log entries');
        log.value.forEach(function(entry) {
            expect(entry.message).not.toMatch(/\[error\]/);
            expect(entry.message).not.toMatch(/\[warn\]/);
        });

    });

});
