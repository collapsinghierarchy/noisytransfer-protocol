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

APIs are unstable and may evolve.
