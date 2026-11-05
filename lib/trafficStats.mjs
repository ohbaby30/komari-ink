// Native ES module adapted from ohbaby30/Komari-Theme-luminaCustom af08483.
export const TRAFFIC_UP_METRIC = "traffic.up";
export const TRAFFIC_DOWN_METRIC = "traffic.down";
export const RATE_UP_METRIC = "net.out.rate";
export const RATE_DOWN_METRIC = "net.in.rate";
export const TODAY_TRAFFIC_METRIC_KEYS = [
    TRAFFIC_UP_METRIC,
    TRAFFIC_DOWN_METRIC,
    RATE_UP_METRIC,
    RATE_DOWN_METRIC,
];
export const TODAY_TRAFFIC_AGGREGATION = {
    [TRAFFIC_UP_METRIC]: "sum",
    [TRAFFIC_DOWN_METRIC]: "sum",
    [RATE_UP_METRIC]: "max",
    [RATE_DOWN_METRIC]: "max",
};
function emptyStat(uuid) {
    return {
        uuid,
        trafficUp: 0,
        trafficDown: 0,
        peakUp: 0,
        peakUpAt: null,
        peakDown: 0,
        peakDownAt: null,
        sampleCount: 0,
        hasSamples: false,
    };
}
function validPoint(point) {
    return point.count > 0 && point.value != null && Number.isFinite(point.value);
}
export function summarizeTodayTrafficMetrics(series, uuids) {
    const stats = new Map(uuids.map((uuid) => [uuid, emptyStat(uuid)]));
    const sampleTimes = new Map(uuids.map((uuid) => [uuid, new Set()]));
    for (const item of series) {
        const stat = stats.get(item.client);
        if (!stat)
            continue;
        for (const point of item.points) {
            if (!validPoint(point))
                continue;
            const timeMs = Date.parse(point.time);
            if (!Number.isFinite(timeMs))
                continue;
            const value = Math.max(0, point.value ?? 0);
            sampleTimes.get(item.client)?.add(timeMs);
            stat.hasSamples = true;
            switch (item.metricKey) {
                case TRAFFIC_UP_METRIC:
                    stat.trafficUp += value;
                    break;
                case TRAFFIC_DOWN_METRIC:
                    stat.trafficDown += value;
                    break;
                case RATE_UP_METRIC:
                    if (value > stat.peakUp || stat.peakUpAt == null) {
                        stat.peakUp = value;
                        stat.peakUpAt = timeMs;
                    }
                    break;
                case RATE_DOWN_METRIC:
                    if (value > stat.peakDown || stat.peakDownAt == null) {
                        stat.peakDown = value;
                        stat.peakDownAt = timeMs;
                    }
                    break;
            }
        }
    }
    for (const [uuid, stat] of stats) {
        stat.sampleCount = sampleTimes.get(uuid)?.size ?? 0;
    }
    return [...stats.values()];
}
export function buildTodayTrafficMetricSamples(series, uuid) {
    const samples = new Map();
    for (const item of series) {
        if (item.client !== uuid ||
            (item.metricKey !== RATE_UP_METRIC && item.metricKey !== RATE_DOWN_METRIC)) {
            continue;
        }
        for (const point of item.points) {
            if (!validPoint(point))
                continue;
            const timeMs = Date.parse(point.time);
            if (!Number.isFinite(timeMs))
                continue;
            const sample = samples.get(timeMs) ?? { timeMs, up: 0, down: 0 };
            if (item.metricKey === RATE_UP_METRIC)
                sample.up = Math.max(0, point.value ?? 0);
            else
                sample.down = Math.max(0, point.value ?? 0);
            samples.set(timeMs, sample);
        }
    }
    return [...samples.values()].sort((left, right) => right.timeMs - left.timeMs);
}
function recordTimeMs(record) {
    if (typeof record.time === "number") {
        return record.time > 1_000_000_000_000 ? record.time : record.time * 1000;
    }
    return Date.parse(record.time);
}
function counterDelta(current, previous) {
    if (!Number.isFinite(current) || current < 0)
        return 0;
    if (!Number.isFinite(previous) || previous < 0)
        return 0;
    return current >= previous ? current - previous : current;
}
export function summarizeTodayTrafficRecords(uuid, records, startMs, endMs) {
    const stat = emptyStat(uuid);
    const sorted = records
        .map((record) => ({ record, timeMs: recordTimeMs(record) }))
        .filter(({ timeMs }) => Number.isFinite(timeMs) && timeMs <= endMs)
        .sort((left, right) => left.timeMs - right.timeMs);
    let previous = null;
    for (const item of sorted) {
        const { record, timeMs } = item;
        if (timeMs < startMs) {
            previous = record;
            continue;
        }
        stat.hasSamples = true;
        stat.sampleCount += 1;
        if (previous) {
            stat.trafficUp += counterDelta(record.net_total_up, previous.net_total_up);
            stat.trafficDown += counterDelta(record.net_total_down, previous.net_total_down);
        }
        if (record.net_out > stat.peakUp || stat.peakUpAt == null) {
            stat.peakUp = Math.max(0, record.net_out);
            stat.peakUpAt = timeMs;
        }
        if (record.net_in > stat.peakDown || stat.peakDownAt == null) {
            stat.peakDown = Math.max(0, record.net_in);
            stat.peakDownAt = timeMs;
        }
        previous = record;
    }
    return stat;
}
export function buildTodayTrafficRecordSamples(records, startMs, endMs) {
    return records
        .map((record) => ({ record, timeMs: recordTimeMs(record) }))
        .filter(({ timeMs }) => Number.isFinite(timeMs) && timeMs >= startMs && timeMs <= endMs)
        .map(({ record, timeMs }) => ({
        timeMs,
        up: Math.max(0, Number.isFinite(record.net_out) ? record.net_out : 0),
        down: Math.max(0, Number.isFinite(record.net_in) ? record.net_in : 0),
    }))
        .sort((left, right) => right.timeMs - left.timeMs);
}
