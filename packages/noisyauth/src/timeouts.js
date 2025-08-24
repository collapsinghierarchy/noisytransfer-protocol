const envNum = (name, fallback) => {
  const v = Number(process?.env?.[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

export const TIMEOUTS = {
  ws_async: { WAIT_COMMIT: 0, WAIT_OFFER: 0, WAIT_REVEAL: 0, SAS_CONFIRM: 30 * 60_000 },
  rtc: {
    WAIT_COMMIT: envNum('NOISYAUTH_WAIT_COMMIT_MS', 8_000),
    WAIT_OFFER:  envNum('NOISYAUTH_WAIT_OFFER_MS',  8_000),
    WAIT_REVEAL: envNum('NOISYAUTH_WAIT_REVEAL_MS', 8_000),
    SAS_CONFIRM: envNum('NOISYAUTH_WAIT_CONFIRM_MS',12_000),
  },
};

export function timeoutsFor(policy = "ws_async") {
  return TIMEOUTS[policy] || TIMEOUTS.ws_async;
}