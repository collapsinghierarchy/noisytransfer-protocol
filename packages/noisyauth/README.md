# @noisytransfer/noisyauth

SAS-based authentication state machines for establishing a NoisyTransfer session.

- **Transport-agnostic**: works over any durable, ordered message channel (`tx`).
- **Three messages** (non-blocking): `commit` → `offer` → `reveal` (+ `rcvconfirm`).
- **Human verification**: Short Authentication String (SAS) computed on both sides.
- **Policies**: `"rtc"` (interactive timeouts) or `"ws_async"` (mailbox style).

## Install

```bash
npm i @noisytransfer/noisyauth
```

## Quickstart

```js
import { createAuthSender, createAuthReceiver } from "@noisytransfer/noisyauth";

// tx must provide: send(frame), onMessage(cb)=>unsub, onClose?(cb)=>unsub, close?()
const tx = makeYourTransport();

const receiver = createAuthReceiver(tx, {
  onSAS: (sas) => showToUser("Receiver SAS", sas),
  onSASHash: (hex) => console.debug("Full SAS hash", hex),
  waitConfirm: async (sas) => confirmWithUser(sas), // must resolve true/false within timeout
  onDone: ({ msgS }) => console.log("Auth READY (receiver). msgS length:", msgS?.byteLength),
  onError: (e) => console.error(e),
});

const sender = createAuthSender(
  tx,
  {
    onSAS: (sas) => showToUser("Sender SAS", sas),
    onSASHash: (hex) => console.debug("Full SAS hash", hex),
    waitConfirm: async (sas) => confirmWithUser(sas),
    onDone: ({ msgR }) => console.log("Auth READY (sender). msgR length:", msgR?.byteLength),
    onError: (e) => console.error(e),
  },
  {
    // session options (see below)
  }
);
```

## API

### `createAuthSender(tx, hooks?, opts?)`

### `createAuthReceiver(tx, hooks?, opts?)`

Both return:

```ts
{
  close(): void;                        // aborts and tears down listeners
  getState(): "IDLE"|"WAIT_COMMIT"|"WAIT_OFFER"|"WAIT_REVEAL"|"SAS_CONFIRM"|"READY"|"ERROR"|"MALLORY";
  onState(cb: (state:string)=>void): () => void; // subscribe to FSM transitions
}
```

### Transport contract (`tx`)

- `send(frame: any): void`
- `onMessage(cb: (frame:any)=>void): () => void` — subscribe to inbound frames
- `onClose?(cb: ()=>void): () => void` — notified if underlying link drops
- `close?(...args:any[]): void`

If your transport supports connectivity callbacks, `attachTransportLifecycle` will start the FSM on `onUp()` for `"rtc"` policy; otherwise it starts immediately.

### Hooks

| Hook                                   | When it fires                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `onState(s)`                           | Any FSM transition (`IDLE → … → READY / ERROR / MALLORY`).                     |
| `onError(err)`                         | Fatal protocol/transport error.                                                |
| `onSAS(sas)`                           | After both sides can compute the SAS (6-digit DECIMAL by default).             |
| `onSASHash(hex)`                       | Full SAS transcript hash (hex); useful for out-of-band checks.                 |
| `waitConfirm(sas) => Promise<boolean>` | **Required** for interactive flows. Must resolve within timeout or auth fails. |
| `onDone({ msgR                         | msgS })`                                                                       | Transitioned to `READY`. **Sender** receives `{ msgR }`. **Receiver** receives `{ msgS }`. |

### Options

Common `session` opts (you can pass them at top level or under `session`):

```ts
{
  policy?: "rtc" | "ws_async"         // default "ws_async"
  sessionId?: string                  // default: random UUID
  roomId?: string                     // default: tx.room or "unknown-room"
  nowMs?: ()=>number                  // for testing; default: Date.now
}
```

Sender-specific:

```ts
{
  sendMsg?: ArrayBuffer|Uint8Array     // default: random 32 bytes (msg_S)
  // Optional receiver metadata binding (will be checked against commit frame):
  recvMeta?: string|Uint8Array|ArrayBuffer
}
```

Receiver-specific:

```ts
{
  recvMsg: ArrayBuffer|Uint8Array      // REQUIRED (msg_R)
  algs?: { kem?: string, kdf?: string } // default: { kem:"X25519Kyber25519", kdf:"HKDF-SHA-256" }
}
```

### Timeouts

Timeouts are policy-driven via `@noisytransfer/constants`:

- `"rtc"` defaults (overridable via env): `WAIT_*: 8000ms`, `SAS_CONFIRM: 12000ms`.
- `"ws_async"`: effectively no pre-SAS timeouts; `SAS_CONFIRM` is 30 minutes.

Env overrides (honored if set):

```
NOISYAUTH_WAIT_COMMIT_MS
NOISYAUTH_WAIT_OFFER_MS
NOISYAUTH_WAIT_REVEAL_MS
NOISYAUTH_WAIT_CONFIRM_MS
```

### Error codes (thrown via `NoisyError`)

- `NC_BAD_PARAM`, `NC_PROTOCOL`, plus auth-specific failures like `"sender:commit_mismatch"`, `"receiver:sas_rejected"`. Always inspect `err.code` and `err.more` (when present).

### Sequence

```
Receiver: commit(commitment, algs, recvMeta?)  →  Sender: offer(msg_S, nonce_S)
Receiver: reveal(msg_R, nonce_R)  →  both compute SAS  →  UI waitConfirm()
Receiver: rcvconfirm  →  READY
```

APIs are unstable and may change without warning.
