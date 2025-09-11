# @noisytransfer/noisystream

Frame-based, back-pressure-aware streaming utilities for NoisyTransfer.

- **Handshake**: `ns_init(totalBytes, encTag?) → ns_ready`.
- **Data**: `ns_data(seq++, ct)` frames until done.
- **Finalize**: `ns_fin(ok)` (optionally `ns_fin_ack` with retries/backoff).

## Install

```bash
npm i @noisytransfer/noisystream
```

## Quickstart

```js
import { sendFileWithAuth, recvFileWithAuth } from "@noisytransfer/noisystream";

const tx = makeYourTransport();
const sessionId = "session-123";

// Receiver side
const rcv = recvFileWithAuth({
  tx,
  sessionId,
  sink: {
    write: (u8) => chunks.push(u8),
    close: () => console.log("done"),
  },
  onProgress: (rcvd, total) => console.log({ rcvd, total }),
});

// Sender side
const fileBytes = await file.arrayBuffer();
await sendFileWithAuth({
  tx,
  sessionId,
  source: new Uint8Array(fileBytes),
  totalBytes: fileBytes.byteLength, // required for streaming sources
  chunkBytes: 64 * 1024,
  onProgress: (sent, total) => console.log({ sent, total }),
  finAck: true, // wait for ns_fin_ack with retries
});
```

## API

### `sendFileWithAuth(opts) → Promise<{ ok:true, bytesSent, frames }>`

**Opts**

```ts
type SendOpts = {
  tx: { send:(f:any)=>void, onMessage:(cb)=>()=>void, onClose?:(cb)=>()=>void, close?():void },
  sessionId: string,
  source: Uint8Array | ArrayBuffer | Blob | AsyncIterable<Uint8Array|ArrayBuffer> | Iterable<...>,
  totalBytes?: number,             // REQUIRED if source length can’t be derived
  chunkBytes?: number,             // default 65536
  encTag?: Uint8Array|ArrayBuffer|null, // echoed in ns_init; caller-defined
  onProgress?: (sent:number,total:number)=>void,
  abortSignal?: AbortSignal,

  // finalization behavior:
  finAck?: boolean,                // default false
  finAckTimeoutMs?: number,        // default 5000
  finAckMaxRetries?: number,       // default 3
  finAckBackoffMs?: number,        // default 100 (linear backoff)
  adaptiveChunking?: boolean,      // default false; tweaks size using tx.bufferedAmount
}
```

Throws `NoisyError` with codes like `NC_BAD_PARAM`, `NC_TX_SEND`, `NC_TRANSPORT_FLUSH_TIMEOUT`. Progress is best-effort; it counts bytes successfully queued into frames.

### `recvFileWithAuth(opts) → Promise<{ ok:true, bytes, frames }>`

**Opts**

```ts
type WritableLike = { write(u8: Uint8Array): any; close?(): any };
type RecvOpts = {
  tx;
  sessionId: string;
  sink?: WritableLike | ((u8: Uint8Array) => any); // if omitted, data buffers in memory
  expectBytes?: number; // guard: mismatch throws
  abortSignal?: AbortSignal;
  onProgress?: (rcvd: number, total: number) => void;
};
```

Return fields:

- If no `sink` provided: resolves with `{ bytes: Uint8Array, frames }`.
- If `sink` provided: `{ bytes: number, frames }` (bytes written).

### Frames & helpers

Exports in `frames`:

- `STREAM` constants (`INIT|READY|DATA|FIN|FIN_ACK`)
- `packStreamInit/Ready/Data/Fin/FinAck`, `parseStream*`
- Type guards: `isStreamInit/Ready/Data/Fin`

Sequence:

```
sender: ns_init(totalBytes, encTag?)  →  receiver: ns_ready
sender: ns_data #1..N                  →  receiver: write()
sender: ns_fin(ok)                     →  receiver: ns_fin_ack (optional)
```

Got it—here’s a tight README snippet using **`windowChunks`** and **`credit`** only.

# Flow control: `windowChunks` & `credit`

Noisystream uses credit-based flow control:

* **`windowChunks`** (announced by the receiver in `READY`): the **initial in-flight allowance** in **chunks**.
  When the sender sees `READY { windowChunks }`, it sets `credit = windowChunks` and may transmit up to that many `DATA` frames immediately (1 chunk = 1 credit).

* **`credit`** (granted by the receiver via `CREDIT` frames): the **refill size**.
  As the receiver decrypts/writes data, it periodically sends `CREDIT { chunks: credit }` to **add** that many credits back to the sender, regulating throughput over time.

### Lifecycle

1. Receiver starts and sends `READY { windowChunks, … }`.
2. Sender sets `credit = windowChunks` and sends up to `credit` chunks (each `DATA` consumes 1 credit).
3. Receiver processes data and sends `CREDIT { chunks: credit }` to replenish.
4. Sender pauses when `credit === 0`, resumes when more credit arrives.

### Tuning

* A good start: `windowChunks = 8` or `16`, `credit = 4`.
* Larger **`windowChunks`** → more in-flight data (better for high-latency/high-bandwidth links), but more buffering.
* Smaller **`credit`** → smoother pacing but more control frames; larger **`credit`** → fewer control frames but burstier refills.
* Setting **`windowChunks = 0`** disables credit-based control (sender can “firehose”; only transport backpressure applies).

### Example

```js
// Receiver
await recvFileWithAuth({
  tx,
  sessionId,
  windowChunks: 8,  // allow up to 8 chunks in flight initially
  credit: 4,        // grant 4 new credits per CREDIT frame
  hpke: { ownPriv },// receiver KEM private key bytes
});

// Sender
await sendFileWithAuth({
  tx,
  sessionId,
  source,           // Uint8Array / ArrayBufferView
  chunkBytes: 64 * 1024,
  hpke: { peerMaterial }, // recipient KEM public key bytes
});
```

**Rule of thumb:**
**`windowChunks`** = how far the sender can run at once.
**`credit`** = how many new tickets the receiver hands out each time.


APIs are unstable and may evolve.
