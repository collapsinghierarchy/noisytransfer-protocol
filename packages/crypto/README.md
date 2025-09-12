
# @noisytransfer/crypto — HPKE (Hybrid X25519+Kyber768) channel helpers

A thin, safe wrapper around [`hpke-js`](https://github.com/dajiaji/hpke-js) that gives you **long‑lived HPKE contexts** (one encapsulation, many messages), plus a simple streaming facade. Built for ordered transports (e.g., RTCDataChannel with `ordered: true`).

> **What changed?**
> - We encapsulate **once** and reuse a sender/recipient context.
> - We queue concurrent `seal()`/`open()` calls to respect HPKE’s internal nonce counter.
> - We pass **AAD** through consistently.
> - All byte outputs are **`Uint8Array`** for ergonomic equality/serialization.
> - `mkAeadStreamFromHpke(..., { id })` **honors caller-supplied IDs** verbatim (no auto-prefix).

---

## Install

```bash
npm i @noisytransfer/crypto
```

This package assumes a modern runtime with WebCrypto and `TextEncoder`/`TextDecoder` available.

---

## Quick start

```ts
import { suite } from "@noisytransfer/crypto"; // your configured CipherSuite
import { createSenderSession, createReceiverSession, mkAeadStreamFromHpke } from "@noisytransfer/crypto";

// 1) generate recipient keypair & publish public key bytes
const kp = await suite.kem.generateKeyPair();
const pubBytes = await suite.kem.serializePublicKey(kp.publicKey);

// 2) set up HPKE contexts (one encapsulation)
const sender = await createSenderSession(pubBytes);
const receiver = await createReceiverSession(sender.enc, kp.privateKey);

// 3) send multiple messages under the same context
const ct1 = await sender.seal(new TextEncoder().encode("alpha"));
const ct2 = await sender.seal(new TextEncoder().encode("beta"));

console.log(new TextDecoder().decode(await receiver.open(ct1))); // "alpha"
console.log(new TextDecoder().decode(await receiver.open(ct2))); // "beta"
```

### Streaming (ordered channels)

```ts
const streamId = "my-app/stream/v1:abc123"; // supply your own ID for AAD/telemetry
const send = await mkAeadStreamFromHpke("sender", pubBytes, undefined, { id: streamId });
const recv = await mkAeadStreamFromHpke("receiver", send.enc, kp.privateKey, { id: streamId });

// Encrypt chunks (parallel calls are queued internally)
const chunks = ["alpha","beta","gamma"].map(x => new TextEncoder().encode(x));
const cts = await Promise.all(chunks.map(c => send.seal(c)));

// Decrypt in order (parallel-safe; internally serialized)
for (const ct of cts) {
  const pt = await recv.open(ct);
  console.log(new TextDecoder().decode(pt));
}
```

---

## API

### `createSenderSession(receiverPublicKey[, opts]) => Promise<SenderSession>`

Creates a long‑lived HPKE **sender** context and performs **one** encapsulation.

- `receiverPublicKey`: `Uint8Array|ArrayBuffer` — bytes of the recipient’s public key (use `suite.kem.serializePublicKey`).
- `opts.timeoutMs?: number` — default `30_000`.

**Returns:**

```ts
type SenderSession = {
  enc: Uint8Array; // send once to the receiver
  seal(pt: Uint8Array|ArrayBuffer, aad?: Uint8Array|ArrayBuffer): Promise<Uint8Array>;
  exportSecret?(info: Uint8Array|ArrayBuffer, len: number): Promise<Uint8Array>;
  // alias:
  hpkeSeal: SenderSession["seal"];
};
```

Notes:
- `seal()` calls are **serialized** to avoid nonce/counter races.
- All outputs are `Uint8Array`.

### `createReceiverSession(enc, recipientPrivateKey[, opts]) => Promise<ReceiverSession>`

- `enc`: `Uint8Array|ArrayBuffer` — sender’s encapsulated key (from `sender.enc`).
- `recipientPrivateKey`: `CryptoKey` — the recipient’s HPKE private key.
- `opts.timeoutMs?: number` — default `30_000`.

**Returns:**

```ts
type ReceiverSession = {
  open(ct: Uint8Array|ArrayBuffer, aad?: Uint8Array|ArrayBuffer): Promise<Uint8Array>;
  exportSecret?(info: Uint8Array|ArrayBuffer, len: number): Promise<Uint8Array>;
  // alias:
  hpkeOpen: ReceiverSession["open"];
};
```

Notes:
- `open()` calls are also **serialized** defensively.

### `mkAeadStreamFromHpke(role, arg1, arg2, opts?)`

Streaming-friendly facade around the sessions.

- `role`: `"sender"` or `"receiver"`.
- `arg1`:
  - sender: recipient public key bytes.
  - receiver: the `enc` value from the sender.
- `arg2`:
  - sender: `undefined`.
  - receiver: recipient private `CryptoKey`.
- `opts.id?: string` — **caller-supplied stream ID**, used verbatim on both sides.
- `opts.timeoutMs?: number` — default `30_000`.

**Returns (sender):**
```ts
{
  id: string,          // === opts.id if provided, else base64url(enc)
  enc: Uint8Array,     // send with your control message
  seal(pt: Uint8Array|ArrayBuffer, aad?: Uint8Array|ArrayBuffer): Promise<Uint8Array>,
  open(): never,       // throws: sender doesn’t decrypt
}
```

**Returns (receiver):**
```ts
{
  id: string,          // === opts.id if provided, else base64url(enc)
  open(ct: Uint8Array|ArrayBuffer, aad?: Uint8Array|ArrayBuffer): Promise<Uint8Array>,
  seal(): never,       // throws: receiver doesn’t encrypt
}
```

---

## Design notes

- **Context reuse:** Using `CipherSuite.createSenderContext` / `createRecipientContext` once and reusing is far cheaper than `suite.seal()` per message (which would re‑encapsulate).
- **Nonce & ordering:** HPKE contexts maintain a monotonic message counter. Calls are serialized internally to preserve the sequence even if user code fires them in parallel.
- **AAD passthrough:** Whatever AAD you pass into `seal()` must be provided verbatim to `open()`.
- **IDs:** We do **not** invent prefixes. If your application has an AAD/telemetry contract, pass `{ id: ... }` and we’ll honor it exactly.
- **Bytes:** We normalize to `Uint8Array` so Node’s `assert.deepStrictEqual` works as expected.

---

## Testing

### Concurrency safety

```ts
import { suite, createSenderSession, createReceiverSession } from "@noisytransfer/crypto";
import { strict as assert } from "node:assert";

test("HPKE context serializes parallel seal/open", async () => {
  const kp = await suite.kem.generateKeyPair();
  const pub = await suite.kem.serializePublicKey(kp.publicKey);

  const sender = await createSenderSession(pub);
  const recv = await createReceiverSession(sender.enc, kp.privateKey);

  const chunks = Array.from({ length: 8 }, (_, i) => new TextEncoder().encode(`m${i}`));
  const cts = await Promise.all(chunks.map(c => sender.seal(c)));
  const pts = await Promise.all(cts.map(ct => recv.open(ct)));
  assert.equal(new TextDecoder().decode(pts.at(0)), "m0");
  assert.equal(new TextDecoder().decode(pts.at(-1)), "m7");
});
```

### ID contract

```ts
import { mkAeadStreamFromHpke, suite } from "@noisytransfer/crypto";
import { strict as assert } from "node:assert";

test("mkAeadStreamFromHpke honors caller-supplied id", async () => {
  const kp = await suite.kem.generateKeyPair();
  const pub = await suite.kem.serializePublicKey(kp.publicKey);
  const id = "my/app/stream:v1:xyz";

  const send = await mkAeadStreamFromHpke("sender", pub, undefined, { id });
  const recv = await mkAeadStreamFromHpke("receiver", send.enc, kp.privateKey, { id });

  assert.equal(send.id, id);
  assert.equal(recv.id, id);
});
```

Run all tests with:

```bash
NODE_OPTIONS="--preserve-symlinks --preserve-symlinks-main" node --test
```

---

## Security & limits

- **Message cap:** HPKE contexts have a finite message limit; plan to rekey if you stream large volumes.
- **Ordered transports:** This module assumes ordered delivery. If your transport can reorder/drop packets, add an outer framing with indices and replay checks, and wire those into AAD.
- **Key hygiene:** Zeroize exported material when possible, and avoid logging keys/AADs in production.
- **Experimental KEM:** `@hpke/hybridkem-x25519-kyber768` has been experimental/deprecated in upstream notes. Keep an eye on ML‑KEM or newer hybrid KEMs.

---

## License

MIT © NoisyTransfer
