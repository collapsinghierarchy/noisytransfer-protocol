export const TIMEOUTS = {
  // Async mailbox: peer may be offline; don't time out network phases.
  ws_async: {
    WAIT_COMMIT: 0,
    WAIT_OFFER:  0,
    WAIT_REVEAL: 0,
    SAS_CONFIRM: 30 * 60_000,
  },

  // Example for P2P/RTC or tests: finite, snappy
  rtc: {
    WAIT_COMMIT: 8_000,
    WAIT_OFFER:  8_000,
    WAIT_REVEAL: 8_000,
    SAS_CONFIRM: 12_000,
  },
};

export function timeoutsFor(policy = "ws_async") {
  return TIMEOUTS[policy] || TIMEOUTS.ws_async;
}