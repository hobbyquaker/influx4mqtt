#!/usr/bin/env node

const Mqtt = require('mqtt');
const request = require('request');
const log = require('yalm');
const pkg = require('./package.json');
const config = require('./config.js');

process.title = pkg.name;

log.setLevel(config.verbosity);

log.info(pkg.name + ' ' + pkg.version + ' starting');

log.info('mqtt connecting', config.url);
const mqtt = Mqtt.connect(config.url, {
    will: {topic: config.name + '/connected', payload: '0', retain: true},
    rejectUnauthorized: !config.insecure
});

if (typeof config.subscribe === 'string') {
    config.subscribe = [config.subscribe];
}

let buffer = [];

let connected;
mqtt.on('connect', () => {
    mqtt.publish(config.name + '/connected', '2', {retain: true});
    connected = true;
    log.info('mqtt connected ' + config.url);

    config.subscribe.forEach(topic => {
        log.info('mqtt subscribe ' + topic);
        mqtt.subscribe(topic);
    });
});

mqtt.on('close', () => {
    if (connected) {
        connected = false;
        log.info('mqtt closed ' + config.url);
    }
});

mqtt.on('error', err => {
    log.error('mqtt', err.message);
});

mqtt.on('message', (topic, payload, msg) => {
    if (msg.retain) {
        return;
    }

    let timestamp = (new Date()).getTime();

    payload = payload.toString();

    const seriesName = topic.replace(/^([^/]+)\/status\/(.+)/, '$1//$2').replace(/^\$SYS\//, config.replaceSys);

    let value;

    if (payload.indexOf('{') === -1) {
        value = payload;
    } else {
        try {
            const tmp = JSON.parse(payload);
            value = tmp.val;
            timestamp = tmp.ts || timestamp;
        } catch (err) {
            value = payload;
        }
    }

    log.debug('<', topic, typeof value, value, payload);

    const valueFloat = parseFloat(value);

    if (value === true || value === 'true') {
        value = '1.0';
    } else if (value === false || value === 'false') {
        value = '0.0';
    } else if (isNaN(valueFloat)) {
        return;
    } else {
        value = String(valueFloat);
        if (!value.match(/\./)) {
            value += '.0';
        }
    }

    log.debug('>', seriesName, value, timestamp);
    buffer.push(seriesName.replace(/ /g, '\\ ').replace(/,/g, '\\,') + ' value=' + value + ' ' + (timestamp * 1000000));
    if (buffer.length > config.bufLength) {
        write();
    }
});

function write() {
    if (buffer.length === 0) {
        return;
    }

    const body = buffer.join('\n');
    buffer = [];

    request.post({
        url: 'http://' + config.influxHost + ':' + config.influxPort + '/write',
        qs: {db: config.influxDb},
        body
    }, (err, res, resBody) => {
        if (err) {
            log.error(err.message);
        } else if (res.statusCode === 204) {
            log.debug('wrote ' + body.length + ' points');
        } else {
            log.error(res.statusCode, resBody);
        }
    });
}

setInterval(write, config.bufInterval * 1000);
