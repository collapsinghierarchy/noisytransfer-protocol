// packages/transport/test/rtc_connect_e2e.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import wrtc from "@roamhq/wrtc";

import {
  installWrtcGlobals,
  withSignalPair,
  skipIfNoIntegration,
} from "@noisytransfer/test-helpers";

import { rtcInitiator, rtcResponder } from "@noisytransfer/transport";

// one helper to DRY trickle/non-trickle runs
async function runOnce(t, { nonTrickle, label }) {
  installWrtcGlobals(wrtc);
  const { A, B, onCleanup } = await withSignalPair(t, {
    appID: `rtc-${label}-${nonTrickle ? "nontrickle" : "trickle"}`,
  });

  const [ta, tb] = await Promise.all([
    rtcInitiator(A, {}, { nonTrickle }),
    rtcResponder(B, {}, { nonTrickle }),
  ]);

  onCleanup(async () => {
    try {
      await ta.close?.();
    } catch {}
    try {
      await tb.close?.();
    } catch {}
  });

  // wait until both sides report "up"
  await new Promise((res) => {
    let up = 0;
    ta.onUp(() => {
      if (++up === 2) res();
    });
    tb.onUp(() => {
      if (++up === 2) res();
    });
  });

  // ping/pong sanity (transport is JSON-safe)
  const got = await new Promise((res) => {
    const un = tb.onMessage((m) => {
      try {
        un?.();
      } catch {}
      res(m);
    });
    ta.send({ ping: 1 });
    setTimeout(() => res(null), 3000);
  });

  assert.ok(got && got.ping === 1, "responder should receive initiator ping");
}

test("RTC connect (trickle)", { timeout: 30_000 }, async (t) => {
  skipIfNoIntegration(t);
  await runOnce(t, { nonTrickle: false, label: "connect" });
});

test("RTC connect (non-trickle with fallback)", { timeout: 30_000 }, async (t) => {
  skipIfNoIntegration(t);
  await runOnce(t, { nonTrickle: true, label: "connect" });
});
