// Unify transport wiring + kick off the pre-ready phase for RTC/mailbox.
import { STATES, classifyTransportClose } from "./states.js";
import { NoisyError, fromUnknown } from '../errors/noisy-error.js';


function safeDetail(ev) {
  try {
    if (!ev) return undefined;
    // Only keep serializable crumbs
    return { type: ev.type ?? String(ev?.name ?? ""), message: String(ev?.message ?? "") };
  } catch { return undefined; }
}

/**
 * @param {{
 *   tx: any,
 *   scope: { addUnsub: (fn:()=>void)=>void, teardown: (err?:any)=>void },
 *   hooks: { onUp?:()=>void, onDown?:()=>void, onError?:(e:any)=>void },
 *   fsm:   any,
 *   policy: "rtc" | "ws_async" | string,
 *   startNow?:     ()=>void,  // mailbox: run immediately
 *   startWhenUp?:  ()=>void,  // rtc: run when DC is open; also microtask fallback
 * }} args
 */
export function attachTransportLifecycle({
  tx, scope, hooks, fsm, policy,
  startNow, startWhenUp,
}) {
  // Ensure we never call the starter concurrently or more than once.
  let started = false;
  let starting = null; // promise guard
  const runOnce = () => {
    if (started) return;
    if (!starting) {
      starting = Promise.resolve()
        .then(() => {
          if (started) return;
          // mark as started *before* awaiting any async work
          started = true;
          // Prefer startWhenUp if provided, else startNow
          if (startWhenUp) return startWhenUp();
          if (startNow)    return startNow();
        })
        .catch(err => {
          // If the starter throws synchronously, allow retry.
          started = false;
          starting = null;
          throw fromUnknown(err, { where: 'connectivity' });
        });
    }
    return starting;
  };

  const unUp = tx.onUp?.(() => {
    hooks.onUp?.();
    runOnce();
  });
  if (unUp) scope.addUnsub(unUp);

  // onDown: bubble only
  const unDown = tx.onDown?.(() => { try { hooks.onDown?.(); } catch {} });
  if (unDown) scope.addUnsub(unDown);


    const unClose = tx.onClose?.((ev) => {
        const cls = classifyTransportClose(fsm.state);
        const err = Object.assign(new Error(cls.code), { ...cls, detail: safeDetail(ev) });
        try { hooks.onError?.(err); } catch {}
        scope.teardown(err);
    });
  if (unClose) scope.addUnsub(unClose);

  // Kick once via microtask in *all* policies:
  // - RTC transports often don't emit onUp; the DC wrapper is already "open"
  // - WS/mailbox may emit onUp later; runOnce() will ignore duplicates
  queueMicrotask(runOnce);
}
