# @noisytransfer/transport

A tiny set of transport adapters that normalize different realtime links (WebRTC data channels, resilient WebSockets / mailbox) into a single, minimal interface used by NoisyTransfer packages.

> **Contract first.** All adapters expose the same `TxLike` shape so higher-level modules (`noisyauth`, `noisystream`, etc.) don’t care how bytes move.

## TL;DR: the `TxLike` contract

```ts
type Unsub = () => void;

export interface TxLike {
  /** Queue an outbound frame (already serialized by caller). */
  send(frame: any): void;
  /** Subscribe to inbound frames. Returns an unsubscribe. */
  onMessage(cb: (frame: any) => void): Unsub;
  /** Optional: notified when the underlying link is permanently closed. */
  onClose?(cb: () => void): Unsub;
  /** Optional: close the link (best-effort). */
  close?(): void;
  /** Optional: backpressure hint (like WebSocket/RTC bufferedAmount). */
  bufferedAmount?: number;
  /** Optional: connectivity events for RTC-style policies. */
  onUp?((info?: any) => void): Unsub;
  onDown?((reason?: any) => void): Unsub;
}
```

If your environment provides a raw WebSocket or RTCDataChannel, you can wrap it into a `TxLike` yourself, or use the helpers in this package.

---

## Packages / Modules

- `webrtc/*`: Create an RTC peer connection (initiator/responder) and expose a `TxLike` backed by a DataChannel.  
- `ws/*`: Resilient WebSocket & simple mailbox transport; good for async/“store-and-forward” signaling/transfer.  
- `flush`: A portable `flush(tx)` helper that waits until the underlying transport queues are empty (with a timeout).  
- `ser`: Base64 helpers for binary payloads where needed (`b64`, `unb64`).  
- `rtc-utils`: Low-level utilities such as `hardCloseRTC` to aggressively drain and close a PC/DC.

Each module is small and standalone—you can import exactly what you need.

---

## WebRTC transport

### Initiator / Responder

```js
import { rtcInitiator } from "@noisytransfer/transport/webrtc/initiator.js";
import { rtcResponder } from "@noisytransfer/transport/webrtc/responder.js";

/**
 * The "signal" arg should be an object with two async functions:
 *   - send(msg: any): Promise<void>   // deliver to the remote peer
 *   - onMessage(cb): Unsub            // subscribe to remote signaling messages
 * You can back it by your own signaling layer (WS, REST, etc.).
 */
const txA = await rtcInitiator(signalA, {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  nonTrickle: false,            // optional; see env below
  debug: false,                 // toggles verbose console logs
});

const txB = await rtcResponder(signalB, {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  nonTrickle: false,
});
```

**What you get:** a `TxLike` backed by an RTCDataChannel. The adapter will keep `tx.bufferedAmount` up to date so higher layers can apply adaptive chunking.

**Connectivity hooks (optional):**
```js
const offUp = txA.onUp?.(() => console.log("RTC up"));
const offDown = txA.onDown?.((why) => console.warn("RTC down", why));
const offClosed = txA.onClose?.(() => console.log("RTC closed"));
```

**Environment knobs (read at runtime):**
- `NOISY_RTC_ICE_TIMEOUT_MS` — override ICE gathering/connection timeout (default ~15000ms).
- `NOISY_RTC_NON_TRICKLE` — set to `1/true` to force non-trickle SDP exchange.
- `NOISY_DEBUG_RTC` or `NT_DEBUG_RTC` — set to enable verbose RTC logging.

### Hard close (drain and tear down quickly)

```js
import { hardCloseRTC } from "@noisytransfer/transport/webrtc/rtc-utils.js";

await hardCloseRTC(pc, { dc, timeout: 300 }); // closes DC (if provided), waits briefly, then closes the PC
```

> Internally used by the transport to avoid lingering tasks during teardown.

---

## WebSocket / Mailbox transport

### Resilient WebSocket

```js
import { connectWs } from "@noisytransfer/transport/ws/ws.js";

const tx = await connectWs("wss://example.com/endpoint", {
  protocols: ["binary"],
  maxRetries: Infinity,
  backoffMs: [250, 500, 1000, 2000, 5000],
  // Custom constructor for non-browser envs (e.g., `ws` in Node):
  wsConstructor: (url, protocols) => new WebSocket(url, protocols),
});
```

The returned `tx` implements `TxLike`. It auto-reconnects with the provided backoff policy and emits `onClose` once it’s done retrying (or on terminal error).

### Mailbox transport

For store-and-forward messaging (great for signaling or async transfers):

```js
import { mkMailbox } from "@noisytransfer/transport/ws/mailbox.js";

const base = "https://mailbox.example.com"; // no trailing slash
const room = "room-123";                     // any string/UUID
const sessionId = crypto.randomUUID();       // fresh per logical peer

const tx = await mkMailbox(base, {
  room,
  side: "A",                 // or "B"
  sessionId,
  deliveredUpTo: 0,          // optional resume offset
});
```

**Semantics:**
- `send(frame)` POSTs or WS-sends to the server with monotonic sequence numbers.
- `onMessage(cb)` receives frames in-order; the client acknowledges delivery (`deliveredUpTo`) so you can resume after a reconnect.
- `onClose(cb)` fires if the mailbox session is torn down.

> Use this for low-friction signaling between RTC peers, or as a fallback transport when P2P is not available.

---

## Flushing

Some transports (WS/RTC) buffer writes. To ensure “everything that was `send`’d has left the process” (or a timeout occurs), use `flush`:

```js
import { flush } from "@noisytransfer/transport/flush.js";

await flush(tx, { timeout: 2000 }); // resolves when bufferedAmount drains to ~0 or timeout
```

**Env override:** `NOISY_TRANSPORT_FLUSH_TIMEOUT_MS` (number, ms).

---

## Serialization helpers

Minimal helpers used by transports when they need to encode/decode opaque bytes:

```js
import { toBase64, fromBase64 } from "@noisytransfer/transport/ser.js";

const b64 = toBase64(new Uint8Array([1,2,3]));
const u8 = fromBase64(b64);
```

The helpers use Node’s `Buffer` when available and fall back to `atob`/`btoa` in browsers.

---

## Error handling

Transports throw `NoisyError` (from `@noisytransfer/errors`) with a `code` and context:

- `NC_TX_SEND` — underlying socket/channel rejected a `send` or is closed.
- `NC_TRANSPORT_FLUSH_TIMEOUT` — `flush()` timed out before the buffer drained.
- RTC-specific issues are surfaced via `onDown` and ultimately `onClose`.

Always catch and inspect `err.code` for programmatic handling.

---

## Usage patterns

### 1) Use with `noisyauth`+`noisystream`

```js
import { rtcInitiator } from "@noisytransfer/transport/webrtc/initiator.js";
import { createAuthSender } from "@noisytransfer/noisyauth";
import { sendFileWithAuth } from "@noisytransfer/noisystream";

const tx = await rtcInitiator(signal, { iceServers });
const auth = createAuthSender(tx, { waitConfirm: async () => true });
await sendFileWithAuth({ tx, sessionId: "s1", source: fileBytes, totalBytes: fileBytes.byteLength });
```

### 2) Graceful teardown

```js
import { flush } from "@noisytransfer/transport/flush.js";

await flush(tx);        // wait for the last frames
tx.close?.();           // then close
```

---

## Configuration & defaults

- All adapters are **ESM** and **tree-shakeable**; packages set `"sideEffects": false`.
- Timeouts default to sensible values for interactive RTC; override via env or function args.
- Backpressure is best-effort: `bufferedAmount` mirrors native properties when they exist.

---

## FAQ

**Q: Do I have to use your WebSocket or mailbox?**  
No. If you have your own signaling or message channel, implement the `TxLike` shape and plug it into `noisyauth` / `noisystream` directly.

**Q: How do I detect connectivity for policy `"rtc"`?**  
Use `onUp`/`onDown` if present; otherwise assume the transport is available immediately after creation.

**Q: Is serialization opinionated?**  
No. Transports move opaque frames. Upstream libs decide how to pack/unpack them.

---

## Changelog (transport)
See the top-level repo `CHANGELOG.md` for release notes that affect transports (timeouts, reconnection, fixes).
