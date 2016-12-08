var stringifyStream = require('../../app/streams/stringify-stream');
var Buffer = require('buffer').Buffer;
var logger = require('../../app/util/logger');

describe('buffer stringify stream', function() {

    var buffer;

    beforeEach(function() {
        logger.logLevel = 'trace';
        buffer = new Buffer('hello');
    });

    function getBuffer(buff) {
        if (buff.toArrayBuffer) {
            buff = buff.toArrayBuffer();
        } else {
            buff = buff.buffer;
        }
        return buff;
    }

    it('should decode out of place function', function() {
        var decode = stringifyStream.decodeFunction(false, {
            data: '{"thebuff":{"type":"buffer-o","index":0}}',
            transfer: [getBuffer(buffer)]
        });
        expect(getBuffer(decode.thebuff)).toEqual(getBuffer(buffer));
    });

    it('should decode in place function', function() {
        var decode = stringifyStream.decodeFunction(true, '{"thebuff":{"type":"buffer-i","data":"aGVsbG8="}}');
        expect(decode).toEqual({
            thebuff: buffer
        });
    });

    it('should encode out of place function', function() {
        var encode = stringifyStream.encodeFunction(false, {
            thebuff: buffer
        });
        expect(encode).toEqual({
            data: '{"thebuff":{"type":"buffer-o","index":0}}',
            transfer: [getBuffer(buffer)]
        });
    });

    it('should encode in place function', function() {
        var encode = stringifyStream.encodeFunction(true, {
            thebuff: buffer
        });
        expect(encode).toBe('{"thebuff":{"type":"buffer-i","data":"aGVsbG8="}}');
    });

});
