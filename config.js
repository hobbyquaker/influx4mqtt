const os = require('os');
module.exports = require('yargs')
    .usage('Usage: $0 [options]')
    .describe('subscribe', 'topics to subscribe to (may be repeated)')
    .describe('n', 'instance name. used as prefix for connection-state topic')
    .describe('v', 'possible values: "error", "warn", "info", "debug"')
    .describe('u', 'mqtt broker url. May contain user/password')
    .describe('k', 'allow ssl connections with invalid certs')
    .describe('buf-length', 'maximum number of buffered messages')
    .describe('buf-interval', 'maximum age of buffered messages in seconds')
    .describe('replace-sys', 'replace $SYS/ by')
    .describe('h', 'show help')
    .alias({
        s: 'subscribe',
        h: 'help',
        n: 'name',
        u: 'url',
        i: 'influx-host',
        p: 'influx-port',
        d: 'influx-db',
        k: 'insecure',
        v: 'verbosity'

    })
    .demand('subscribe')
    .boolean('insecure')
    .default({
        u: 'mqtt://127.0.0.1',
        n: 'influx',
        v: 'info',
        influxHost: '127.0.0.1',
        influxPort: 8086,
        influxDb: 'mqtt',
        bufLength: 1000,
        bufInterval: 30,
        replaceSys: '$SYS/' + os.hostname() + '/'
    })
    .version()
    .help('help')
    .argv;
