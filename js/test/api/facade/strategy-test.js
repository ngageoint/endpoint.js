var strategy = require('../../../app/api/facade/strategy');
var address = require('../../../app/routing/address');
var logger = require('../../../app/util/logger');

describe('strategy', function() {

    var sInst;
    var fakeFacade;
    var fakeFacadeFunction;
    var messengerMock;
    var endpointManagerMock;

    beforeEach(function() {
        logger.logLevel = 'trace';

        fakeFacade = {
            getId: function() { return 'id'; },
            getRemoteAddress: function() { return address('remote-instance-id'); },
            getRemoteId: function() { return 'remote-id'; }
        };

        fakeFacadeFunction = function() {};
        fakeFacadeFunction.isFacadeFunction = function() { return true; };
        fakeFacadeFunction.getFacadeFunctionName = function() { return 'helloFunc'; };
        fakeFacadeFunction.getFacade = function() { return fakeFacade; };

        messengerMock = {
            register: function() {},
            sendMessage: function() {},
            unRegister: function() {}
        };

        endpointManagerMock = {
            registerEndpoint: function() {},
            registerPeriodic: function() {},
            getService: function() { return messengerMock; },
            getInstanceId: function() { return 'id1'; }
        };

        // Return a new strategy with the call.
        sInst = strategy(
            endpointManagerMock,
            {
                instanceId: 'inst'
            }
        );

    });

    it('should turn second argument of then to catch', function() {
        sInst.call(fakeFacadeFunction, []);
        var func = function() {};
        sInst.then(function() {}, func);
        expect(sInst._catch).toBe(func);
    });

    it('should send call-ignore if there is no then', function() {
        sInst.call(fakeFacadeFunction, []);
        spyOn(messengerMock, 'sendMessage').and.callFake(function(remoteAddress, remoteId, message) {
            expect(message.type).toBe('call-ignore');
        });
        sInst.execute();
        expect(messengerMock.sendMessage).toHaveBeenCalled();
    });

    it('should send call if there is a then and an argument', function() {
        sInst.call(fakeFacadeFunction, []);
        sInst.then(function(arg) {});
        spyOn(messengerMock, 'sendMessage').and.callFake(function(remoteAddress, remoteId, message) {
            expect(message.type).toBe('call');
        });
        sInst.execute();
        expect(messengerMock.sendMessage).toHaveBeenCalled();
    });

    it('should send call-ignore if there is a then and no argument', function() {
        sInst.call(fakeFacadeFunction, []);
        sInst.then(function() {});
        spyOn(messengerMock, 'sendMessage').and.callFake(function(remoteAddress, remoteId, message) {
            expect(message.type).toBe('call-ignore');
        });
        sInst.execute();
        expect(messengerMock.sendMessage).toHaveBeenCalled();
    });

    it('should combine two strategies when passed to pipe', function() {
        sInst.call(fakeFacadeFunction, []);
        sInst.then(function() {});

        var secondInst = strategy(
            endpointManagerMock,
            {
                instanceId: 'inst'
            }
        );

        secondInst.call(fakeFacadeFunction, []);
        secondInst.pipe(fakeFacadeFunction);
        secondInst.then(function() {});

        sInst.pipe(secondInst);

        expect(secondInst._route.length).toBe(0);
        expect(sInst._route.length).toBe(5);
    });

    it('should allow use of buffered() call', function() {
        sInst.call(fakeFacadeFunction, []);
        expect(sInst._route[0]._buffered).toBe(false);
        sInst.buffered();
        expect(sInst._route[0]._buffered).toBe(true);
        sInst.buffered(false);
        expect(sInst._route[0]._buffered).toBe(false);
        sInst.buffered(true);
        expect(sInst._route[0]._buffered).toBe(true);
    });

    xit('buffered should be transferred when piped to local stream', function() {

    });

    xit('buffered should be transferred for remote stream', function() {

    });

    xit('buffered should be transferred for output stream', function() {

    });

});
