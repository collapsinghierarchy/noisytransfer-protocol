import { browserWSWithReconnect } from "@noisytransfer/transport";

// send({type:'offer'|'answer'|'ice', ...})
export function makeSignal(signalUrl, room, side) {
  const url = `${signalUrl}?appID=${encodeURIComponent(room)}&side=${encodeURIComponent(side)}`;
  const wsTx = browserWSWithReconnect(url, { maxRetries: 10 }); // reconnect a few times
  const outQ = [];
  const flush = () => {
    while (outQ.length && wsTx.isConnected) {
      const m = outQ.shift();
      try { wsTx.send(m); } catch { outQ.unshift(m); break; }
    }
  };
  wsTx.onUp(flush);

  return {
    send: (m) => { if (wsTx.isConnected) wsTx.send(m); else outQ.push(m); },
    onMessage: (cb) => wsTx.onMessage((msg) => {
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "offer": case "answer": case "ice": cb(msg); break;
      }
    }),
    onClose: (cb) => wsTx.onClose(cb),
    close: (...a) => wsTx.close?.(...a)
  };
}
