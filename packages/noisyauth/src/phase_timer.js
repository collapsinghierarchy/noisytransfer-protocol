// Shared “arm timeout with one resend nudge” helper for both roles.

export function makePhaseTimer({ T, resend, onTimeout }) {
  let t = null;
  let nudged = false;

  function clear() {
    if (t) clearTimeout(t);
    t = null;
    nudged = false;
  }

  function arm(phase, code) {
    clear();
    const ms = T[phase];
    if (!(ms > 0)) return;

    t = setTimeout(function tick() {
      if (!nudged) {
        nudged = true;
        try { resend?.(); } catch {}
        // give it one more window after the nudge
        t = setTimeout(() => onTimeout(code || `timeout_${String(phase).toLowerCase()}`), ms);
        return;
      }
      onTimeout(code || `timeout_${String(phase).toLowerCase()}`);
    }, ms);
  }

  return { arm, clear };
}
