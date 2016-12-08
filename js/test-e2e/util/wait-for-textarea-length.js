/**
 * Wait for the text area to have the given number of entries
 */
module.exports = function(selector, num) {

    // This function will loop until the selector text area
    // has num or more entries.
    var checkFunc = function() {
        var html = browser.getText(selector);
        var parts = html.split('\n');
        if (parts.length >= num) {
            return this;
        }
        browser.pause(250);
        checkFunc();
    };

    checkFunc();
};
