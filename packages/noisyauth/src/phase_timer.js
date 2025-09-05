// Shared helpers for phase timeouts
/**
 * Create a single-phase timer: at most one active phase at a time.
 * T is an object mapping PHASE -> ms (e.g. { WAIT_COMMIT: 8000, ... }).
 */
export function makePhaseTimer({ T, onTimeout, resend }) {
  let id = null;
  let phase = null;

  function clear() {
    if (id != null) clearTimeout(id);
    id = null;
    phase = null;
  }

  function arm(nextPhase, code, overrideMs) {
    clear();
    const ms = overrideMs ?? T?.[nextPhase];
    if (!(ms > 0)) return; // 0 or falsy means "no timeout" for that phase
    phase = nextPhase;
    id = setTimeout(() => {
      id = null;
      try {
        // Allow callers to optionally "resend" something on expiry if they want
        if (typeof resend === "function") resend(nextPhase, code);
      } finally {
        onTimeout?.(code, { phase: nextPhase });
      }
    }, ms);
  }

  function is(p) {
    return phase === p;
  }

  return {
    arm,
    clear,
    is,
    get phase() {
      return phase;
    },
  };
}
