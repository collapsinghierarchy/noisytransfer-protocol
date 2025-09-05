// packages/test-helpers/src/rtc-harness.js
import { makeSignal, shutdownEphemeralBroker } from "./signalling.js";

/**
 * Gate long-running E2E tests in CI unless explicitly allowed.
 * Usage:
 *   test("...", async (t) => { skipIfNoIntegration(t); ... })
 */
export function skipIfNoIntegration(t) {
  const enabled = /^(1|true|yes)$/i.test(String(process.env.CI_ALLOW_INTEGRATION ?? ""));
  if (!enabled) t.skip("CI_ALLOW_INTEGRATION is not set; skipping slow WebRTC E2E.");
}

/**
 * Get a signalling pair A/B in one call with automatic cleanup.
 * You should install wrtc globals yourself in the test before calling this:
 *   import wrtc from "@roamhq/wrtc";
 *   import { installWrtcGlobals } from "@noisytransfer/test-helpers";
 *   installWrtcGlobals(wrtc);
 */
export async function withSignalPair(t, { appID } = {}) {
  const room = appID || `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const A = await makeSignal(room, "A");
  const B = await makeSignal(room, "B");

  const cleanups = [];
  t.after(async () => {
    for (const fn of cleanups.reverse()) {
      try {
        await fn();
      } catch {}
    }
    try {
      await shutdownEphemeralBroker();
    } catch {}
  });

  return {
    A,
    B,
    onCleanup: (fn) => {
      cleanups.push(fn);
    },
  };
}
