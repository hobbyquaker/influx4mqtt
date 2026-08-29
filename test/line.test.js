/**
 * Topic and payload -> line protocol. The rules that decide what ends up in the database and
 * under which series name, tested without a socket in sight.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {seriesName, toFloat, point, escapeMeasurement} from '../lib/line.js';

describe('seriesName', () => {
    test('the mqtt-smarthome status level collapses to //', () => {
        assert.equal(seriesName('hm/status/Licht Flur/STATE'), 'hm//Licht Flur/STATE');
        assert.equal(seriesName('zigbee2mqtt/status/x'), 'zigbee2mqtt//x');
    });

    test('--no-shorten-status keeps the topic as it is', () => {
        assert.equal(seriesName('hm/status/lamp', {shortenStatus: false}), 'hm/status/lamp');
    });

    test('only the first status level, and only in the second position', () => {
        assert.equal(seriesName('hm/status/a/status/b'), 'hm//a/status/b');
        assert.equal(seriesName('status/x'), 'status/x', 'nothing before it');
        assert.equal(seriesName('a/b/status/c'), 'a/b/status/c', 'not the second level');
    });

    test('$SYS is rewritten so two brokers do not interleave into one series', () => {
        assert.equal(seriesName('$SYS/broker/uptime', {replaceSys: '$SYS/pi/'}), '$SYS/pi/broker/uptime');
        assert.equal(seriesName('$SYS/broker/uptime'), '$SYS/broker/uptime', 'untouched without the option');
        assert.equal(seriesName('a/$SYS/b', {replaceSys: 'X/'}), 'a/$SYS/b', 'only as a prefix');
    });

    test('both rules can apply to one topic', () => {
        assert.equal(seriesName('$SYS/status/x', {replaceSys: '$SYS/pi/'}), '$SYS/pi//x');
    });
});

describe('toFloat', () => {
    test('numbers keep their value and gain a decimal point', () => {
        // without the .0 influx infers an integer field, and the series then rejects the first float
        assert.equal(toFloat(21), '21.0');
        assert.equal(toFloat('21'), '21.0');
        assert.equal(toFloat(21.5), '21.5');
        assert.equal(toFloat('-3'), '-3.0');
        assert.equal(toFloat(0), '0.0');
    });

    test('booleans and the words devices use for them', () => {
        for (const yes of [true, 'true', 'ON', 'on', 'On', 'yes', ' true ']) {
            assert.equal(toFloat(yes), '1.0', String(yes));
        }
        for (const no of [false, 'false', 'OFF', 'off', 'no']) {
            assert.equal(toFloat(no), '0.0', String(no));
        }
    });

    test('anything that is not a number is dropped, not stored as text', () => {
        // a string field would fix the series' type forever
        assert.equal(toFloat('closed'), null);
        assert.equal(toFloat(''), null);
        assert.equal(toFloat(null), null);
        assert.equal(toFloat(undefined), null);
        assert.equal(toFloat({}), null);
        assert.equal(toFloat(Number.NaN), null);
        assert.equal(toFloat(Number.POSITIVE_INFINITY), null);
    });

    test('a number with a unit is not a number', () => {
        // parseFloat would happily return 21 for "21 °C" and record a lie
        assert.equal(toFloat('21 °C'), null);
    });
});

describe('escapeMeasurement', () => {
    test('spaces and commas separate line protocol tokens, so they are escaped', () => {
        assert.equal(escapeMeasurement('hm//Licht Flur/STATE'), 'hm//Licht\\ Flur/STATE');
        assert.equal(escapeMeasurement('a,b'), 'a\\,b');
        assert.equal(escapeMeasurement('a, b'), 'a\\,\\ b');
    });
});

describe('point', () => {
    test('measurement, value and a nanosecond timestamp', () => {
        assert.equal(point('hm//lamp', 21.5, 1700000000000), 'hm//lamp value=21.5 1700000000000000000');
    });

    test('a non-numeric value produces no point at all', () => {
        assert.equal(point('hm//lamp', 'closed', 1700000000000), null);
    });

    test('an empty measurement produces no point', () => {
        assert.equal(point('', 1, 1700000000000), null);
    });

    test('the measurement is escaped', () => {
        assert.match(point('a b', 1, 1700000000000), /^a\\ b value=1\.0 /);
    });
});
