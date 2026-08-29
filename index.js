#!/usr/bin/env node

/**
 * influx4mqtt — record MQTT values in InfluxDB, on mqtt-interfaces-core.
 *
 * A *sink*: unlike a device adapter it has no device of its own, its subject is what every other
 * adapter publishes. The core's `listen` gives it the subscriptions (absolute topics, not under
 * `<name>/`); lib/line.js turns a message into a point and lib/influx.js writes them in batches.
 *
 * `<name>/connected` reports 2 while InfluxDB is accepting writes and 1 while it is not, so a
 * database that is down is visible on the broker rather than only in the log.
 */

import {createAdapter} from 'mqtt-interfaces-core';
import config from './config.js';
import pkg from './package.json' with {type: 'json'};
import {handle as handleInstall} from './lib/install.js';
import {seriesName, point} from './lib/line.js';
import {createWriter} from './lib/influx.js';

handleInstall(config); // --install / --uninstall never reach the rest

let writer;
let recorded = 0;
let skipped = 0;

/**
 * One message -> at most one point.
 *
 * Retained messages are ignored: on every (re)connect the broker replays the retained value of
 * every matching topic, and recording those would put a burst of duplicates at the reconnect time
 * rather than at the time the value was actually measured.
 */
function record(topic, value, raw, packet) {
    if (packet.retain) {
        return;
    }
    // {val, ts, lc} payloads carry the device's own time; parsePayload gave us the value, the
    // timestamp has to come out of the raw payload
    let timestamp = Date.now();
    if (raw.includes('{')) {
        try {
            const json = JSON.parse(raw);
            if (json && typeof json === 'object' && Number(json.ts) > 0) {
                timestamp = Number(json.ts);
            }
        } catch {
            // not JSON after all; our clock it is
        }
    }
    const series = seriesName(topic, {shortenStatus: config.shortenStatus, replaceSys: config.replaceSys});
    const line = point(series, value, timestamp);
    if (!line) {
        skipped++; // text, or a payload that is not a number - not a time series
        return;
    }
    recorded++;
    writer.add(line);
}

const adapter = createAdapter({
    pkg,
    config,
    deviceLabel: 'influx',
    info: () => ({
        influx: writer ? writer.url : undefined,
        api: config.influxVersion,
        db: config.influxDb,
        subscribe: config.subscribe,
        buffered: writer ? writer.size : 0,
        recorded,
        skipped,
    }),
    // a sink: the topics are the user's, anywhere on the broker, not under <name>/
    listen: Object.fromEntries(config.subscribe.map((topic) => [topic, record])),
    onShutdown: () => writer.stop(),
});

writer = createWriter(config, {
    log: adapter.log,
    // <name>/connected 2 while influx accepts writes, 1 while it does not
    onState: (up) => adapter.setDeviceConnected(up),
});

adapter.log.info(`influxdb api ${config.influxVersion} at ${writer.url}`);
writer.start();
adapter.start();
