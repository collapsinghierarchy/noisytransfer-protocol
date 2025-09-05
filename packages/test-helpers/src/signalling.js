import { WebSocketServer } from "ws";
import WebSocket from "ws";

import { signallingMode, testSignalBase } from "./env.js";

/** minimal in-memory transport pair */
export function makeInMemoryPair() {
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
    close() {},
    get isConnected() {
      return true;
    },
  });
  return [mk(toA, toB), mk(toB, toA)];
}

/** ephemeral broker used only when TEST_SIGNAL_MODE=ws-ephemeral */
export async function createEphemeralBroker() {
  const wss = new WebSocketServer({ port: 0 });
  const rooms = new Map(); // appID -> {A:ws|null, B:ws|null}

  // accept both "/" and "/ws" paths
  wss.on("connection", (ws, req) => {
    ws.on("error", () => {});
    const url = new URL(req.url, "http://localhost"); // path may be "/" or "/ws"
    const appID = url.searchParams.get("appID") || "default";
    const side = url.searchParams.get("side") === "B" ? "B" : "A";

    let room = rooms.get(appID);
    if (!room) {
      room = { A: null, B: null };
      rooms.set(appID, room);
    }

    if (room[side]) {
      try {
        ws.send(JSON.stringify({ type: "room_full" }));
      } catch {}
      ws.close(1005);
      return;
    }
    room[side] = ws;

    const relay = (peer, msg) => {
      try {
        peer?.send(JSON.stringify(msg));
      } catch {}
    };

    ws.on("message", (buf) => {
      let m;
      try {
        m = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (!m || typeof m !== "object") return;
      if (!["offer", "answer", "ice"].includes(m.type)) return;
      const dest = side === "A" ? "B" : "A";
      const peer = room[dest];
      if (!peer || peer.readyState !== WebSocket.OPEN) return;
      relay(peer, m);
    });

    ws.on("close", () => {
      if (room[side] === ws) room[side] = null;
      if (!room.A && !room.B) rooms.delete(appID);
    });

    try {
      ws.send(JSON.stringify({ type: "hello", side }));
    } catch {}
  });

  await new Promise((res) => wss.on("listening", res));
  const { port } = wss.address();

  const baseHost = `ws://127.0.0.1:${port}`;
  const base = `${baseHost}/ws`; // mailbox clients expect “…/ws”; signalling can use “/” or “/ws”

  let closed = false;
  return {
    /** ws://127.0.0.1:PORT/?appID=…&side=A|B (signalling) */
    urlFor: (app, side) => `${baseHost}/?appID=${encodeURIComponent(app)}&side=${side}`,
    /** ws base for mailbox transport, e.g. ws://127.0.0.1:PORT/ws */
    base,
    async close() {
      if (closed) return;
      closed = true;
      for (const ws of wss.clients) {
        try {
          ws.removeAllListeners();
          ws.terminate();
        } catch {}
      }
      await new Promise((r) => setTimeout(r, 20));
      try {
        wss.close();
      } catch {}
    },
  };
}

/**
 * Single entry-point all tests can use:
 *   const A = await makeSignal(room, "A");
 *   const B = await makeSignal(room, "B");
 */
const __memRooms = new Map();
let __ephemeral = null; // broker handle
let __ephemeralBase = null; // ws://127.0.0.1:PORT/ws

export async function makeSignal(room, side) {
  const mode = signallingMode();

  if (mode === "memory") {
    let pair = __memRooms.get(room);
    if (!pair) {
      pair = makeInMemoryPair();
      __memRooms.set(room, pair);
    }
    return side === "A" ? pair[0] : pair[1];
  }

  if (mode === "ws-ephemeral") {
    await startEphemeralBroker(); // idempotent
    const url = __ephemeral.urlFor(room, side);
    const ws = new WebSocket(url);

    return {
      send(m) {
        try {
          ws.send(JSON.stringify(m));
        } catch {}
      },
      onMessage(cb) {
        const h = (data) => {
          try {
            const payload = typeof data === "string" ? data : (data.toString?.() ?? "");
            const msg = JSON.parse(payload);
            if (msg && (msg.type === "offer" || msg.type === "answer" || msg.type === "ice"))
              cb(msg);
          } catch {}
        };
        ws.on("message", h);
        return () => ws.off?.("message", h);
      },
      onClose(cb) {
        const h = (code, reason) => cb?.({ code, reason: String(reason || "") });
        ws.on("close", h);
        return () => ws.off?.("close", h);
      },
      onUp() {
        return () => {};
      },
      onDown() {
        return () => {};
      },
      close() {
        try {
          ws.close();
        } catch {}
      },
      get isConnected() {
        return ws.readyState === ws.OPEN;
      },
    };
  }

  if (mode === "ws-external") {
    const base = testSignalBase().replace(/\/$/, "");
    const url = `${base}/?appID=${encodeURIComponent(room)}&side=${side}`;
    const ws = new WebSocket(url);
    const listeners = new Set();
    ws.on("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.toString());
      } catch {}
      if (msg && (msg.type === "offer" || msg.type === "answer" || msg.type === "ice")) {
        for (const cb of [...listeners]) {
          try {
            cb(msg);
          } catch {}
        }
      }
    });
    return {
      send(m) {
        try {
          ws.send(JSON.stringify(m));
        } catch {}
      },
      onMessage(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      onClose(cb) {
        ws.on("close", cb);
        return () => ws.off?.("close", cb);
      },
      onUp() {
        return () => {};
      },
      onDown() {
        return () => {};
      },
      close() {
        try {
          ws.close();
        } catch {}
      },
      get isConnected() {
        return ws.readyState === ws.OPEN;
      },
    };
  }

  throw new Error(`Unknown TEST_SIGNAL_MODE=${mode}`);
}

/* -------------------------------------------------------------------------- */
/* Ephemeral broker lifecycle helpers (for mailbox tests & harness)            */
/* -------------------------------------------------------------------------- */

/** Start the in-process broker if not already running (idempotent). */
export async function startEphemeralBroker() {
  if (__ephemeral) return;
  __ephemeral = await createEphemeralBroker();
  __ephemeralBase = __ephemeral.base; // ws://127.0.0.1:PORT/ws
}

/** Get the ws base URL of the running ephemeral broker (e.g., ws://127.0.0.1:PORT/ws). */
export function getEphemeralBaseUrl() {
  if (!__ephemeralBase) throw new Error("Ephemeral broker not started");
  return __ephemeralBase;
}

/** Stop the in-process broker and clear state. Safe to call multiple times. */
export async function shutdownEphemeralBroker() {
  try {
    await __ephemeral?.close?.();
  } catch {}
  __ephemeral = null;
  __ephemeralBase = null;
}
