/**
 * Wait for the text area to have the given number of entries
 */
module.exports = function(selector, num) {

    // This function will loop until the selector text area
    // has num or more entries.
    var checkFunc = function() {
        // Check the value
        return this.getText(selector)
            .then(function(html) {
                var parts = html.split('\n');
                if (parts.length >= num) {
                    return this;
                }
                return this.pause(250)
                    .then(checkFunc);
            });
    };

    return checkFunc;
};
