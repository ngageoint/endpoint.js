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
        then: null,
        clean: function(then) {
            return then.switchTab(data.first())
                .close(data.second());
        }
    };

    var first;
    var second;

    data.then = browser
        .url('http://localhost:8282/blank.html')

        .getTabIds()
        .then(function(res) {
            first = res[0];
            data.first = function() {
                return first;
            };
        })

        .click('a=open blank tab')

        .pause(1000)

        .getTabIds()
        .then(function(res) {
            var tabs = res.slice(0);

            if (tabs.length != 2) {
                throw new Error('expected two open chrome tabs');
            }

            var index = tabs.indexOf(first);
            tabs.splice(index, 1);
            second = tabs[0];

            data.second = function() {
                return second;
            };

            return this.switchTab(data.first());
        });

    return data;
};
