// Native ES module adapted from ohbaby30/Komari-Theme-luminaCustom af08483.
function createTimeoutSignal(sources, ms) {
    const controller = new AbortController();
    const upstreams = [...new Set(sources.filter((source) => Boolean(source)))];
    const delay = Math.max(0, Number.isFinite(ms) ? ms : 0);
    let timer;
    let cleaned = false;
    const cleanup = () => {
        if (cleaned)
            return;
        cleaned = true;
        if (timer !== undefined)
            globalThis.clearTimeout(timer);
        for (const upstream of upstreams) {
            upstream.removeEventListener("abort", onUpstreamAbort);
        }
    };
    function onUpstreamAbort(event) {
        const upstream = event.currentTarget;
        cleanup();
        if (!controller.signal.aborted)
            controller.abort(upstream.reason);
    }
    const abortedSource = upstreams.find((upstream) => upstream.aborted);
    if (abortedSource) {
        controller.abort(abortedSource.reason);
    }
    else {
        timer = globalThis.setTimeout(() => {
            cleanup();
            if (!controller.signal.aborted)
                controller.abort();
        }, delay);
        for (const upstream of upstreams) {
            upstream.addEventListener("abort", onUpstreamAbort, { once: true });
        }
    }
    return { signal: controller.signal, cleanup };
}
export async function withTimeoutSignal(operation, ms, upstream) {
    const managed = createTimeoutSignal([upstream], ms);
    try {
        return await operation(managed.signal);
    }
    finally {
        managed.cleanup();
    }
}
export async function fetchWithTimeout(input, init, ms, upstream) {
    const requestSignal = typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined;
    const effectiveRequestSignal = init?.signal !== undefined ? init.signal : requestSignal;
    const { signal, cleanup } = createTimeoutSignal([upstream, effectiveRequestSignal], ms);
    try {
        return await fetch(input, { ...init, signal });
    }
    finally {
        cleanup();
    }
}
