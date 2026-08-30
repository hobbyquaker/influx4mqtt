# Changelog

## 2.0.1

### Fixed

- `--json-payloads`, `--ha-discovery` and `--ha-prefix` are gone. They are shared options every
  adapter got from the core, and all three configured nothing here: this is a sink, so it never
  publishes a status item and announces no Home Assistant entities — it forwards messages to
  InfluxDB. Offered anyway, they appeared in `--help` and in a config UI's form, where they
  invited configuring behaviour that does not exist. Needs mqtt-interfaces-core 0.15.0.

## 2.0.0

A rewrite on [mqtt-interfaces-core](https://github.com/hobbyquaker/mqtt-interfaces-core). The
recording rules are unchanged unless listed under **Breaking** — existing series keep their names.

### Breaking

- **Node ≥ 20.19** and ESM. The 1.x dependencies are gone: `request` (deprecated since 2020),
  `yalm` and a five-year-old `mqtt` are replaced by the core and the platform's own `fetch`.
- **`--influx-host` / `--influx-port` are replaced by `--influx-url`**, which also allows https and
  a path prefix: `--influx-url http://127.0.0.1:8086`. The default is the same host and port as
  before.
- **Values with a unit are no longer recorded.** `parseFloat('21 °C')` returned `21` and stored it
  as a measurement; a gap is better than a plausible-looking wrong number. Plain numeric strings,
  booleans and `ON`/`OFF` are unaffected.
- `--subscribe` now defaults to `+/status/#` instead of being mandatory, so the adapter starts with
  a sensible recording set.

### Added

- **InfluxDB 2** — `--influx-version 2` writes to `/api/v2/write` with `--influx-org`,
  `--influx-db` as the bucket and `--influx-token`. Version 1 stays the default and is unchanged
  (`/write?db=`), now with optional `--influx-username` / `--influx-password`.
- **`--shorten-status`** makes the mqtt-smarthome `hm/status/lamp` → `hm//lamp` rewrite optional.
  It stays **on** by default: turning it off renames every existing series and splits the history.
- **`--install` / `--uninstall`** as the systemd template unit `influx4mqtt@<name>`, with the
  instance config in `/etc/influx4mqtt/<name>.env` and the shared broker settings in
  `/etc/mqtt-interfaces/broker.env`.
- **`--config-schema`** so a management UI (she) can offer the options, with the token and password
  marked secret.
- `<name>/connected` reports **2 while InfluxDB is accepting writes and 1 while it is not**, so a
  database that is down is visible on the broker and not only in the log. Plus `<name>/info`
  (endpoint, subscriptions, points recorded and skipped), `<name>/maintenance/set/loglevel` and
  `…/restart`, and `<name>/maintenance/stats`.
- **The buffer is flushed on shutdown.** 1.x wrote only on its interval, so a restart dropped up to
  `--buf-interval` seconds of points.
- Multi-arch Docker images on `ghcr.io/hobbyquaker/influx4mqtt` (amd64, arm64, armv7).
- 44 unit tests, CI on Node 20/22/24.

### Fixed

- Writes are serialised, so a slow write can no longer be overtaken by the next one and reorder
  points.
- A write that fails with 4xx is logged with the status and the body instead of being retried
  forever with the same rejected line.
