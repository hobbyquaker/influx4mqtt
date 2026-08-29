/**
 * Adapter options on top of the core's parseConfig(): the shared MQTT / name / maintenance
 * options, INFLUX4MQTT_* environment variables and --config-schema come from
 * mqtt-interfaces-core; only what is specific to recording into InfluxDB is defined here.
 */

import os from 'node:os';
import {parseConfig} from 'mqtt-interfaces-core';
import pkg from './package.json' with {type: 'json'};

export const OPTIONS = {
    subscribe: {
        alias: 's',
        type: 'array',
        describe: 'mqtt topic to record, with + and # wildcards (repeatable)',
        default: ['+/status/#'],
    },
    'influx-url': {
        type: 'string',
        describe: 'influxdb base url',
        default: 'http://127.0.0.1:8086',
    },
    'influx-version': {
        type: 'number',
        describe: 'influxdb api: 1 (/write?db=) or 2 (/api/v2/write, token auth)',
        choices: [1, 2],
        default: 1,
    },
    'influx-db': {
        alias: 'd',
        type: 'string',
        describe: 'database (api 1) or bucket (api 2)',
        default: 'mqtt',
    },
    'influx-org': {
        type: 'string',
        describe: 'influxdb organisation (api 2)',
    },
    'influx-token': {
        type: 'string',
        describe: 'influxdb api token (api 2; also accepted by influxdb 1.8+)',
        secret: true,
    },
    'influx-username': {
        type: 'string',
        describe: 'influxdb username (api 1, http basic auth)',
    },
    'influx-password': {
        type: 'string',
        describe: 'influxdb password (api 1)',
        secret: true,
    },
    'shorten-status': {
        type: 'boolean',
        describe: 'record hm/status/lamp as hm//lamp — the mqtt-smarthome convention',
        default: true,
    },
    'replace-sys': {
        type: 'string',
        describe: '$SYS/ topics are the same on every broker: rewrite the prefix to tell them apart',
        default: `$SYS/${os.hostname()}/`,
    },
    'buf-length': {
        type: 'number',
        describe: 'write to influxdb once this many points are buffered',
        default: 1000,
    },
    'buf-interval': {
        type: 'number',
        describe: 'seconds between writes, however few points are buffered',
        default: 30,
    },
};

/** yargs .check(): value ranges the option types cannot express. */
export function check(argv) {
    if (!(argv.bufLength >= 1)) {
        throw new Error('--buf-length must be >= 1');
    }
    if (!(argv.bufInterval >= 1)) {
        throw new Error('--buf-interval must be >= 1 second');
    }
    if (Number(argv.influxVersion) === 2 && !argv.influxToken) {
        throw new Error('--influx-version 2 needs --influx-token');
    }
    if (!/^https?:\/\//.test(String(argv.influxUrl))) {
        throw new Error('--influx-url must start with http:// or https://');
    }
    for (const topic of argv.subscribe || []) {
        if (!topic || /#.+/.test(topic)) {
            throw new Error(`--subscribe ${topic}: # is only allowed as the last level`);
        }
    }
    return true;
}

export default parseConfig({
    pkg,
    options: OPTIONS,
    defaults: {name: 'influx'},
    check,
    examples: [
        ['$0 -u mqtt://broker', 'record every mqtt-smarthome status topic'],
        ['$0 -u mqtt://broker -s "+/status/#" -s "zigbee2mqtt/+/+"', 'record two topic patterns'],
        ['$0 --influx-version 2 --influx-org home --influx-db mqtt --influx-token …', 'influxdb 2'],
        ['sudo $0 --install -n influx -u mqtt://broker', 'install as service influx4mqtt@influx'],
    ],
});
