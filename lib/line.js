/**
 * Topic and payload → one InfluxDB line-protocol point. Pure: no sockets, no config object, so
 * every rule below is testable on its own.
 *
 * The measurement is the topic, lightly rewritten (see `seriesName`); the only field is `value`,
 * always a float, because a series whose type changes is a series Influx will refuse to write.
 */

/** Line protocol escapes in a measurement name: spaces and commas separate tokens. */
export function escapeMeasurement(name) {
    return name.replace(/,/g, '\\,').replace(/ /g, '\\ ');
}

/**
 * The series a topic is recorded under.
 *
 * `shortenStatus` collapses the mqtt-smarthome `status` level — `hm/status/lamp` becomes
 * `hm//lamp`. It has been the behaviour since 1.0 and stays the default: turning it off renames
 * every existing series and splits the history in Grafana. New setups may prefer the full topic.
 *
 * `replaceSys` rewrites the leading `$SYS/`, whose topics are otherwise identical on every broker
 * — recording two of them into one database would interleave them into nonsense.
 *
 * @param {string} topic
 * @param {{shortenStatus?: boolean, replaceSys?: string}} [options]
 */
export function seriesName(topic, {shortenStatus = true, replaceSys} = {}) {
    let name = topic;
    if (shortenStatus) {
        name = name.replace(/^([^/]+)\/status\/(.+)$/, '$1//$2');
    }
    if (replaceSys) {
        name = name.replace(/^\$SYS\//, replaceSys);
    }
    return name;
}

/** Payloads that mean true / false rather than a number. Case-insensitive since 2.0. */
const TRUE = new Set(['true', 'on', 'yes']);
const FALSE = new Set(['false', 'off', 'no']);

/**
 * A value → the float Influx stores, as a string, or `null` for anything that is not a number.
 *
 * Booleans and the strings devices use for them become `1`/`0`; everything else has to parse as a
 * number. Text is dropped rather than stored — this is a numeric time series, and a string field
 * would fix the series' type to string forever.
 *
 * The trailing `.0` is deliberate: without it Influx infers an integer field, and a series that
 * starts out integer rejects the first float that arrives.
 *
 * @returns {string|null}
 */
export function toFloat(value) {
    if (value === true) {
        return '1.0';
    }
    if (value === false) {
        return '0.0';
    }
    let number;
    if (typeof value === 'number') {
        number = value;
    } else if (typeof value === 'string') {
        const trimmed = value.trim();
        const lower = trimmed.toLowerCase();
        if (TRUE.has(lower)) {
            return '1.0';
        }
        if (FALSE.has(lower)) {
            return '0.0';
        }
        if (trimmed === '') {
            return null;
        }
        /*
         * Number(), not parseFloat(): parseFloat('21 °C') is 21, and recording that as a
         * temperature is worse than recording nothing — it looks like a real measurement. The
         * empty string is handled above because Number('') is 0, not NaN.
         */
        number = Number(trimmed);
    } else {
        // objects, null, undefined: Number(null) is 0 and Number([5]) is 5, so never fall through
        return null;
    }
    if (!Number.isFinite(number)) {
        return null;
    }
    const text = String(number);
    return /[.e]/i.test(text) ? text : text + '.0';
}

/**
 * One line-protocol point, or `null` when the value is not numeric.
 *
 * @param {string} series measurement name (already rewritten by `seriesName`)
 * @param {*} value
 * @param {number} timestampMs
 */
export function point(series, value, timestampMs) {
    const float = toFloat(value);
    if (float === null || !series) {
        return null;
    }
    // influx takes nanoseconds; the timestamp is milliseconds, from the payload or our clock
    return `${escapeMeasurement(series)} value=${float} ${Math.round(timestampMs) * 1000000}`;
}
