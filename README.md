# influx4mqtt

[![mqtt-smarthome](https://img.shields.io/badge/mqtt-smarthome-blue.svg)](https://github.com/mqtt-smarthome/mqtt-smarthome)
[![NPM version](https://badge.fury.io/js/influx4mqtt.svg)](http://badge.fury.io/js/influx4mqtt)
[![Dependency Status](https://img.shields.io/gemnasium/hobbyquaker/influx4mqtt.svg?maxAge=2592000)](https://gemnasium.com/github.com/hobbyquaker/influx4mqtt)
[![Build Status](https://travis-ci.org/hobbyquaker/influx4mqtt.svg?branch=master)](https://travis-ci.org/hobbyquaker/influx4mqtt)
[![XO code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)
[![License][mit-badge]][mit-url]

Insert incoming MQTT values into InfluxDB.

see [https://github.com/mqtt-smarthome/mqtt-smarthome](https://github.com/mqtt-smarthome/mqtt-smarthome)

Removes the mqtt-smarthome `status` from the topic (e.g. `hm/status/lamp` gets replaced by `hm//lamp`). Inserts numeric
value only to InfluxDB, booleans are converted to `0.0` respectively `1.0`. Strings are ignored.


## Install & Usage

`$ sudo npm install -g influx4mqtt`

I suggest to use [pm2](http://pm2.keymetrics.io/) to manage the influx4mqtt process (start on system boot, manage log 
files, ...)


## Command Line Parameters

```
Usage: influx4mqtt [options]
   
Options:
  -n, --name         instance name. used as prefix for connection-state topic
                                                             [default: "influx"]
  -v, --verbosity    possible values: "error", "warn", "info", "debug"
                                                               [default: "info"]
  -u, --url          mqtt broker url. May contain user/password
                                                   [default: "mqtt://127.0.0.1"]
  -k, --insecure     allow ssl connections with invalid certs          [boolean]
  --buf-length       maximum number of buffered messages         [default: 1000]
  --buf-interval     maximum age of buffered messages in seconds   [default: 30]
  --replace-sys      replace $SYS/ by              [default: "$SYS/<hostname>/"]
  -h, --help         Show help                                         [boolean]
  --version          Show version number                               [boolean]
  -s, --subscribe    topics to subscribe to (may be repeated)         [required]
  -i, --influx-host                                       [default: "127.0.0.1"]
  -p, --influx-port                                              [default: 8086]
  -d, --influx-db                                              [default: "mqtt"]
```


## License

MIT © [Sebastian Raff](https://github.com/hobbyquaker)

[mit-badge]: https://img.shields.io/badge/License-MIT-blue.svg?style=flat
[mit-url]: LICENSE

