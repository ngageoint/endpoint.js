/**
 * This function will open another tab and return the
 * tab ids and continuation of the webdriver to the caller.
 */
module.exports = function() {

    var func = function() {
        throw new Error('Must not use this inline, must use it in a function');
    };

    var data = {
        first: func,
        second: func,
        clean: function() {
            data.second().close();
            data.first();
        }
    };

    var first;
    var second;

    browser.url('http://localhost:8282/blank.html');

    var res = browser.getTabIds();
    first = res[0];
    data.firstWindow = first;
    data.first = function() {
        var wind = browser.switchTab(first);
        browser.pause(1000);
        return wind;
    };

    browser.click('a=open blank tab');

    browser.pause(1000);

    res = browser.getTabIds();
    var tabs = res.slice(0);

    if (tabs.length != 2) {
        throw new Error('expected two open chrome tabs');
    }

    var index = tabs.indexOf(first);
    tabs.splice(index, 1);
    second = tabs[0];

    data.secondWindow = second;
    data.second = function() {
        var wind = browser.switchTab(second);
        browser.pause(1000);
        return wind;
    };

    data.first();

    return data;
};
