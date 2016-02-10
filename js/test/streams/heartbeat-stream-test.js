var heartbeatStream = require('../../app/streams/heartbeat-stream');
var logger = require('../../app/util/logger');

describe('heartbeat stream', function() {

    var timeoutCallback;
    var streams;

    beforeEach(function() {
        logger.logLevel = 'trace';

        timeoutCallback = jasmine.createSpy('timeoutCallback');

        jasmine.clock().install();

        // 5ms heartbeat duration
        streams = heartbeatStream(15000);
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });

    it('should stay active while reading data', function() {

        streams.decode.on('heartbeat-timeout', function() {
            timeoutCallback();
        });

        for (var i = 0; i < 10; i += 1) {
            jasmine.clock().tick(10000);
            streams.decode.write({ m: 'data' });
        }

        expect(timeoutCallback).not.toHaveBeenCalled();

    });

    it('should emit timeout when not reading data for a while', function() {

        streams.decode.on('heartbeat-timeout', function() {
            timeoutCallback();
        });

        jasmine.clock().tick(20000);
        jasmine.clock().tick(20000);

        expect(timeoutCallback).toHaveBeenCalled();

    });

    it('should send a ping occasionally', function() {

        streams.decode.on('heartbeat-timeout', function() {
            timeoutCallback();
        });

        jasmine.clock().tick(10000);
        streams.decode.write({ m: 'data' });

        jasmine.clock().tick(10000);
        streams.decode.write({ m: 'data' });

        var written = streams.encode.read();
        expect(written).toEqual({
            h: 'ping'
        });

        expect(timeoutCallback).not.toHaveBeenCalled();
    });

});
