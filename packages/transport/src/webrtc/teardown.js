// Strong teardown utilities for node-webrtc/wrtc tests.
// Goal: leave ZERO open handles so Node's test runner exits.
//
// Pattern copied from lower-level RTC tests:
//  - remove all DC/PC handlers
//  - close DC and PC on BOTH sides
//  - stop transceivers
//  - brief wait for libuv to release sockets
//  - (optional) GC hint

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getDC(tx) {
  return tx?.dc ?? tx?._dc ?? tx?.channel ?? null;
}
function getPC(tx) {
  return tx?.pc ?? tx?._pc ?? tx?.peer ?? tx?._peer ?? null;
}

function nullDataChannelHandlers(dc) {
  if (!dc) return;
  try {
    dc.onopen = null;
  } catch {}
  try {
    dc.onclose = null;
  } catch {}
  try {
    dc.onmessage = null;
  } catch {}
  try {
    dc.onerror = null;
  } catch {}
  try {
    dc.onbufferedamountlow = null;
  } catch {}
  try {
    dc.removeEventListener?.("open", () => {});
  } catch {}
  try {
    dc.removeEventListener?.("close", () => {});
  } catch {}
  try {
    dc.removeEventListener?.("message", () => {});
  } catch {}
  try {
    dc.removeEventListener?.("error", () => {});
  } catch {}
  try {
    dc.removeEventListener?.("bufferedamountlow", () => {});
  } catch {}
}

function nullPeerConnectionHandlers(pc) {
  if (!pc) return;
  try {
    pc.onicecandidate = null;
  } catch {}
  try {
    pc.oniceconnectionstatechange = null;
  } catch {}
  try {
    pc.onconnectionstatechange = null;
  } catch {}
  try {
    pc.onsignalingstatechange = null;
  } catch {}
  try {
    pc.ondatachannel = null;
  } catch {}
  try {
    pc.onnegotiationneeded = null;
  } catch {}
  try {
    pc.onicegatheringstatechange = null;
  } catch {}
}

async function waitClosed(pc, timeoutMs = 300) {
  if (!pc) return;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cs = pc.connectionState;
    const ics = pc.iceConnectionState;
    if (cs === "closed" || ics === "closed" || ics === "failed" || ics === "disconnected") {
      break;
    }
    await sleep(10);
  }
}

/**
 * Close DataChannel and PeerConnection *without* waiting on drain.
 * Removes handlers, stops transceivers, closes, then waits briefly for close.
 */
export async function forceCloseNoFlush(tx, opts = {}) {
  if (!tx) return;
  const dc = getDC(tx);
  const pc = getPC(tx);

  // 0) If the transport has its own close/destroy, call it first.
  try {
    await tx.close?.();
  } catch {}
  try {
    await tx.destroy?.();
  } catch {}

  // 1) Remove event handlers to avoid queued callbacks keeping refs alive
  nullDataChannelHandlers(dc);
  nullPeerConnectionHandlers(pc);

  // 2) Best-effort: stop any tracks/transceivers (usually none for DC-only)
  try {
    pc?.getTransceivers?.().forEach((tr) => {
      try {
        tr.stop?.();
      } catch {}
      try {
        tr.sender?.track?.stop?.();
      } catch {}
      try {
        tr.receiver?.track?.stop?.();
      } catch {}
    });
  } catch {}

  // 3) Close the DataChannel and the PeerConnection
  try {
    dc?.close?.();
  } catch {}
  try {
    pc?.close?.();
  } catch {}

  // 4) Briefly wait for 'closed' state (or failure/disconnected), then yield
  await waitClosed(pc, 350);
  await sleep(25);

  // 5) GC hint (if tests run with --expose-gc this helps tear down native resources)
  try {
    global.gc?.();
  } catch {}
}

/**
 * Optional: remove listeners and clear any intervals the tx may keep.
 * If your tx exposes an unsubscribe API, call it here.
 */
export function scrubTransport(tx) {
  try {
    tx?.off?.();
  } catch {}
  try {
    tx?.removeAllListeners?.();
  } catch {}
  try {
    tx?.unsubMsg?.();
  } catch {}
}
