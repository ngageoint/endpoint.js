var switchStream = require('../../app/switching/switch-stream');
var linkStream = require('../../app/streams/link-stream');
var through2 = require('through2');
var logger = require('../../app/util/logger');

describe('switch stream', function() {

    var switchCallback;
    var stream;
    var stream1;
    var stream2;

    beforeEach(function() {
        logger.logLevel = 'trace';

        switchCallback = jasmine.createSpy('switchCallback');

        stream = switchStream({
            objectMode: true
        });

        stream.on('switch', function() {
            switchCallback();
        });

        stream1 = through2.obj();
        stream2 = through2.obj();
    });

    it('should switch to the first available stream', function() {
        expect(stream.getNumberStreams()).toBe(0);
        stream.addStream(stream1, 5);
        expect(switchCallback).toHaveBeenCalled();
        expect(stream.getNumberStreams()).toBe(1);

    });

    it('should switch to lower cost stream', function() {
        stream.addStream(stream1, 5);
        stream.addStream(stream2, 2);
        expect(switchCallback.calls.count()).toEqual(2);
    });

    it('should not switch to higher cost stream', function() {
        stream.addStream(stream1, 2);
        stream.addStream(stream2, 5);
        expect(switchCallback.calls.count()).toEqual(1);
    });

    it('should switch to lowest cost stream when lowest removed', function() {
        stream.addStream(stream1, 2);
        stream.addStream(stream2, 5);
        stream.removeStream(stream1);
        expect(switchCallback.calls.count()).toEqual(2);
    });

    it('should not end when a child stream ends', function() {
        stream.addStream(stream1, 2);
        stream.addStream(stream2, 5);
        stream2.end();
        stream1.write('hello'); // this should work without sending a 'write after end' error.
    });

    it('should pass through data from the selected stream', function() {
        var readableCallback = jasmine.createSpy('readableCallback');
        stream.on('readable', function() {
            readableCallback();
        });

        stream.addStream(stream1, 2);
        stream.addStream(stream2, 5);
        stream1.write('hello');

        expect(readableCallback).not.toHaveBeenCalled();
    });

    it('should ignore data from the not selected stream', function() {
        var readableCallback = jasmine.createSpy('readableCallback');
        stream.on('readable', function() {
            readableCallback();
        });

        stream.addStream(stream1, 2);
        stream.addStream(stream2, 5);
        stream2.write('hello');

        expect(readableCallback).not.toHaveBeenCalled();
    });

    it('should only send written data to the selected stream', function() {

        var ln1 = linkStream({
            readTransport: stream1,
            sendTransport: stream2
        });

        var stream3 = through2.obj();
        var stream4 = through2.obj();

        var ln2 = linkStream({
            readTransport: stream3,
            sendTransport: stream4
        });

        var stream2ReadableCallback = jasmine.createSpy('stream2ReadableCallback');
        stream2.on('readable', function() {
            stream2ReadableCallback();
        });

        var stream4ReadableCallback = jasmine.createSpy('stream4ReadableCallback');
        stream4.on('readable', function() {
            stream4ReadableCallback();
        });

        stream.addStream(ln1, 2);
        stream.addStream(ln2, 5);

        stream.write('hello');

        expect(stream2ReadableCallback).toHaveBeenCalled();
        expect(stream4ReadableCallback).not.toHaveBeenCalled();

    });
});
