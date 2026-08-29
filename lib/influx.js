/**
 * The InfluxDB write client: where the points go and how the request is authenticated.
 *
 * InfluxDB 1 and 2 speak the same line protocol — only the endpoint and the auth differ, which is
 * why one adapter can serve both and `--influx-version` is all it takes:
 *
 *   v1   POST <url>/write?db=<db>&precision=ns            optional HTTP basic auth
 *   v2   POST <url>/api/v2/write?org=<org>&bucket=<db>&precision=ns   Authorization: Token <token>
 *
 * InfluxDB 2 also serves the v1 endpoint for compatibility, so `--influx-version 1` against a v2
 * server works if a v1 mapping was set up there; `2` is the native path and the one to prefer.
 *
 * Points are buffered because one HTTP request per MQTT message would be absurd at the rate a
 * smart home publishes. The buffer is flushed when it is full, on a timer, and on shutdown — the
 * last one is why this takes the adapter's lifecycle rather than a bare `setInterval`.
 */

/** The URL a write goes to, query string included. */
export function writeUrl({influxUrl, influxVersion = 1, influxDb, influxOrg}) {
    const base = String(influxUrl).replace(/\/+$/, '');
    const q = new URLSearchParams({precision: 'ns'});
    if (Number(influxVersion) === 2) {
        q.set('bucket', influxDb);
        if (influxOrg) {
            q.set('org', influxOrg);
        }
        return `${base}/api/v2/write?${q}`;
    }
    q.set('db', influxDb);
    return `${base}/write?${q}`;
}

/** Auth and content headers for a write. The api version does not matter here — a token is
 * accepted by both, so only which credential was given decides the scheme. */
export function writeHeaders({influxToken, influxUsername, influxPassword}) {
    const headers = {'content-type': 'text/plain; charset=utf-8'};
    if (influxToken) {
        // v2's scheme, and accepted by v1.8+ as well
        headers.authorization = `Token ${influxToken}`;
    } else if (influxUsername) {
        const basic = Buffer.from(`${influxUsername}:${influxPassword || ''}`).toString('base64');
        headers.authorization = `Basic ${basic}`;
    }
    return headers;
}

/**
 * A buffer of line-protocol points that writes itself out.
 *
 * @param {object} config parsed config (influxUrl, influxVersion, influxDb, influxOrg, credentials,
 *        bufLength, bufInterval)
 * @param {{log?: object, fetchImpl?: Function, onState?: (up: boolean) => void}} [deps]
 *        `onState` reports reachability, so the adapter can put it in <name>/connected
 */
export function createWriter(config, {log = console, fetchImpl = globalThis.fetch, onState} = {}) {
    const url = writeUrl(config);
    const headers = writeHeaders(config);
    const max = Number(config.bufLength) > 0 ? Number(config.bufLength) : 1000;
    let buffer = [];
    let timer = null;
    let up = null;
    let inFlight = null;

    function state(next) {
        if (next !== up) {
            up = next;
            if (onState) {
                onState(next);
            }
        }
    }

    async function send(lines) {
        const body = lines.join('\n');
        let response;
        try {
            response = await fetchImpl(url, {method: 'POST', headers, body});
        } catch (error) {
            // unreachable: the points are gone. Keeping them would grow without bound while a
            // database is down for a day, and a gap is the honest outcome for a time series.
            log.warn('influx unreachable —', error.message, `(${lines.length} points dropped)`);
            state(false);
            return false;
        }
        if (response.status === 204 || response.status === 200) {
            log.debug('influx wrote', lines.length, 'points');
            state(true);
            return true;
        }
        let detail = '';
        try {
            detail = (await response.text()).slice(0, 300);
        } catch {
            // a body we cannot read changes nothing about the status
        }
        // 4xx is our own line protocol being wrong: the same points would fail again, so they go
        log.error('influx write failed', response.status, detail);
        state(response.status < 500);
        return false;
    }

    /** Write everything buffered. Serialised: two overlapping writes could reorder points. */
    function flush() {
        if (buffer.length === 0) {
            return inFlight || Promise.resolve(true);
        }
        const lines = buffer;
        buffer = [];
        inFlight = Promise.resolve(inFlight)
            .catch(() => {})
            .then(() => send(lines));
        return inFlight;
    }

    return {
        /** Buffer one point; writes early when the buffer is full. */
        add(line) {
            buffer.push(line);
            if (buffer.length >= max) {
                flush();
            }
        },
        flush,
        get size() {
            return buffer.length;
        },
        get url() {
            return url;
        },
        start() {
            const seconds = Number(config.bufInterval) > 0 ? Number(config.bufInterval) : 30;
            timer = setInterval(flush, seconds * 1000);
            if (timer.unref) {
                timer.unref(); // the mqtt connection keeps the process alive, not this
            }
        },
        async stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            await flush(); // whatever is buffered on SIGTERM would otherwise be lost
        },
    };
}
