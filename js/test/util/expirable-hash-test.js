var expirableHash = require('../../app/util/expirable-hash');

describe('expirable hash', function() {

    var hash;

    beforeEach(function() {
        jasmine.clock().install();
        var baseTime = new Date(2013, 9, 23);
        jasmine.clock().mockDate(baseTime);
        hash = expirableHash(0.5);
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });

    it('should add an item to the dictionary', function() {
        hash.add('hello', 'goodbye');
        expect(hash._itemsArray.length).toBe(1);
        expect(hash._itemsHash.hello.v).toEqual('goodbye');
    });

    it('should expire the oldest item', function() {
        hash.add('hello', 'goodbye');
        jasmine.clock().tick(1000);
        var item = hash.get('hello');
        expect(item).toBeUndefined();
        expect(hash._itemsArray.length).toBe(0);
        expect(hash._itemsHash.hello).toBeUndefined();
    });

    it('should not expire the oldest item (if isnt expired on get)', function() {
        jasmine.clock().tick(1000);
        hash.add('hello', 'goodbye');
        var item = hash.get('hello');
        expect(item).toBeDefined();
        expect(hash._itemsArray.length).toBe(1);

    });

    it('should zero out removed item', function() {
        hash.add('junk', 'junk1');
        hash.add('hello', 'goodbye');
        hash.remove('hello');
        expect(hash._itemsArray.length).toBe(2);
        expect(hash._itemsHash.hello).toBeUndefined();
    });

    it('should remove zeroed out item on next get', function() {
        hash.add('hello', 'goodbye');
        hash.add('junk', 'junk1');
        hash.remove('hello');
        jasmine.clock().tick(250);
        expect(hash._itemsArray.length).toBe(2);
        var item = hash.get('hello');
        expect(item).toBeUndefined();
        expect(hash._itemsArray.length).toBe(1);
        expect(hash._itemsHash.hello).toBeUndefined();
    });

    it('should remove zeroed out and expired item on re-add', function() {
        hash.add('junk', 'junk1');
        hash.add('hello', 'goodbye');
        jasmine.clock().tick(250);
        hash.add('hello', 'goodbye 2');
        expect(hash._itemsArray.length).toBe(3);
        expect(hash._itemsArray[1].t).toBe(0);
        jasmine.clock().tick(500);
        var item = hash.get('hello');
        expect(item).toBeUndefined();
        expect(hash._itemsArray.length).toBe(0);
    });

    it('should clean when the amount of removed items becomes too large', function() {
        hash.add('junk', 'junk');
        hash.add('hello', 'goodbye');
        hash.add('hello', 'goodbye');
        hash.add('hello', 'goodbye');
        hash.add('hello', 'goodbye');
        hash.add('hello', 'goodbye');
        hash.add('hello', 'goodbye');
        hash.add('hello', 'goodbye');
        hash.add('hello', 'goodbye');
        hash.add('hello', 'goodbye');
        hash.add('hello', 'goodbye');
        hash.add('hello', 'goodbye');
        hash.add('hello', 'goodbye');
        hash.add('hello', 'goodbye');
        expect(hash._itemsArray.length).toBe(5);
    });

});
