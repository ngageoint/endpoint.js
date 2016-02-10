var metawrapStream = require('../../app/streams/metawrap-stream');
var through2 = require('through2');
var logger = require('../../app/util/logger');

describe('metawrap stream', function() {

    var encode;
    var decode;

    beforeEach(function() {
        logger.logLevel = 'trace';

        encode = metawrapStream.encodeMetaWrapStream();
        decode = metawrapStream.decodeMetaWrapStream();
    });

    it('should wrap when encoding', function() {
        var called = false;
        encode.pipe(through2.obj(function(chunk) {
            called = true;
            expect(chunk).toEqual({
                m: 'test'
            });
        }));
        encode.write('test');
        expect(called).toEqual(true);
    });

    it('should unwrap when decoding', function() {
        var called = false;
        decode.pipe(through2.obj(function(chunk) {
            called = true;
            expect(chunk).toEqual('test');
        }));
        decode.write({
            m: 'test'
        });
        expect(called).toEqual(true);
    });

});
