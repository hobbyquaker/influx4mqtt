/**
 * End to end through the real core: a message arrives on the broker, a point lands in the write
 * buffer. This is where the pieces meet — the `listen` subscriptions, the retained-message rule,
 * the device-side timestamp and the reachability that reaches <name>/connected.
 *
 * Only the mqtt client and fetch are faked.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';

import {createAdapter, createLogger} from 'mqtt-interfaces-core';
import {seriesName, point} from '../lib/line.js';
import {createWriter} from '../lib/influx.js';

const pkg = {name: 'influx4mqtt', version: '2.0.0'};

class FakeMqtt extends EventEmitter {
    constructor() {
        super();
        this.subscribed = [];
        this.published = [];
    }
    subscribe(topics) {
        this.subscribed.push(...[].concat(topics));
    }
    publish(topic, payload) {
        this.published.push({topic, payload: String(payload)});
    }
    end(force, opts, cb) {
        if (cb) cb();
    }
    deliver(topic, payload, packet = {}) {
        this.emit('message', topic, Buffer.from(String(payload)), packet);
    }
    last(topic) {
        const hits = this.published.filter((p) => p.topic === topic);
        return hits.length > 0 ? hits.at(-1) : undefined;
    }
}

/** The adapter as index.js builds it, with the same record() logic. */
function setup(configOverrides = {}, {statuses = []} = {}) {
    const client = new FakeMqtt();
    const lines = [];
    const written = [];
    const queue = [...statuses];
    const config = {
        name: 'influx',
        mqttUrl: 'mqtt://test',
        jsonPayloads: true,
        haDiscovery: false,
        maintenance: true,
        verbosity: 'debug',
        statsInterval: 0,
        subscribe: ['+/status/#', '$SYS/#'],
        influxUrl: 'http://h:8086',
        influxVersion: 1,
        influxDb: 'mqtt',
        shortenStatus: true,
        replaceSys: '$SYS/pi/',
        bufLength: 1000,
        bufInterval: 30,
        ...configOverrides,
    };
    let writer;
    const record = (topic, value, raw, packet) => {
        if (packet.retain) return;
        let timestamp = 1700000000000;
        if (raw.includes('{')) {
            try {
                const json = JSON.parse(raw);
                if (json && typeof json === 'object' && Number(json.ts) > 0) timestamp = Number(json.ts);
            } catch {
                /* not json */
            }
        }
        const line = point(
            seriesName(topic, {shortenStatus: config.shortenStatus, replaceSys: config.replaceSys}),
            value,
            timestamp,
        );
        if (line) writer.add(line);
    };
    const adapter = createAdapter({
        pkg,
        config,
        log: createLogger({format: 'journal', level: 'debug', write: (l) => lines.push(l)}),
        deviceLabel: 'influx',
        listen: Object.fromEntries(config.subscribe.map((t) => [t, record])),
        mqttConnect: () => client,
        onShutdown: () => writer.stop(),
    });
    writer = createWriter(config, {
        log: {debug() {}, info() {}, warn() {}, error() {}},
        onState: (up) => adapter.setDeviceConnected(up),
        fetchImpl: async (url, options) => {
            written.push(options.body);
            const next = queue.length > 0 ? queue.shift() : 204;
            if (next instanceof Error) throw next;
            return {status: next, text: async () => ''};
        },
    });
    const onSpy = process.on;
    process.on = () => process;
    adapter.start();
    process.on = onSpy;
    return {client, adapter, writer, written, lines, config};
}

describe('recording', () => {
    test('the configured patterns are subscribed as given, not under influx/', () => {
        const {client} = setup();
        client.emit('connect');
        assert.ok(client.subscribed.includes('+/status/#'));
        assert.ok(client.subscribed.includes('$SYS/#'));
        assert.ok(client.subscribed.includes('influx/set/#'), 'its own topics too');
    });

    test('a value becomes a point under the shortened series name', async () => {
        const {client, writer, written} = setup();
        client.emit('connect');
        client.deliver('hm/status/Licht/STATE', '21.5');
        await writer.flush();
        assert.deepEqual(written, ['hm//Licht/STATE value=21.5 1700000000000000000']);
    });

    test('a {val, ts} payload is recorded at the device’s time, not ours', async () => {
        const {client, writer, written} = setup();
        client.emit('connect');
        client.deliver('hm/status/T', '{"val": 19, "ts": 1699999999000}');
        await writer.flush();
        assert.deepEqual(written, ['hm//T value=19.0 1699999999000000000']);
    });

    test('retained messages are ignored — a reconnect must not backfill duplicates', async () => {
        const {client, writer, written} = setup();
        client.emit('connect');
        client.deliver('hm/status/T', '21', {retain: true});
        await writer.flush();
        assert.deepEqual(written, []);
    });

    test('text is dropped, numbers beside it are still recorded', async () => {
        const {client, writer, written} = setup();
        client.emit('connect');
        client.deliver('hm/status/mode', 'auto');
        client.deliver('hm/status/T', '3');
        await writer.flush();
        assert.deepEqual(written, ['hm//T value=3.0 1700000000000000000']);
    });

    test('$SYS is rewritten so two brokers stay apart', async () => {
        const {client, writer, written} = setup();
        client.emit('connect');
        client.deliver('$SYS/broker/uptime', '4200');
        await writer.flush();
        assert.match(written[0], /^\$SYS\/pi\/broker\/uptime value=4200\.0 /);
    });

    test('--no-shorten-status records the whole topic', async () => {
        const {client, writer, written} = setup({shortenStatus: false});
        client.emit('connect');
        client.deliver('hm/status/T', '1');
        await writer.flush();
        assert.match(written[0], /^hm\/status\/T value=1\.0 /);
    });

    test('influx down → connected 1, back up → 2', async () => {
        const {client, writer} = setup({}, {statuses: [new Error('ECONNREFUSED'), 204]});
        client.emit('connect');
        assert.equal(client.last('influx/connected').payload, '1');
        client.deliver('hm/status/T', '1');
        await writer.flush();
        assert.equal(client.last('influx/connected').payload, '1', 'still down');
        client.deliver('hm/status/T', '2');
        await writer.flush();
        assert.equal(client.last('influx/connected').payload, '2', 'influx accepted the write');
    });

    test('the adapter’s own set topic is acted on, not recorded', async () => {
        const {client, writer, written} = setup({subscribe: ['+/+/#']});
        client.emit('connect');
        client.deliver('influx/maintenance/set/loglevel', 'warn');
        await writer.flush();
        assert.deepEqual(written, [], 'maintenance is a command, not traffic to record');
    });
});
