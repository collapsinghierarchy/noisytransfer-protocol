import { NoisyError } from "@noisytransfer/errors/noisy-error";

import { binReplacer, binReviver } from "../ser.js";

export function browserWSWithReconnect(
  url,
  {
    maxRetries = Infinity,
    backoffMs = [250, 500, 1000, 2000, 5000],
    protocols,
    wsConstructor,
  } = {}
) {
  const WS = wsConstructor ?? globalThis.WebSocket;
  if (!WS) throw new NoisyError({ code: "NC_PROTOCOL", message: "WebSocket unavailable (provide wsConstructor or set globalThis.WebSocket)" });

  let ws = null;
  let attempts = 0;
  let closedByApp = false;
  let reconnectTimer = null;

  const onOpen = new Set();
  const onUp = new Set();
  const onDown = new Set();
  const onClose = new Set();
  const onMessage = new Set();

  const api = {
    isConnected: false,
    onOpen(cb){ onOpen.add(cb); return () => onOpen.delete(cb); },
    onUp(cb){ onUp.add(cb); return () => onUp.delete(cb); },
    onDown(cb){ onDown.add(cb); return () => onDown.delete(cb); },
    onClose(cb){ onClose.add(cb); return () => onClose.delete(cb); },
    onMessage(cb){ onMessage.add(cb); return () => onMessage.delete(cb); },

    send(data){
      const payload = (typeof data === "string" || data instanceof ArrayBuffer || ArrayBuffer.isView(data))
        ? data
        : JSON.stringify(data, binReplacer);
      ws?.send?.(payload);
    },

    close(code = 1000, reason = "closed"){
      closedByApp = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      // detach listeners so no late callbacks get queued during shutdown
      try {
        ws?.removeEventListener?.("open", _open);
        ws?.removeEventListener?.("message", _msg);
        ws?.removeEventListener?.("close", _close);
        ws?.removeEventListener?.("error", _err);
      } catch {}
      // request a clean close
      try { ws?.close?.(code, reason); } catch {}
      // if this is Node 'ws', terminate immediately to drop TCP
      if (ws && typeof ws.terminate === "function") {
        try { ws.terminate(); } catch {}
      }
    },
  };

  const _emit = (set, ev) => { for (const f of set) { try { f(ev); } catch {} } };

  const scheduleReconnect = () => {
    if (closedByApp) return;
    if (attempts >= maxRetries) return;
    const delay = Array.isArray(backoffMs)
      ? backoffMs[Math.min(attempts, backoffMs.length - 1)]
      : Number(backoffMs) || 0;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      attempts++;
      open();
    }, delay);
  };

  const _open = () => {
    attempts = 0;
    api.isConnected = true;
    _emit(onOpen);
    _emit(onUp);
  };
  const _msg = (ev) => {
    let v = ev?.data;
    if (typeof v === "string") { try { v = JSON.parse(v, binReviver); } catch {} }
    _emit(onMessage, v);
  };
  const _close = (ev) => {
    api.isConnected = false;
    _emit(onDown);
    _emit(onClose, { code: ev?.code, reason: ev?.reason });
    if (!closedByApp) scheduleReconnect();
  };
  const _err = () => { /* close/reconnect will handle */ };

  function open() {
    if (closedByApp) return;
    try { ws?.close?.(); } catch {}
    ws = new WS(url, protocols);
    ws.addEventListener?.("open", _open);
    ws.addEventListener?.("message", _msg);
    ws.addEventListener?.("close", _close);
    ws.addEventListener?.("error", _err);
  }

  open();
  return api;
}
