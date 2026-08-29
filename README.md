# influx4mqtt

[![mqtt-smarthome](https://img.shields.io/badge/mqtt-smarthome-blue.svg)](https://github.com/mqtt-smarthome/mqtt-smarthome)
[![NPM version](https://badge.fury.io/js/influx4mqtt.svg)](http://badge.fury.io/js/influx4mqtt)
[![CI](https://github.com/hobbyquaker/influx4mqtt/actions/workflows/ci.yml/badge.svg)](https://github.com/hobbyquaker/influx4mqtt/actions/workflows/ci.yml)
[![License][mit-badge]][mit-url]

Record MQTT values in InfluxDB — the history behind a Grafana dashboard.

Subscribes to the topics you name, turns each message into one InfluxDB point and writes them in
batches. Numeric values only: booleans and `ON`/`OFF` become `1`/`0`, text is ignored, because a
time series with a string in it is a series InfluxDB will not let you graph.

Built on [mqtt-interfaces-core](https://github.com/hobbyquaker/mqtt-interfaces-core), so it has the
same options, `--install`, `<name>/info` and maintenance topics as the rest of the `xyz2mqtt` fleet.
Works with **InfluxDB 1 and 2**.

## Install

```
npm install -g influx4mqtt
influx4mqtt --mqtt-url mqtt://broker                 # foreground
sudo influx4mqtt --install -n influx -u mqtt://broker   # systemd service influx4mqtt@influx
```

`--install` writes the options to `/etc/influx4mqtt/<name>.env` and enables
`influx4mqtt@<name>.service`. Broker settings shared with the other adapters on the host live in
`/etc/mqtt-interfaces/broker.env`.

### Docker

Multi-arch image (amd64, arm64, armv7):

```
docker run -d --name influx4mqtt --restart unless-stopped \
  -e INFLUX4MQTT_MQTT_URL=mqtt://broker \
  -e INFLUX4MQTT_INFLUX_URL=http://influxdb:8086 \
  -e INFLUX4MQTT_SUBSCRIBE='+/status/#,$SYS/#' \
  ghcr.io/hobbyquaker/influx4mqtt
```

## What gets recorded

Every message on a subscribed topic becomes one point:

| topic                      | payload               | series                     | value                       |
| -------------------------- | --------------------- | -------------------------- | --------------------------- |
| `hm/status/Licht/STATE`    | `21.5`                | `hm//Licht/STATE`          | `21.5`                      |
| `hm/status/Licht/STATE`    | `{"val":21.5,"ts":…}` | `hm//Licht/STATE`          | `21.5` at the device's `ts` |
| `zigbee2mqtt/sensor/state` | `ON`                  | `zigbee2mqtt/sensor/state` | `1`                         |
| `hm/status/mode`           | `auto`                | —                          | not recorded                |

- **The `status` level is collapsed**: `hm/status/lamp` is recorded as `hm//lamp`, the
  mqtt-smarthome convention. `--no-shorten-status` records the full topic instead — but only do
  that on a fresh database, since it renames every series you already have.
- **`{val, ts, lc}` payloads** are recorded at the device's own timestamp, not at arrival time.
- **Retained messages are ignored.** On every reconnect the broker replays the retained value of
  every matching topic; recording those would pile duplicates at the reconnect time rather than
  when the value was measured.
- **`$SYS/` is rewritten** to `$SYS/<hostname>/` by default, because `$SYS` topics are identical on
  every broker and two of them in one database would interleave into nonsense. `--replace-sys`
  chooses the prefix.

## Options

| Option              | Default                 | Meaning                                                 |
| ------------------- | ----------------------- | ------------------------------------------------------- |
| `-s, --subscribe`   | `+/status/#`            | topic to record, `+`/`#` wildcards; repeat for more     |
| `-u, --mqtt-url`    | `mqtt://localhost`      | broker url                                              |
| `-n, --name`        | `influx`                | instance name = topic prefix of its own topics          |
| `--influx-url`      | `http://127.0.0.1:8086` | InfluxDB base url                                       |
| `--influx-version`  | `1`                     | `1` (`/write?db=`) or `2` (`/api/v2/write`, token auth) |
| `-d, --influx-db`   | `mqtt`                  | database (api 1) or bucket (api 2)                      |
| `--influx-org`      |                         | organisation (api 2)                                    |
| `--influx-token`    |                         | api token (api 2; InfluxDB 1.8+ accepts it too)         |
| `--influx-username` |                         | http basic auth (api 1)                                 |
| `--influx-password` |                         | http basic auth (api 1)                                 |
| `--shorten-status`  | `true`                  | record `hm/status/lamp` as `hm//lamp`                   |
| `--replace-sys`     | `$SYS/<hostname>/`      | rewrite the `$SYS/` prefix                              |
| `--buf-length`      | `1000`                  | write once this many points are buffered                |
| `--buf-interval`    | `30`                    | seconds between writes, however few points are buffered |
| `-v, --verbosity`   | `info`                  | `error`, `warn`, `info`, `debug`                        |

Every option is also an environment variable (`INFLUX4MQTT_SUBSCRIBE`, `INFLUX4MQTT_INFLUX_URL`, …);
several subscriptions are comma separated there. `--help` lists the shared options too, and
`--config-schema` prints the JSON Schema a management UI reads.

### InfluxDB 2

```
influx4mqtt -u mqtt://broker \
  --influx-version 2 --influx-url http://influxdb:8086 \
  --influx-org home --influx-db mqtt --influx-token <token>
```

`--influx-db` is the bucket. Put the token in the instance's env file rather than on the command
line, where a process list would show it — `--install` does that for you.

## Topics of its own

| Topic                             | Meaning                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `<name>/connected`                | `2` InfluxDB is accepting writes · `1` broker only · `0` stopped |
| `<name>/info`                     | endpoint, subscriptions, points recorded and skipped             |
| `<name>/maintenance/set/loglevel` | `error` \| `warn` \| `info` \| `debug` at runtime                |
| `<name>/maintenance/set/restart`  | graceful restart                                                 |
| `<name>/maintenance/stats`        | memory, cpu, event loop lag, uptime                              |

A database that is unreachable shows up as `<name>/connected 1`, so a broken recorder is visible
without reading logs.

## License

MIT © [Sebastian Raff](https://github.com/hobbyquaker)

[mit-badge]: https://img.shields.io/badge/License-MIT-blue.svg?style=flat
[mit-url]: LICENSE
