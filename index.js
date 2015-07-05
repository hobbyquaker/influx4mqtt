#!/usr/bin/env node
var pkg =   require('./package.json');
var config = require('yargs')
    .usage(pkg.name + ' ' + pkg.version + '\n' + pkg.description + '\n\nUsage: $0 [options]')
    .describe('v', 'possible values: "error", "warn", "info", "debug"')
    .describe('n', 'instance name. used as mqtt client id and as prefix for connection-state topic')
    .describe('u', 'mqtt broker url. See https://github.com/mqttjs/MQTT.js#connect-using-a-url')
    .describe('h', 'show help')
    .alias({
        'c': 'config',
        'h': 'help',
        'n': 'name',
        'u': 'url',
        'v': 'verbosity',
        'i': 'influx-host',
        'p': 'influx-port',
        'd': 'influx-db'

    })
    .default({
        'u': 'mqtt://127.0.0.1',
        'n': 'influx',
        'v': 'info',
        'influx': false,
        'influx-host': '127.0.0.1',
        'influx-port': 8086,
        'influx-db': 'mqtt'
    })
    .config('config')
    .version(pkg.name + ' ' + pkg.version + '\n', 'version')
    .help('help')
    .argv;

console.log('mqtt connecting', config.url);
var mqtt = require('mqtt').connect(config.url, {will: {topic: config.name + '/connected', payload: '0'}});
mqtt.publish(config.name + '/connected', '2');

var subscriptions = [ // Todo command line param
    '+/status/#',
    '+/connected'
];

console.log('connecting InfluxDB', config['influx-host']);
var influx = require('influx')({
    host: config['influx-host'] || '127.0.0.1',
    port: config['influx-port'] || 8086, // optional, default 8086
    protocol: 'http', // optional, default 'http' // todo command line param
    //username: 'dbuser', // todo command line param
    //password: 'f4ncyp4ass', // todo command line param
    database: config['influx-db'] || 'mqtt'
});

var buffer = {};
var bufferCount = 0;

var connected;
mqtt.on('connect', function () {
    connected = true;
    console.log('mqtt connected ' + config.url);

    subscriptions.forEach(function (subs) {
        console.log('mqtt subscribe ' + subs);
        mqtt.subscribe(subs);
    });
});


mqtt.on('close', function () {
    if (connected) {
        connected = false;
        console.log('mqtt closed ' + config.url);
    }
});

mqtt.on('error', function () {
    console.error('mqtt error ' + config.url);
});


mqtt.on('message', function (topic, payload, msg) {

    if (msg.retain) return;

    var timestamp = (new Date()).getTime();

    payload = payload.toString();

    var seriesName = topic.replace(/^([^\/]+)\/status\/(.+)/, '$1//$2');

    var value;

    try {
        var tmp = JSON.parse(payload);
        value = tmp.val;
        timestamp = tmp.ts || timestamp;
    } catch (e) {
        value = payload;
    }
    var valueFloat = parseFloat(value);

    if (value === true || value === 'true') {
        value = '1.0';
    } else if (value === false || value === 'false') {
        value = '0.0';
    } else if (isNaN(valueFloat)) {
        return; // FIXME do we need strings? Creating a field as string leads to errors when trying to write float on it. Can we expect topics to be of the same type always?
        value = '"' + value + '"';
    } else {
        value = '' + valueFloat;
        if (!value.match(/\./)) value = value + '.0';
    }

    //console.log(seriesName, value, timestamp, tmp.ts);
    if (!buffer[seriesName]) buffer[seriesName] = [];
    buffer[seriesName].push([{value: value, time: timestamp}]);
    bufferCount += 1;
    if (bufferCount > 1000) write(); // todo command line param

});

function write() {
    if (!bufferCount) return;
    //console.log('write', bufferCount);
    influx.writeSeries(buffer, {}, function (err, res) {
        if (err) console.error('error', err);
    });
    buffer = {};
    bufferCount = 0;
}

setInterval(write, 30000); // todo command line param
