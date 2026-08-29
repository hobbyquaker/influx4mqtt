/**
 * The write client: which endpoint, which auth, and what the buffer does when InfluxDB is slow,
 * broken or absent. `fetch` is faked throughout.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {writeUrl, writeHeaders, createWriter} from '../lib/influx.js';

const QUIET = {debug() {}, info() {}, warn() {}, error() {}};

/** A fetch that records calls and answers with the queued statuses (200/204 = accepted). */
function fakeFetch(statuses = []) {
    const calls = [];
    const queue = [...statuses];
    return {
        calls,
        fetchImpl: async (url, options) => {
            calls.push({url, ...options});
            const next = queue.length > 0 ? queue.shift() : 204;
            if (next instanceof Error) {
                throw next;
            }
            return {status: next, text: async () => 'detail'};
        },
    };
}

describe('writeUrl', () => {
    test('api 1 writes to /write?db=', () => {
        assert.equal(
            writeUrl({influxUrl: 'http://h:8086', influxVersion: 1, influxDb: 'mqtt'}),
            'http://h:8086/write?precision=ns&db=mqtt',
        );
    });

    test('api 2 writes to /api/v2/write with bucket and org', () => {
        assert.equal(
            writeUrl({influxUrl: 'http://h:8086', influxVersion: 2, influxDb: 'mqtt', influxOrg: 'home'}),
            'http://h:8086/api/v2/write?precision=ns&bucket=mqtt&org=home',
        );
    });

    test('a trailing slash on the base url does not double up', () => {
        assert.match(writeUrl({influxUrl: 'http://h:8086/', influxDb: 'x'}), /^http:\/\/h:8086\/write\?/);
    });

    test('names that need escaping are encoded', () => {
        assert.match(writeUrl({influxUrl: 'http://h', influxDb: 'my db', influxVersion: 1}), /db=my\+db/);
    });

    test('https and a path prefix survive', () => {
        assert.match(writeUrl({influxUrl: 'https://h/influx', influxDb: 'x'}), /^https:\/\/h\/influx\/write\?/);
    });
});

describe('writeHeaders', () => {
    test('a token is the v2 scheme, and v1.8+ accepts it too', () => {
        assert.equal(writeHeaders({influxVersion: 2, influxToken: 'secret'}).authorization, 'Token secret');
    });

    test('username and password become http basic auth', () => {
        const {authorization} = writeHeaders({influxUsername: 'u', influxPassword: 'p'});
        assert.equal(authorization, 'Basic ' + Buffer.from('u:p').toString('base64'));
    });

    test('no credentials, no authorization header', () => {
        assert.equal(writeHeaders({}).authorization, undefined);
    });

    test('a token wins over basic auth rather than sending both', () => {
        assert.match(writeHeaders({influxToken: 't', influxUsername: 'u'}).authorization, /^Token /);
    });
});

describe('createWriter', () => {
    const config = {influxUrl: 'http://h:8086', influxVersion: 1, influxDb: 'mqtt', bufLength: 3, bufInterval: 30};

    test('buffers until full, then writes everything in one request', async () => {
        const {fetchImpl, calls} = fakeFetch();
        const w = createWriter(config, {log: QUIET, fetchImpl});
        w.add('a value=1.0 1');
        w.add('b value=2.0 2');
        assert.equal(calls.length, 0, 'still buffering');
        assert.equal(w.size, 2);
        w.add('c value=3.0 3');
        await w.flush();
        assert.equal(calls.length, 1);
        assert.equal(calls[0].body, 'a value=1.0 1\nb value=2.0 2\nc value=3.0 3');
        assert.equal(calls[0].method, 'POST');
        assert.equal(w.size, 0);
    });

    test('flush with nothing buffered makes no request', async () => {
        const {fetchImpl, calls} = fakeFetch();
        const w = createWriter(config, {log: QUIET, fetchImpl});
        await w.flush();
        assert.equal(calls.length, 0);
    });

    test('stop() writes what is left — a SIGTERM must not drop the buffer', async () => {
        const {fetchImpl, calls} = fakeFetch();
        const w = createWriter(config, {log: QUIET, fetchImpl});
        w.add('a value=1.0 1');
        await w.stop();
        assert.equal(calls.length, 1);
        assert.equal(calls[0].body, 'a value=1.0 1');
    });

    test('reachability is reported once per change, for <name>/connected', async () => {
        const states = [];
        const {fetchImpl} = fakeFetch([204, 204, new Error('ECONNREFUSED'), 204]);
        const w = createWriter(config, {log: QUIET, fetchImpl, onState: (up) => states.push(up)});
        for (const body of ['a value=1.0 1', 'b value=1.0 1', 'c value=1.0 1', 'd value=1.0 1']) {
            w.add(body);
            await w.flush();
        }
        assert.deepEqual(states, [true, false, true], 'no repeats while the state holds');
    });

    test('an unreachable database drops the points rather than growing without bound', async () => {
        const {fetchImpl} = fakeFetch([new Error('ECONNREFUSED')]);
        const w = createWriter(config, {log: QUIET, fetchImpl});
        w.add('a value=1.0 1');
        await w.flush();
        assert.equal(w.size, 0, 'a database down for a day would otherwise eat the heap');
    });

    test('a rejected write is logged with the status and the body', async () => {
        const lines = [];
        const {fetchImpl} = fakeFetch([400]);
        const w = createWriter(config, {log: {...QUIET, error: (...a) => lines.push(a.join(' '))}, fetchImpl});
        w.add('bad line');
        await w.flush();
        assert.match(lines.join(' '), /influx write failed 400 detail/);
    });

    test('writes are serialised, so points cannot be reordered', async () => {
        let resolveFirst;
        const order = [];
        const fetchImpl = async (url, options) => {
            order.push(options.body);
            if (order.length === 1) {
                await new Promise((r) => {
                    resolveFirst = r;
                });
            }
            return {status: 204, text: async () => ''};
        };
        const tick = () => new Promise((r) => setImmediate(r));
        const w = createWriter(config, {log: QUIET, fetchImpl});
        w.add('first value=1.0 1');
        const a = w.flush();
        await tick();
        assert.deepEqual(order, ['first value=1.0 1'], 'the first write is in flight');
        w.add('second value=1.0 2');
        const b = w.flush();
        await tick();
        assert.deepEqual(order, ['first value=1.0 1'], 'the second waits rather than racing it');
        resolveFirst();
        await Promise.all([a, b]);
        assert.deepEqual(order, ['first value=1.0 1', 'second value=1.0 2']);
    });
});
