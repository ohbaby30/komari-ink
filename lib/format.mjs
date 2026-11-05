// Native ES module adapted from ohbaby30/Komari-Theme-luminaCustom af08483.
const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
const TRAFFIC_RATE_THRESHOLDS = [
    { unit: "Tbps", divisor: 1_000_000_000_000 },
    { unit: "Gbps", divisor: 1_000_000_000 },
    { unit: "Mbps", divisor: 1_000_000 },
    { unit: "Kbps", divisor: 1_000 },
];
export const LONG_TERM_EXPIRE_DAYS = 36500;
export function trimFixed(value, digits) {
    if (!Number.isFinite(value))
        return "0";
    return value
        .toFixed(digits)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*?[1-9])0+$/, "$1");
}
export function joinDisplayParts(parts) {
    return parts
        .map((part) => part?.trim())
        .filter((part) => Boolean(part))
        .join(" · ");
}
export function formatBytes(n) {
    if (!n || n < 0 || !Number.isFinite(n))
        return "0 B";
    let idx = 0;
    let v = n;
    while (v >= 1024 && idx < UNITS.length - 1) {
        v /= 1024;
        idx += 1;
    }
    if (idx === 0)
        return `${Math.round(v)} ${UNITS[idx]}`;
    const dec = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return `${v.toFixed(dec)} ${UNITS[idx]}`;
}
function formatRateValue(value) {
    if (value >= 100)
        return Math.round(value).toString();
    if (value >= 10)
        return trimFixed(value, 1);
    // 只会以 bitsPerSec / divisor 的形式调用,且 bitsPerSec >= divisor,所以 value 恒 >= 1,
    // 不存在小于 1 的分支。
    return trimFixed(value, 2);
}
function formatTrafficRate(bytesPerSec) {
    if (!bytesPerSec || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
        return {
            value: "0",
            unit: "bps",
        };
    }
    const bitsPerSec = bytesPerSec * 8;
    for (const { unit, divisor } of TRAFFIC_RATE_THRESHOLDS) {
        if (bitsPerSec >= divisor) {
            return {
                value: formatRateValue(bitsPerSec / divisor),
                unit,
            };
        }
    }
    return {
        value: bitsPerSec >= 100 ? Math.round(bitsPerSec).toString() : trimFixed(bitsPerSec, 1),
        unit: "bps",
    };
}
export function formatTrafficRateLabel(bytesPerSec) {
    const rate = formatTrafficRate(bytesPerSec);
    return `${rate.value} ${rate.unit}`;
}
// 按字节算的速率(KB/s · MB/s · GB/s · TB/s)——和 formatBytes 同一套 1024 进制,只是加了 "/s" 后缀。
// 用在传输速度按字节比按比特更自然的地方(如首页实时带宽和节点卡速度),而不是 bps/Kbps/Mbps。
export function formatByteRate(bytesPerSec) {
    const [value, unit = "B"] = formatBytes(bytesPerSec).split(" ");
    return { value, unit: `${unit}/s` };
}
export function formatByteRateLabel(bytesPerSec) {
    const { value, unit } = formatByteRate(bytesPerSec);
    return `${value} ${unit}`;
}
export function formatUptimeDays(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0)
        return { value: "—", unit: "" };
    const days = seconds / 86400;
    if (days >= 1)
        return { value: Math.floor(days).toString(), unit: "天" };
    const hours = seconds / 3600;
    if (hours >= 1)
        return { value: Math.floor(hours).toString(), unit: "小时" };
    const minutes = seconds / 60;
    return { value: Math.floor(minutes).toString(), unit: "分钟" };
}
// 将 `expired_at` 解析为毫秒；空值、Go 零时和 0/-1 哨兵均表示无到期。
export function resolveExpireTimestamp(iso) {
    if (iso == null)
        return null;
    const raw = String(iso).trim();
    if (raw === "")
        return null;
    if (/^-?\d+$/.test(raw)) {
        const n = Number(raw);
        if (n <= 0)
            return null; // 0 / -1 "无到期" 哨兵值
        return n < 1e12 ? n * 1000 : n; // unix 秒 vs. 毫秒
    }
    const ts = Date.parse(raw);
    if (Number.isNaN(ts) || ts <= 0)
        return null; // 无法解析或 Go 零时
    return ts;
}
export function getExpireDaysRemaining(iso, now = Date.now()) {
    const ts = resolveExpireTimestamp(iso);
    if (ts == null || !Number.isFinite(now))
        return null;
    return Math.floor((ts - now) / 86400000);
}
function resolveExpireTone(days) {
    if (days == null || !Number.isFinite(days))
        return "none";
    if (days > LONG_TERM_EXPIRE_DAYS)
        return "long";
    if (days > 30)
        return "ok";
    if (days > 7)
        return "warn";
    return "critical";
}
export function formatExpireDays(iso, now = Date.now()) {
    const days = getExpireDaysRemaining(iso, now);
    const tone = resolveExpireTone(days);
    if (days == null)
        return { value: "—", unit: "", tone };
    if (tone === "long")
        return { value: "长期", unit: "", tone };
    if (tone === "ok" || tone === "warn")
        return { value: days.toString(), unit: "天", tone };
    if (days > 0)
        return { value: days.toString(), unit: "天", tone };
    if (days === 0)
        return { value: "今日", unit: "", tone };
    return { value: "已过期", unit: "", tone };
}
function inferPlainTagColor(label) {
    const normalized = label.trim().toLowerCase();
    if (/(cn2gia|9929|cmin2)/i.test(normalized)) {
        return "blue";
    }
    if (/(163pp|163|4837|cmi)/i.test(normalized)) {
        return "green";
    }
    return "violet";
}
/** 把 `tag1<color>;tag2<color2>` 解析成 [{ label, color }]。 */
export function parseTags(raw) {
    if (!raw)
        return [];
    return raw
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((item) => {
        const m = item.match(/^(.*?)<([a-zA-Z]+)>$/);
        if (m)
            return { label: m[1].trim(), color: m[2].toLowerCase() };
        return { label: item, color: inferPlainTagColor(item) };
    });
}
