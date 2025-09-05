/**
 * mailboxTransport(baseUrl, { room, side, sessionId, deliveredUpTo })
 *
 * Returns:
 * {
 *   send(frame),                      // frame: {type: string, ...}
 *   onMessage(cb: (frame) => void),   // single-arg only
 *   onUp(cb), onDown(cb), onClose(cb),
 *   close(code?: number, reason?: string),
 *   get isConnected(): boolean
 * }
 *
 * Semantics:
 * - Single-arg frames only. No send("type", payload) legacy form.
 * - Durable: queues outbound frames while disconnected (bounded).
 * - Ordered: inbound data frames processed in seq order; duplicates dropped.
 */

import { binReplacer, binReviver } from "../ser.js";
import { browserWSWithReconnect } from "./ws.js";

export async function mailboxTransport(
  baseUrl,
  { room, side, sessionId, deliveredUpTo: initialDelivered = 0 } = {}
) {
  // --- lifecycle & state ---
  let alive = true;
  let closedByApp = false;

  const MAX_Q = 10000; // cap offline growth
  const outQ = [];

  // delivery watermark (resume)
  let deliveredUpTo = initialDelivered;

  // small backlog so we don't miss early events like {type:"room_full"}
  const listeners = new Set();
  const backlog = [];
  const BACKLOG_MAX = 16;

  function emit(msg) {
    if (!alive) return;
    if (listeners.size === 0) {
      if (backlog.length >= BACKLOG_MAX) backlog.shift();
      backlog.push(msg);
      return;
    }
    for (const fn of [...listeners]) {
      try {
        fn(msg);
      } catch {}
    }
  }

  function onMessage(cb) {
    if (!alive) return () => {};
    listeners.add(cb);
    if (backlog.length) {
      for (const m of backlog.splice(0)) {
        try {
          cb(m);
        } catch {}
      }
    }
    return () => listeners.delete(cb);
  }

  let upHandler = () => {};
  let downHandler = () => {};
  let closeHandler = () => {};

  const url = `${baseUrl}?appID=${room}&side=${side}&sid=${sessionId || ""}`;
  const ws = browserWSWithReconnect(url, { maxRetries: Infinity });

  function safeSend(obj) {
    if (!alive) return;
    if (!ws.isConnected) {
      if (outQ.length < MAX_Q) outQ.push(obj);
      return;
    }
    try {
      ws.send(obj);
    } catch {
      if (outQ.length < MAX_Q) outQ.push(obj);
    }
  }

  function flush() {
    if (!alive || !ws.isConnected) return;
    while (outQ.length) {
      const m = outQ.shift();
      try {
        ws.send(m);
      } catch {
        outQ.unshift(m);
        break;
      }
    }
  }

  function hello() {
    safeSend({ type: "hello", sessionId, deliveredUpTo });
  }

  // Contract: onOpen is raw socket open; onUp = “ready/online”
  ws.onOpen(() => {
    if (!alive) return;
    hello();
    flush();
  });
  ws.onUp(() => {
    if (!alive) return;
    flush();
    upHandler();
  });
  ws.onDown(() => {
    if (!alive) return;
    downHandler();
  });

  ws.onMessage((m) => {
    if (!alive || !m || typeof m !== "object") return;

    if (m.type === "deliver" && typeof m.seq === "number") {
      // normal mailbox envelope; payload may be stringified with binReplacer
      let frame = m.payload;
      if (typeof frame === "string") {
        try {
          frame = JSON.parse(frame, binReviver);
        } catch {
          return;
        } // ignore malformed payload
      }
      emit(frame);

      // ack after delivery (idempotent)
      if (m.seq > deliveredUpTo) {
        deliveredUpTo = m.seq;
        safeSend({ type: "delivered", upTo: deliveredUpTo });
      }
      return;
    }

    // Pass-through server events (e.g., {type:"room_full"})
    emit(m);
  });

  ws.onClose((ev) => {
    // This fires only after reconnect gave up
    if (!alive) return;
    alive = false;
    if (closedByApp) return; // quiet on app close
    closeHandler(ev);
  });

  return {
    features: { durableOrdered: true },
    send(rawFrame) {
      if (!alive) return;
      const to = side === "A" ? "B" : "A";
      const payload = JSON.stringify(rawFrame, binReplacer);
      safeSend({ type: "send", to, payload });
    },
    onMessage,
    onClose(cb) {
      closeHandler = cb || (() => {});
      return () => (closeHandler = () => {});
    },
    onUp(cb) {
      upHandler = cb || (() => {});
      return () => (upHandler = () => {});
    },
    onDown(cb) {
      downHandler = cb || (() => {});
      return () => (downHandler = () => {});
    },
    close(code = 1000, reason = "app_close") {
      if (!alive) return;
      closedByApp = true;
      alive = false;
      try {
        ws.close(code, reason);
      } catch {}
    },
    get isConnected() {
      return ws.isConnected;
    },
  };
}
