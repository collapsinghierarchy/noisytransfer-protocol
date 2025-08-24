export function makeScope() {
  const ac = new AbortController();
  const unsubs = new Set();
  let tornDown = false;

  return {
    signal: ac.signal,
    addUnsub(fn) { if (typeof fn === "function") unsubs.add(fn); return fn; },
    teardown(reason) {
      if (tornDown) return;
      tornDown = true;
      try { ac.abort(reason ?? new Error("aborted")); } catch {}
      for (const u of [...unsubs]) { try { u(); } catch {} unsubs.delete(u); }
    },
  };
}

// small helpers
export function throwIfAborted(signal) {
  if (signal.aborted) throw (signal.reason ?? new Error("aborted"));
}
export function raceAbort(p, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return Promise.race([
    p,
    new Promise((_, rej) => signal.addEventListener("abort", () => rej(signal.reason), { once:true })),
  ]);
}