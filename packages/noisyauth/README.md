
# @noisytransfer/noisyauth

SAS-based **authentication & key announcement** for NoisyTransfer sessions.  
Use this first to **distribute and authenticate** your **KEM (HPKE) public key** and your **signature public key** before starting an encrypted stream with `@noisytransfer/noisystream`.

- Transport-agnostic (`tx`): works over any **ordered** message channel (e.g., RTCDataChannel wrapper).
- Three-message handshake (non-blocking): **COMMIT → OFFER → REVEAL** (+ **RCVCONFIRM**).
- Human-verifiable **Short Authentication String (SAS)**.
- Policies: `"rtc"` (interactive) or `"ws_async"` (mailbox), with suitable timeouts.

> Under the hood, SAS is computed over the handshake frames, `roomId`, and `sessionId`.  
> Commitments use `SHA3-256` with label `"noisyauth"`.

---

## Install

```bash
npm i @noisytransfer/noisyauth
```

Requires Node 18+ (WebCrypto available on `globalThis.crypto`) or a modern browser.

---

## Transport interface

Noisyauth expects your transport to expose a minimal Tx-like API:

```ts
type TxLike = {
  send(frame: any): void;
  onMessage(cb: (frame: any) => void): () => void; // unsubscribe
  onDown?(cb: () => void): () => void;             // optional
  onClose?(cb: () => void): () => void;            // optional
  close?(): void;                                  // optional
};
```

Delivery must be **ordered**.

---

## Usage: authenticate and exchange public materials

You choose the payloads:
- `recvMsg` (receiver → sender): e.g., **HPKE public key bytes** + **signature verification key (SPKI)**, serialized to bytes (CBOR/JSON/DER — your choice).
- `sendMsg` (sender → receiver): same idea in the opposite direction.

```ts
import { createAuthReceiver, createAuthSender } from "@noisytransfer/noisyauth";
import { suite, genRSAPSS, importVerifyKey } from "@noisytransfer/crypto";

// Example: construct your advertised key bundle as bytes
async function makeKeyBundle() {
  // HPKE keypair
  const { publicKey } = await suite.kem.generateKeyPair();
  const hpkePub = await suite.kem.serializePublicKey(publicKey);
  // Signature keypair (RSA-PSS shown)
  const { verificationKey, signingKey } = await genRSAPSS();
  // We advertise the *public* verification key bytes (SPKI)
  const verifyKey = await importVerifyKey(verificationKey);
  const spkiBytes = new Uint8Array(verificationKey);
  // Bundle format is app-defined; keep it bytes
  const bundle = new Uint8Array(hpkePub.length + spkiBytes.length + 2);
  bundle.set(hpkePub, 0);
  bundle.set(new Uint8Array([0, 1]), hpkePub.length); // naive separator
  bundle.set(spkiBytes, hpkePub.length + 2);
  return { bundle, signingKey, spkiBytes };
}

const sessionId = crypto.randomUUID();
const roomId = "room-1234";

// Receiver side (announces `recvMsg` via COMMIT/REVEAL)
const { bundle: recvBundle } = await makeKeyBundle();
const R = createAuthReceiver(rawB, {
  onSAS: (sas) => ui.showSAS(sas),                 // show to user
  waitConfirm: (sas) => ui.confirmMatch(sas),      // user confirms
  onDone: ({ msgS }) => {
    // msgS is the *sender* key bundle (bytes)
    db.savePeerBundle(sessionId, msgS);
  },
}, {
  session: { policy: "rtc", sessionId, roomId },
  recvMsg: recvBundle,                              // REQUIRED: bytes you commit to
  // Optionally publish metadata in COMMIT — e.g., your identity label & verify key (SPKI)
  recvMeta: { id: "alice@example.com", vk: new Uint8Array(/* SPKI bytes */) },
});

// Sender side (announces `sendMsg` via OFFER)
const { bundle: sendBundle } = await makeKeyBundle();
const S = createAuthSender(rawA, {
  onSAS: (sas) => ui.showSAS(sas),
  waitConfirm: (sas) => ui.confirmMatch(sas),
  onDone: ({ msgR }) => {
    // msgR is the *receiver* key bundle (bytes)
    db.savePeerBundle(sessionId, msgR);
  },
}, {
  session: { policy: "rtc", sessionId, roomId },
  sendMsg: sendBundle,                              // OPTIONAL: defaults to random(32B)
  // If you already know the receiver identity, require it to match COMMIT.recv.id
  recvMeta: { id: "alice@example.com" },
});
```

What happens:
1. **Receiver** sends `COMMIT(commitment(recvMsg, nonce_R), algs, recvMeta?)`.
2. **Sender** replies `OFFER(msg_S, nonce_S)` (using `sendMsg`).
3. **Receiver** replies `REVEAL(msg_R, nonce_R)` (reveals its `recvMsg`).
4. Both compute **SAS**, your UI asks the user to confirm.
5. Each sends **RCVCONFIRM** → **READY**.

Your app consumes the **raw bytes** (`msgS`/`msgR`) in `onDone` and parses them into KEM/SPKI materials.

---

## API

### `createAuthReceiver(tx, hooks?, opts) → { close, getState, onState }`

**`opts`**
- `session?: { policy?: "rtc"|"ws_async", sessionId?: string, roomId?: string, nowMs?: () => number }`
- `recvMsg: Uint8Array | ArrayBuffer` **(required)** — the bytes your side is announcing
- `algs?: { kem?: string, kdf?: string }` — included in COMMIT (default `{ kem:"X25519Kyber25519", kdf:"HKDF-SHA-256" }`)
- `recvMeta?: { id: string | Uint8Array | ArrayBuffer, vk?: Uint8Array | ArrayBuffer }` — optional metadata (bound to COMMIT)

**`hooks`**
- `onSAS(sas: string)` — display to user
- `waitConfirm(sas: string): Promise<boolean>` — wait for user confirmation
- `onSASHash?(hex: string)` — hex digest of the SAS preimage (for logs/diagnostics)
- `onError?(err: any)` — fatal errors
- `onState?(s: AuthState)` — FSM transitions
- `onDone?({ msgS?: Uint8Array })` — called once READY (peer’s payload is available)

---

### `createAuthSender(tx, hooks?, opts) → { close, getState, onState }`

**`opts`**
- `session?: { policy?: "rtc"|"ws_async", sessionId?: string, roomId?: string, nowMs?: () => number }`
- `sendMsg?: Uint8Array | ArrayBuffer` — payload you announce (defaults to random(32))
- `recvMeta?: { id: string | Uint8Array | ArrayBuffer, vk?: Uint8Array | ArrayBuffer }` — **expected** receiver identity (compared against `COMMIT.recv` if present)

**`hooks`**
- same as the receiver; `onDone?({ msgR?: Uint8Array })` yields the receiver’s payload

---

## States

`"IDLE" | "WAIT_COMMIT" | "WAIT_OFFER" | "WAIT_REVEAL" | "SAS_CONFIRM" | "READY" | "ERROR" | "MALLORY"`

---

## Errors

All thrown as `NoisyError` with `.code` and optional `.more`. Common ones:
- `NC_BAD_PARAM`, `NC_PROTOCOL`
- `sender:peer_id_mismatch`
- `sender:commitment_mismatch`
- `sender:sas_rejected`
- `timeout_*` phase timeouts

---

## Integrating with `@noisytransfer/noisystream`

Typical flow in your CLI/app:

1. Run **noisyauth** to mutually display SAS and exchange **public materials** (your HPKE pubkey + signature SPKI) in `sendMsg`/`recvMsg`.
2. After `READY`, construct your HPKE/verification key objects from the received bytes.
3. Start **noisystream** with those keys to send encrypted data streams.

*(The encryption stack is implemented by `@noisytransfer/crypto`, which in turn wraps `hpke-js` for HPKE handling.)*

---

## License

AGPL-3.0 © NoisyTransfer
