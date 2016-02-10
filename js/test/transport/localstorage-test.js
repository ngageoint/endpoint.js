var localstorage = require('../../app/transport/localstorage');
var logger = require('../../app/util/logger');

describe('local storage transport', function() {

    var testChan;

    beforeEach(function() {
        logger.logLevel = 'trace';
        testChan = localstorage({
            channel: 'chan'
        }, {
            objectMode: true
        });
    });

    it('should send message', function() {
        testChan.write('hello');
        var value = window.localStorage.getItem('chan');
        expect(value).toBe('hello');
    });

    it('should receive sent message', function() {
        testChan._storageEvent({
            key: 'chan',
            newValue: 'hello'
        });
        var readData = testChan.read();
        expect(readData).toBe('hello');
    });

    it('should ignore other data channels', function() {
        testChan.on('readable', function() {
            var readData = testChan.read();
            expect(readData).toBeUndefined();
            done();
        });
        testChan._storageEvent({
            key: 'chan-other',
            newValue: 'hello'
        });
    });
});
