var routingTable = require('../../app/routing/routing-table');
var logger = require('../../app/util/logger');

describe('routing table', function() {

    var routers;
    var lin;
    var cycles;
    var total;

    beforeEach(function() {
        logger.logLevel = 'debug';
        jasmine.clock().install();

        lin = {};
        routers = {};

        cycles = 0;
        total = 0;

    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });

    it ('should build a routing table properly', function() {

        var a = addLink('A', [], 0);
        var b = addLink('B', ['A'], 1);
        var c = addLink('C', ['A'], 5);
        var d = addLink('D', ['C'], 2);
        var e = addLink('E', ['C', 'A'], 1);

        var table = c._exportTableAsUpdates(true);
        var table1 = buildNextHopIndex(table);

        expect(table1.A.next).toBe('E');
        expect(table1.B.next).toBe('E');
        expect(table1.C.next).toBe('C');
        expect(table1.D.next).toBe('D');
        expect(table1.E.next).toBe('E');

        expect(table1.A.cost).toBe(2);
        expect(table1.B.cost).toBe(3);
        expect(table1.C.cost).toBe(0);
        expect(table1.D.cost).toBe(2);
        expect(table1.E.cost).toBe(1);

        verifyMirror();
    });

    it('should reroute traffic through expensive route after removing cheap route', function() {

        var a = addLink('A', [], 0);
        var b = addLink('B', ['A'], 1);
        var c = addLink('C', ['A'], 5);
        var d = addLink('D', ['C'], 2);
        var e = addLink('E', ['C', 'A'], 1);

        removeLink('A', ['E']);

        var table = c._exportTableAsUpdates(true);
        var table1 = buildNextHopIndex(table);

        expect(table1.A.next).toBe('A');
        expect(table1.B.next).toBe('A');
        expect(table1.C.next).toBe('C');
        expect(table1.D.next).toBe('D');
        expect(table1.E.next).toBe('E');

        expect(table1.A.cost).toBe(5);
        expect(table1.B.cost).toBe(6);
        expect(table1.C.cost).toBe(0);
        expect(table1.D.cost).toBe(2);
        expect(table1.E.cost).toBe(1);

        verifyMirror();
    });

    it('should immediately remove route through next hop when disconnected', function() {

        var routeExpire = jasmine.createSpy('routeExpire');

        var a = addLink('A', [], 0);
        addLink('B', ['A'], 1);
        addLink('C', ['B'], 1);
        addLink('D', ['C'], 1);
        addLink('E', ['D'], 1);

        a.on('route-expired', function() {
            routeExpire();
        });

        var table = a._exportTableAsUpdates(true);
        expect(table.length).toBe(5);

        removeLink('C', ['B']);

        jasmine.clock().tick(45000);

        table = a._exportTableAsUpdates(true);
        expect(table.length).toBe(2);

        expect(routeExpire).toHaveBeenCalled();

        verifyMirror();
    });

    it('should delay removing route when update comes from not next hop', function() {

        var routeExpire = jasmine.createSpy('routeExpire');

        var a = addLink('A', [], 0),
            b = addLink('B', ['A'], 2),
            c = addLink('C', ['A', 'B'], 1);

        a.on('route-expired', function() {
            routeExpire();
        });

        // Remove the link between B and C, and ensure that route update never fires
        removeLink('B', ['C']);

        expect(routeExpire).not.toHaveBeenCalled();

        verifyMirror();
    });

    function buildNextHopIndex(table) {
        var index = {};
        for (var i = 0; i < table.length; i++) {
            var item = table[i];
            index[item.id] = item;
        }
        return index;
    }

    function addLink(id, connects, size) {
        var r = routingTable(id);
        lin[id] = [];
        routers[id] = r;
        connects.forEach(function(conn) {
            lin[conn].push(r);
            lin[id].push(routers[conn]);
            var updates1 = r.addLink(conn, size);
            var updates2 = routers[conn].addLink(id, size);
            applyUpdatesFor(id, updates1);
            applyUpdatesFor(conn, updates2);
        });
        return r;
    }

    function removeLink(id, connects) {
        var r = routers[id];
        connects.forEach(function(conn) {
            var connIndex = lin[id].indexOf(routers[conn]);
            lin[id].splice(connIndex, 1);
            var rIndex = lin[conn].indexOf(r);
            lin[conn].splice(rIndex, 1);
            var updates1 = r.removeLink(conn);
            //console.dir(updates1);
            //return;
            var updates2 = routers[conn].removeLink(id);
            applyUpdatesFor(id, updates1);
            applyUpdatesFor(conn, updates2);
        });
    }

    function applyUpdatesFor(id, updates) {
        // Apply the updates to all of id's connections
        lin[id].forEach(function(it) {
            cycles++;
            total += updates.length;
            var up2 = it.applyUpdates(id, updates);
            if (up2.length > 0) {
                applyUpdatesFor(it.getId(), up2);
            }
        });
    }

    function verifyMirror() {

        console.log('total updates = ' + total + ', cycles = ' + cycles);

        var nextHops = {};

        var keys = Object.keys(routers);
        for (var i = 0; i < keys.length; i++) {
            nextHops[keys[i]] = buildNextHopIndex(routers[keys[i]]._exportTableAsUpdates(true));
        }

        console.log('Checking mirror status of routers ...');
        //console.log('%s', JSON.stringify(nextHops, null, 2));

        var current;
        for (var j = 0; j < keys.length; j++) {
            var left = keys[j];
            for (var k = 0; k < keys.length; k++) {
                var right = keys[k];

                if (!nextHops[left][right] && !nextHops[right][left]) {
                    console.log ('cannot make it from ' + left + ' to ' + right + ' or vice versa, skipping');
                    continue;
                }
                else if (!nextHops[left][right] && nextHops[right][left]) {
                    console.log('can make it from ' + left + ' to ' + right + ' but not vice versa!');
                    expect(true).toBe(false);
                    return;
                }
                else if (nextHops[left][right] && !nextHops[right][left]) {
                    console.log('can make it from ' + left + ' to ' + right + ' but not vice versa!');
                    expect(true).toBe(false);
                    return;
                }

                var visited = {};
                var path = [];
                current = left;
                while (current != right) {
                    if (visited[current]) {
                        console.log('could not make it from ' + left + ' to ' + right);
                        expect(true).toBe(false);
                        return;
                    }
                    visited[current] = true;
                    current = nextHops[current][right].next;
                    //console.log ('going from ' + left + ' to ' + right + ', current = ' + current);

                    path.push(current);
                }

                //console.log(JSON.stringify(path));

                // Verify reverse path
                visited = {};
                current = right;
                while (current != left) {
                    if (visited[current]) {
                        console.log('could not make it from ' + right + ' to ' + left);
                        expect(true).toBe(false);
                        return;
                    }
                    visited[current] = true;
                    var item = path.pop();
                    if (item != current) {
                        console.log('invalid path from ' + right + ' to ' + left);
                        expect(true).toBe(false);
                        return;
                    }
                    current = nextHops[current][left].next;
                    //console.log ('going from ' + right + ' to ' + left + ', current = ' + current);

                }

            }
        }

    }
});
