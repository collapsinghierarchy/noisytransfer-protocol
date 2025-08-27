// Unify transport wiring + kick off the pre-ready phase for RTC/mailbox.
import { STATES, classifyTransportClose } from "./states.js";
import { NoisyError, fromUnknown } from '@noisytransfer/errors/noisy-error';


function safeDetail(ev) {
  try {
    if (!ev) return undefined;
    // Only keep serializable crumbs
    return { type: ev.type ?? String(ev?.name ?? ""), message: String(ev?.message ?? "") };
  } catch { return undefined; }
}

export function attachTransportLifecycle({
  tx,
  scope,
  policy,
  startNow,
  startWhenUp,
  onUp,
  onDown,
}) {
  const cleanups = [];
  let started = false;

  const startOnlyOnce = (fn) => {
    if (started) return;
    started = true;
    try { fn && fn(); } catch {}
  };

  // 1) Start-now on next microtask
  if (typeof startNow === "function") {
    queueMicrotask(() => startOnlyOnce(startNow));
  }

  const fireUp = () => { onUp?.(); startOnlyOnce(startWhenUp); };
  const fireDown = () => { onDown?.(); };

  // 2) If already connected, treat as up
  if (typeof startWhenUp === "function" && tx?.isConnected) {
    queueMicrotask(fireUp);
  }

  // 3) Subscribe to explicit up/down signals if present
  if (typeof tx?.onUp === "function") {
    cleanups.push(tx.onUp(fireUp));
  } else if (typeof tx?.onOpen === "function") {
    cleanups.push(tx.onOpen(fireUp));
  } else if (typeof tx?.onMessage === "function" && typeof startWhenUp === "function") {
    // Fallback: treat first message as "up"
    const unsub = tx.onMessage(function firstMsg() {
      unsub?.();
      fireUp();
    });
    cleanups.push(unsub);
  }

  if (typeof tx?.onDown === "function") {
    cleanups.push(tx.onDown(fireDown));
  }
  if (typeof tx?.onClose === "function") {
    cleanups.push(tx.onClose(fireDown));
  }

  // 4) **NEW**: FINAL FALLBACK — if we still haven’t started, kick on next tick anyway.
  // Safe because kickoff functions are idempotent and handle transient send failures internally.
  if (typeof startWhenUp === "function") {
    queueMicrotask(() => startOnlyOnce(startWhenUp));   // <—— add this line
  }

  const teardown = () => {
    for (const c of cleanups.splice(0)) { try { c && c(); } catch {} }
  };
  if (scope?.signal) {
    if (scope.signal.aborted) teardown();
    else scope.signal.addEventListener("abort", teardown, { once: true });
  }
  return teardown;
}