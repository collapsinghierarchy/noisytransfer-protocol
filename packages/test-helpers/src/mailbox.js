 import { mailboxTransport as mkMailbox } from "@noisytransfer/transport";
 import { randomUUID } from "node:crypto";
 import WebSocket from "ws";

 // internal after a blank line
 import { createMailboxBroker } from "./mailbox-broker.js";

 // side-effect after imports
 globalThis.WebSocket = globalThis.WebSocket || WebSocket;

// --- memory pair (fast, opaque) ---
function makeMailboxMemoryPair() {
  const toA = new Set(),
    toB = new Set();
  const mk = (mine, peer) => ({
    send(m) {
      for (const cb of [...peer]) {
        try {
          cb(m);
        } catch {}
      }
    },
    onMessage(cb) {
      mine.add(cb);
      return () => mine.delete(cb);
    },
    onClose() {
      return () => {};
    },
    onUp() {
      return () => {};
    },
    onDown() {
      return () => {};
    },
    close() {
      mine.clear();
      peer.clear?.();
    },
    get isConnected() {
      return true;
    },
  });
  return [mk(toA, toB), mk(toB, toA)];
}

let __mboxBroker = null; // in-process WS mailbox broker

export async function startMailboxBroker() {
  if (!__mboxBroker) __mboxBroker = await createMailboxBroker();
  return __mboxBroker.base; // ws://127.0.0.1:PORT/ws
}
export function getMailboxBaseUrl() {
  if (!__mboxBroker) throw new Error("mailbox broker not started");
  return __mboxBroker.base;
}
export async function shutdownMailboxBroker() {
  try {
    await __mboxBroker?.close?.();
  } catch {}
  __mboxBroker = null;
}

/**
 * Unified mailbox pair for tests.
 * mode:
 *  - "memory" (default): hermetic in-memory. Fast, no sockets.
 *  - "ws-ephemeral": real ws transport against in-process broker.
 *  - "ws-external": TEST_SIGNAL_BASE must be provided, ending with /ws.
 */
export async function withMailboxPair(
  t,
  { mode = "memory", room = randomUUID(), sessionIdA, sessionIdB } = {}
) {
  if (mode === "memory") {
    const [A, B] = makeMailboxMemoryPair();
    const close = () => {
      try {
        A.close();
      } catch {}
      try {
        B.close();
      } catch {}
    };
    t.after(close);
    return { A, B, room, close };
  }

  if (mode === "ws-ephemeral") {
    const base = await startMailboxBroker();
    const A = await mkMailbox(base, { room, side: "A", sessionId: sessionIdA || randomUUID() });
    const B = await mkMailbox(base, { room, side: "B", sessionId: sessionIdB || randomUUID() });
    const close = () => {
      try {
        A.close();
      } catch {}
      try {
        B.close();
      } catch {}
    };
    t.after(async () => {
      close();
      await shutdownMailboxBroker();
    });
    return { A, B, room, close };
  }

  if (mode === "ws-external") {
    const base = (process.env.TEST_SIGNAL_BASE || "").replace(/\/$/, "");
    if (!base) throw new Error("TEST_SIGNAL_BASE required for ws-external mailbox tests");
    const A = await mkMailbox(base, { room, side: "A", sessionId: sessionIdA || randomUUID() });
    const B = await mkMailbox(base, { room, side: "B", sessionId: sessionIdB || randomUUID() });
    const close = () => {
      try {
        A.close();
      } catch {}
      try {
        B.close();
      } catch {}
    };
    t.after(close);
    return { A, B, room, close };
  }

  throw new Error(`Unknown mailbox mode: ${mode}`);
}
