var addressTool = require('../../app/routing/address');
var appUtils = require('../../app/util/appUtils');
var logger = require('../../app/util/logger');

describe('remote address', function() {

    beforeEach(function() {
        logger.logLevel = 'debug';
        appUtils.isUuid = function() { return true; };
        appUtils.isExtUuid = function(uuid) {
            if (uuid.length > 1) {
                return true;
            }
            return false;
        };
    });

    it('routeThrough should return a single item vector for parallel paths', function() {
        var vecA = ['A', 'B', 'C', 'D'].reverse();
        var vecB = ['D', 'C', 'B', 'A'].reverse();
        var address = addressTool(vecA).routeThrough(addressTool(vecB));
        expect(address.getPathVector()).toEqual(['A']);
    });

    it('routeThrough should eliminate common nodes between routes', function() {
        var vecA = ['A', 'B', 'C', 'D'].reverse();
        var vecB = ['D', 'C', 'E', 'F'].reverse();
        var address = addressTool(vecA).routeThrough(addressTool(vecB));
        expect(address.getPathVector()).toEqual(['A', 'B', 'C', 'E', 'F']);
    });

    it('routeThrough should eliminate common nodes between routes', function() {
        var vecA = ['A', 'B-ext', 'C'];
        var vecB = ['A', 'B-ext', 'E', 'F'];
        var address = addressTool(vecA).routeThrough(addressTool(vecB, true));
        expect(address.getPathVector()).toEqual(['C', 'E', 'F']);
    });

    it('routeThrough should handle a single node vector on this side', function() {
        var vecA = ['A'].reverse();
        var vecB = ['A', 'B', 'C'].reverse();
        var address = addressTool(vecA).routeThrough(addressTool(vecB));
        expect(address.getPathVector()).toEqual(['A', 'B', 'C']);
    });

    it('routeThrough should handle a single node vector on that side', function() {
        var vecA = ['A', 'B', 'C'].reverse();
        var vecB = ['C'].reverse();
        var address = addressTool(vecA).routeThrough(addressTool(vecB));
        expect(address.getPathVector()).toEqual(['A', 'B', 'C']);
    });

    it('routeThrough should simplify routes with the same node by removing all intermediate nodes', function() {
        var vecA = ['E', 'D', 'C', 'B', 'A'].reverse();
        var vecB = ['A', 'B', 'F', 'D', 'G'].reverse();
        var address = addressTool(vecA).routeThrough(addressTool(vecB));
        expect(address.getPathVector()).toEqual(['E', 'D', 'G']);
    });

    it('routeThrough should just concat routes with no commonalities', function() {
        var vecA = ['E', 'D', 'C', 'B', 'A'].reverse();
        var vecB = ['A', 'L', 'M', 'N'].reverse();
        var address = addressTool(vecA).routeThrough(addressTool(vecB));
        expect(address.getPathVector()).toEqual(['E', 'D', 'C', 'B', 'A', 'L', 'M', 'N']);
    });

    it('routeThrough should throw an exception if the routed vectors do not match', function() {
        var vecA = ['A', 'B', 'C'].reverse();
        var vecB = ['B', 'D'].reverse();
        expect(function() { addressTool(vecA).routeThrough(addressTool(vecB)); })
            .toThrow(new Error('While merging two addresses, end of first must be beginning of second'));
    });

    it('isValid should return false for maxHops violation', function() {
        var address = addressTool(['A', 'B', 'C', 'D']);
        expect(address.isValid(2)).toBe(false);
    });

    it('isValid should return false for loop violation', function() {
        var address = addressTool(['A', 'B', 'A', 'C']);
        expect(address.isValid()).toBe(false);
    });
});
