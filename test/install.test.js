import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

process.env.INFLUX4MQTT_MQTT_URL ||= 'mqtt://test';
const {unitFile, envFile} = await import('../lib/install.js');
const {OPTIONS, check} = await import('../config.js');
const {SHARED_OPTIONS, configSchema} = await import('mqtt-interfaces-core');
const pkg = (await import('../package.json', {with: {type: 'json'}})).default;

describe('install', () => {
    test('unit uses the shared layout', () => {
        const unit = unitFile('/usr/bin/node /usr/local/lib/node_modules/influx4mqtt/index.js');
        assert.match(unit, /^EnvironmentFile=-\/etc\/mqtt-interfaces\/broker\.env$/m);
        assert.match(unit, /^EnvironmentFile=\/etc\/influx4mqtt\/%i\.env$/m);
        assert.match(unit, /^Environment=INFLUX4MQTT_NAME=%i$/m);
        assert.match(unit, /^SyslogIdentifier=influx4mqtt@%i$/m);
        assert.match(unit, /^Restart=always$/m);
    });

    test('env file carries the options, subscriptions as a list', () => {
        const argv = {
            name: 'influx',
            subscribe: ['+/status/#', '$SYS/#'],
            influxDb: 'mqtt',
            shortenStatus: true,
            mqttUrl: 'mqtt://b',
        };
        Object.defineProperty(argv, '$options', {value: {...OPTIONS, ...SHARED_OPTIONS}});
        const out = envFile(argv);
        assert.match(out, /^INFLUX4MQTT_SUBSCRIBE=\+\/status\/#,\$SYS\/#$/m);
        assert.match(out, /^INFLUX4MQTT_INFLUX_DB=mqtt$/m);
        assert.match(out, /^INFLUX4MQTT_SHORTEN_STATUS=true$/m);
        assert.doesNotMatch(out, /^INFLUX4MQTT_NAME=/m, 'the unit sets the instance name');
    });
});

describe('config', () => {
    test('the schema marks the token secret and describes every option', () => {
        const schema = configSchema({
            pkg,
            envPrefix: 'INFLUX4MQTT',
            options: OPTIONS,
            defaults: {name: 'influx'},
            scriptName: 'influx4mqtt',
        });
        assert.equal(schema.properties['influx-token']['x-secret'], true);
        assert.equal(schema.properties['influx-password']['x-secret'], true);
        assert.equal(schema.properties.subscribe.type, 'array');
        assert.deepEqual(schema.properties['influx-version'].enum, [1, 2]);
        for (const [key, prop] of Object.entries(schema.properties)) {
            assert.ok(prop.description, `${key} has no description — the config ui would show a bare name`);
        }
    });

    test('check refuses values the types cannot catch', () => {
        const ok = {bufLength: 1000, bufInterval: 30, influxVersion: 1, influxUrl: 'http://h:8086', subscribe: ['a/#']};
        assert.equal(check(ok), true);
        assert.throws(() => check({...ok, bufLength: 0}), /--buf-length/);
        assert.throws(() => check({...ok, bufInterval: 0}), /--buf-interval/);
        assert.throws(() => check({...ok, influxUrl: 'h:8086'}), /http/);
        assert.throws(() => check({...ok, influxVersion: 2}), /--influx-token/);
        assert.equal(check({...ok, influxVersion: 2, influxToken: 't'}), true);
    });

    test('check refuses a subscription with # in the middle — the broker would reject it', () => {
        const base = {bufLength: 1, bufInterval: 1, influxVersion: 1, influxUrl: 'http://h'};
        assert.throws(() => check({...base, subscribe: ['a/#/b']}), /# is only allowed as the last level/);
        assert.equal(check({...base, subscribe: ['a/#', '+/status/#', '$SYS/#']}), true);
    });
});
