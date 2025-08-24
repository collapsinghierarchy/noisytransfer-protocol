// src/transport/ws/ws.js
import { binReplacer, binReviver } from "../ser.js";
import { NoisyError } from "@noisytransfer/errors/noisy-error.js";


// src/transport/ws/ws.js
export function browserWSWithReconnect(
  url,
  { maxRetries = Infinity, backoffMs = [250, 500, 1000, 2000, 5000], protocols } = {}
) {
  let ws = null;
  let attempts = 0;
  let closedByApp = false;
  let connected = false;
  let timers = new Set();

  // listeners
  const onOpenHandlers = new Set();
  const onMessageHandlers = new Set();
  const onDownHandlers = new Set();
  const onUpHandlers = new Set();
  const onCloseHandlers = new Set(); // <— ONLY for app-close or final give-up

  function emit(handlers, ...args) { for (const h of [...handlers]) try { h(...args); } catch {} }

  function schedule(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  }

  function connect() {
    if (closedByApp) return;
    ws = new WebSocket(url, protocols);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      attempts = 0;
      const wasDown = !connected;
      connected = true;
      if (wasDown) emit(onUpHandlers);
      emit(onOpenHandlers);
    };

    ws.onmessage = (ev) => {
      // Pass raw parsed or string; mailbox layer decides
      let msg = ev.data;
      try { if (typeof msg === "string") msg = JSON.parse(msg); } catch {}
      emit(onMessageHandlers, msg);
    };

    ws.onclose = () => {
      const wasUp = connected;
      connected = false;
      if (closedByApp) {
        // Final — app requested close
        emit(onCloseHandlers, { code: 1000, reason: "app_close" });
        return;
      }
      // Transient drop: notify down, retry
      if (wasUp) emit(onDownHandlers);

      if (attempts >= maxRetries) {
        emit(onCloseHandlers, { code: 1006, reason: "exhausted_retries" });
        return;
      }
      const delay = backoffMs[Math.min(attempts, backoffMs.length - 1)];
      attempts++;
      schedule(connect, delay);
    };

    ws.onerror = () => {
      // errors route into onclose->reconnect; no extra surfacing
    };
  }

  // kickoff
  connect();

  function send(objOrString) {
    const data = typeof objOrString === "string" ? objOrString : JSON.stringify(objOrString);
    if (connected && ws?.readyState === WebSocket.OPEN) {
      ws.send(data);
      return;
    }
    // Not open: drop or buffer? For mailbox we prefer DROP here and let upper layer queue,
    // because queueing here hides ordering decisions from mailbox.
    throw new NoisyError({code: "NC_PROTOCOL", message: "ws_not_connected"});
  }

  function close(code = 1000, reason = "app_close") {
    closedByApp = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    try { ws?.close(code, reason); } catch {}
    // If underlying doesn’t fire onclose (rare), emit anyway
    if (connected === false) emit(onCloseHandlers, { code, reason });
  }

  return {
    send,
    close,
    get isConnected() { return connected; },
    onOpen(cb)    { onOpenHandlers.add(cb);    return () => onOpenHandlers.delete(cb); },
    onMessage(cb) { onMessageHandlers.add(cb); return () => onMessageHandlers.delete(cb); },
    onDown(cb)    { onDownHandlers.add(cb);    return () => onDownHandlers.delete(cb); },
    onUp(cb)      { onUpHandlers.add(cb);      return () => onUpHandlers.delete(cb); },
    onClose(cb)   { onCloseHandlers.add(cb);   return () => onCloseHandlers.delete(cb); },
  };
}
