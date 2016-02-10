var EventEmitter = require('events').EventEmitter;
var inherit = require('util').inherits;

inherit(Writer, EventEmitter);

module.exports = Writer;

function Writer() {
    if (!(this instanceof Writer)) { return new Writer(); }
    this._data = null;
    EventEmitter.call(this);
}
Writer.prototype.write = function(data) {
    this._data = data;
};
