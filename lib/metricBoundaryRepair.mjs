// Native ES module adapted from LuminaCustom af08483.
const RAW_RETENTION_MS = 15 * 60 * 1000;
const COMPACTION_INTERVAL_MS = 5 * 60 * 1000;
const BOUNDARY_MARGIN_MS = 60 * 1000;
function seriesKey(series) {
    const tags = Object.entries(series.tags ?? {}).sort(([left], [right]) => left.localeCompare(right));
    return `${series.metricKey}\u0000${series.client}\u0000${JSON.stringify(tags)}`;
}
function pointTimeMs(point) {
    return Date.parse(point.time);
}
function isUsableAggregatePoint(point) {
    return point.count > 0 && point.value != null && Number.isFinite(point.value);
}
function overlapsRange(startMs, endMs, range) {
    return startMs < range.endMs && endMs > range.startMs;
}
export function getMetricBoundaryRepairRange(rangeStartMs, rangeEndMs) {
    if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs))
        return null;
    const boundaryMs = rangeEndMs - RAW_RETENTION_MS;
    if (rangeStartMs >= boundaryMs)
        return null;
    const startMs = Math.max(rangeStartMs, boundaryMs - COMPACTION_INTERVAL_MS);
    const endMs = Math.min(rangeEndMs, boundaryMs + BOUNDARY_MARGIN_MS);
    return endMs > startMs ? { startMs, endMs } : null;
}
export function hasMetricBoundaryGap(series, range) {
    for (const item of series) {
        const intervalMs = (item.intervalSeconds ?? 0) * 1000;
        if (!Number.isFinite(intervalMs) || intervalMs <= 0)
            continue;
        const populatedTimes = [];
        for (const point of item.points) {
            const timeMs = pointTimeMs(point);
            if (!Number.isFinite(timeMs))
                continue;
            if (isUsableAggregatePoint(point)) {
                populatedTimes.push(timeMs);
            }
            else if (overlapsRange(timeMs, timeMs + intervalMs, range)) {
                return true;
            }
        }
        populatedTimes.sort((left, right) => left - right);
        for (let index = 1; index < populatedTimes.length; index += 1) {
            const previous = populatedTimes[index - 1];
            const current = populatedTimes[index];
            if (current - previous > intervalMs * 1.5 &&
                overlapsRange(previous + intervalMs, current, range)) {
                return true;
            }
        }
    }
    return false;
}
function aggregateRawPoints(points, aggregation) {
    const valid = points
        .map((point) => ({ point, timeMs: pointTimeMs(point) }))
        .filter(({ point, timeMs }) => Number.isFinite(timeMs) && point.value != null && Number.isFinite(point.value))
        .sort((left, right) => left.timeMs - right.timeMs);
    if (valid.length === 0)
        return null;
    const values = valid.map((item) => item.point.value ?? 0);
    const value = aggregation === "last"
        ? values[values.length - 1]
        : aggregation === "sum"
            ? values.reduce((sum, current) => sum + current, 0)
            : aggregation === "max"
                ? Math.max(...values)
                : values.reduce((sum, current) => sum + current, 0) / values.length;
    return {
        time: valid[0].point.time,
        value,
        count: valid.length,
    };
}
export function fillMetricBoundaryGaps(aggregateSeries, rawSeries, aggregationByMetric = {}) {
    const rawBySeries = new Map(rawSeries.map((item) => [seriesKey(item), item]));
    const output = [];
    const seen = new Set();
    let repairedSamples = 0;
    const repairOne = (aggregate, raw) => {
        const intervalSeconds = aggregate?.intervalSeconds ?? raw.intervalSeconds ?? 0;
        const intervalMs = intervalSeconds * 1000;
        if (!Number.isFinite(intervalMs) || intervalMs <= 0)
            return aggregate ?? raw;
        const points = [...(aggregate?.points ?? [])];
        const pointIndexByBucket = new Map();
        for (let index = 0; index < points.length; index += 1) {
            const timeMs = pointTimeMs(points[index]);
            if (Number.isFinite(timeMs)) {
                pointIndexByBucket.set(Math.floor(timeMs / intervalMs) * intervalMs, index);
            }
        }
        const rawBuckets = new Map();
        for (const point of raw.points) {
            const timeMs = pointTimeMs(point);
            if (!Number.isFinite(timeMs))
                continue;
            const bucketMs = Math.floor(timeMs / intervalMs) * intervalMs;
            const current = rawBuckets.get(bucketMs);
            if (current)
                current.push(point);
            else
                rawBuckets.set(bucketMs, [point]);
        }
        for (const [bucketMs, rawPoints] of rawBuckets) {
            const existingIndex = pointIndexByBucket.get(bucketMs);
            const existing = existingIndex == null ? undefined : points[existingIndex];
            if (existing && isUsableAggregatePoint(existing))
                continue;
            const repaired = aggregateRawPoints(rawPoints, aggregationByMetric[raw.metricKey] ?? "avg");
            if (!repaired)
                continue;
            const replacement = {
                ...repaired,
                time: existing?.time ?? new Date(bucketMs).toISOString(),
            };
            if (existingIndex == null)
                points.push(replacement);
            else
                points[existingIndex] = replacement;
            repairedSamples += repaired.count;
        }
        points.sort((left, right) => pointTimeMs(left) - pointTimeMs(right));
        return {
            ...(aggregate ?? raw),
            intervalSeconds,
            points,
        };
    };
    for (const aggregate of aggregateSeries) {
        const key = seriesKey(aggregate);
        const raw = rawBySeries.get(key);
        seen.add(key);
        output.push(raw ? repairOne(aggregate, raw) : aggregate);
    }
    for (const raw of rawSeries) {
        const key = seriesKey(raw);
        if (!seen.has(key))
            output.push(repairOne(undefined, raw));
    }
    return { series: output, repairedSamples };
}
