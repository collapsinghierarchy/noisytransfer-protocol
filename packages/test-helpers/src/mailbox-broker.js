// packages/test-helpers/src/mailbox-broker.js
import { WebSocketServer } from "ws";

/**
 * Minimal mailbox broker compatible with @noisytransfer/transport mailboxTransport:
 * - Clients send JSON envelopes: { type: "send", to: "A"|"B", payload: <string> }
 * - Server forwards ONLY the raw payload string to the peer (no envelope).
 * - When a peer is offline, payloads are queued and flushed on reconnect.
 * - No server "hello" frames are emitted (to keep client onMessage app-clean).
 * - URL: ws://127.0.0.1:<port>/ws?room=<id>&side=A|B
 */
export async function createMailboxBroker() {
  // Note: using 'path' is supported by ws when creating a standalone server
  const wss = new WebSocketServer({ port: 0, path: "/ws" });

  // room -> { A: WebSocket|null, B: WebSocket|null, qA: string[], qB: string[] }
  const rooms = new Map();

  const getRoom = (room) => {
    let r = rooms.get(room);
    if (!r) {
      r = { A: null, B: null, qA: [], qB: [] };
      rooms.set(room, r);
    }
    return r;
  };

  function flushQueueFor(ws, queue) {
    try {
      while (queue.length) {
        const payload = queue.shift(); // raw payload string
        ws.send(payload);
      }
    } catch {}
  }

  wss.on("connection", (ws, req) => {
    ws.on("error", () => {});

    const url = new URL(req.url, "ws://local");
    const room = url.searchParams.get("room") || "default";
    const side = url.searchParams.get("side") === "B" ? "B" : "A";
    const other = side === "A" ? "B" : "A";
    const r = getRoom(room);

    // Replace any existing socket on this side (drop older one)
    try {
      r[side]?.close?.(1008, "replaced");
    } catch {}
    r[side] = ws;

    // Flush any queued payloads destined for this side
    const queueForThisSide = side === "A" ? r.qA : r.qB;
    if (queueForThisSide.length) flushQueueFor(ws, queueForThisSide);

    ws.on("message", (data, isBinary) => {
      // We only forward app payloads (strings). Control/envelopes are handled here.
      // If binary arrives, forward as-is (not typical for current tests).
      if (isBinary) {
        const peer = r[other];
        if (peer && peer.readyState === peer.OPEN) {
          try {
            peer.send(data, { binary: true });
          } catch {}
        } else {
          const q = other === "A" ? r.qA : r.qB;
          q.push(data);
        }
        return;
      }

      const text = typeof data === "string" ? data : (data.toString?.() ?? "");
      let obj;
      try {
        obj = JSON.parse(text);
      } catch {
        obj = null;
      }

      // Expected envelope from mailboxTransport
      if (obj && obj.type === "send" && typeof obj.payload === "string") {
        const raw = obj.payload; // raw payload string (likely JSON)
        const peer = r[other];
        if (peer && peer.readyState === peer.OPEN) {
          try {
            peer.send(raw);
          } catch {}
        } else {
          const q = other === "A" ? r.qA : r.qB;
          q.push(raw);
        }
        return;
      }

      // Ignore any other control frames (hello/ack/etc.) — do NOT forward to app.
      // You can extend here if you later add acks or delivery receipts.
    });

    ws.on("close", () => {
      if (r[side] === ws) r[side] = null;
      if (!r.A && !r.B && r.qA.length === 0 && r.qB.length === 0) rooms.delete(room);
    });
  });

  await new Promise((r) => wss.once("listening", r));
  const { port } = wss.address();

  let closed = false;
  return {
    base: `ws://127.0.0.1:${port}/ws`, // client base URL
    async close() {
      if (closed) return;
      closed = true;

      // Terminate all clients first
      for (const ws of wss.clients) {
        try {
          ws.removeAllListeners();
          ws.terminate();
        } catch {}
      }

      // Give ws a beat to settle
      await new Promise((r) => setTimeout(r, 10));

      // IMPORTANT: wait for the server to actually close
      await new Promise((resolve) => {
        try {
          wss.close(resolve);
        } catch {
          resolve();
        }
      });
    },
  };
}
