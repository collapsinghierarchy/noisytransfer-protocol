
# @noisytransfer/noisystream

Encrypted, frame-based, **ordered**, backpressure‑aware **streaming of data sources** over any message transport (e.g., WebRTC `RTCDataChannel`).  
Each chunk is protected under a long‑lived HPKE context from `@noisytransfer/crypto`, and the **entire stream is signed** by the sender and verified by the receiver (required).

*(encryption built on top of `@noisytransfer/crypto`, which wraps `hpke-js` for the HPKE part)*

---

## Install

```bash
npm i @noisytransfer/noisystream
# peer
npm i @noisytransfer/crypto
```

Requires Node 18+ (WebCrypto on `globalThis.crypto`) or a modern browser.

---

## Supported data sources

You can stream any of the following as the `source`:

- `Uint8Array`, `ArrayBuffer` (and typed views)
- `Blob` (browser)
- **(Async)Iterable** of byte chunks (`Uint8Array`/`ArrayBuffer`), including Node.js `Readable` streams that implement `Symbol.asyncIterator`

For **buffer‑like** sources (Uint8Array/ArrayBuffer/Blob), the length is derived automatically.  
For **streaming** sources (AsyncIterable/Iterable), you **must** pass `totalBytes`.

---

## Quickstart (WebRTC‑style, mirrors the integration tests)

```ts
import wrtc from "@roamhq/wrtc";
import { randomBytes } from "node:crypto";
import { sendFileWithAuth, recvFileWithAuth } from "@noisytransfer/noisystream";
import { suite, genRSAPSS, importVerifyKey, sha256Hex } from "@noisytransfer/crypto";

// ... set up your ordered Tx-like transport objects: rawA (sender) and rawB (receiver)

// 1) Receiver prepares HPKE key pair and shares public key bytes
const { publicKey, privateKey } = await suite.kem.generateKeyPair();
const recipientPk = await suite.kem.serializePublicKey(publicKey);

// 2) Prepare signing (REQUIRED on both sides)
const { verificationKey, signingKey } = await genRSAPSS();
// In practice, the receiver should already know (or receive) the sender's public key.
// Here we import it locally for demonstration:
const verifyKey = await importVerifyKey(verificationKey);

// 3) Pick a dataset to send
const src = randomBytes(660_999);
const sessionId = crypto.randomUUID();

// 4) Receiver starts first (verifies signature)
const collected = [];
const recvP = recvFileWithAuth({
  tx: rawB,
  sessionId,
  hpke: { ownPriv: privateKey },
  // Provide a verifier OR rely on the sender embedding its SPKI in FIN.
  // Supplying verifyKey is the most explicit.
  sign: { verifyKey },
  sink: (u8) => collected.push(u8),
});

// 5) Sender starts and signs the stream
const sendP = sendFileWithAuth({
  tx: rawA,
  sessionId,
  source: src,                           // Uint8Array | ArrayBuffer | Blob | (Async)Iterable
  hpke: { peerMaterial: recipientPk },   // receiver's public key bytes
  // REQUIRED: sign with the sender's private key
  // Optionally include your public key SPKI so the receiver can verify without pre-config
  sign: { privateKey: signingKey, publicKeySpki: verificationKey },
});

// 6) Wait for completion and verify integrity out-of-band if desired
const [rx, tx] = await Promise.allSettled([recvP, sendP]);
// rx.value = { ok:true, bytes, frames, signatureVerified: true }
const received = Buffer.concat(collected);
console.log("hash:", await sha256Hex(received));
```

> **Transport contract:** noisystream assumes **ordered delivery**. If your transport can reorder or drop messages, add an outer sequencing/retry layer and deliver in order to `recvFileWithAuth`.

---

## API

### `sendFileWithAuth(opts) ⇒ Promise<{ ok:true, bytes:number, frames:number }>`
Sends `INIT` → waits `READY` → emits `DATA*` → sends `FIN` → (waits for `FIN_ACK` with bounded retries).

**Required**
- `tx: TxLike` — your transport
- `sessionId: string` — unique stream id per transfer
- `source: ByteSource` — the data source (see **Supported data sources**)
- `hpke: { peerMaterial: ByteLike }` — recipient’s public key bytes
- `sign: { privateKey: CryptoKey, publicKeySpki?: Uint8Array, alg?: string }` — **sender must sign**; include `publicKeySpki` if the receiver won’t have your pubkey out‑of‑band

**Useful options**
- `totalBytes?: number` — **required** for streaming sources; derived for buffers/Blob
- `chunkBytes?: number` — default `65536`
- `onProgress?: (sent:number, total:number)=>void`
- Flow control / finalize: `finAckTimeoutMs`, `finAckMaxRetries`, `finAckBackoffMs`, `adaptiveChunking`, `maxBufferedBytes`

---

### `recvFileWithAuth(opts) ⇒ Promise<{ ok:true, bytes:number, frames:number, signatureVerified: true }>`
Waits `INIT` → sends `READY` (optionally advertising credits) → decrypts `DATA` **in order** → verifies `FIN` (signature required) → sends `FIN_ACK`.

**Required**
- `tx: TxLike`, `sessionId: string`
- `hpke: { ownPriv: CryptoKey }`
- `sign: { verifyKey?: CryptoKey }` — **receiver must verify**  
  - Provide `verifyKey` **or** rely on the sender embedding `publicKeySpki` in `FIN` (recommended to still validate it against your trust model).

**Optional**
- `sink?: WritableLike | (u8:Uint8Array)=>any` — omit to buffer in memory (test helpers expose `result()`)
- `onProgress?`
- Flow control: `backlogChunks`, `backlogBytes`, `windowChunks`, `credit`

**Length check**
- If `INIT.totalBytes` is present, it is **authoritative**. A mismatch at finalize raises `NC_STREAM_MISMATCH`.

---

## Frame shapes (wire format)

All frames are JSON; binary fields are **base64url** strings.

```ts
type NsInit   = { type:"ns_init",  sessionId:string, totalBytes?:number, encTag?:string, hpkeEnc:string };
type NsReady  = { type:"ns_ready", sessionId:string, totalBytes?:number, features?:{ credit?:true }, windowChunks?:number };
type NsData   = { type:"ns_data",  sessionId:string, seq:number, chunk:string, aead?:true };
type NsCredit = { type:"ns_credit",sessionId:string, chunks:number };
type NsFin    = { type:"ns_fin",   sessionId:string, ok:boolean, errCode?:string, sig?:string, sigAlg?:string, sigPub?:string };
type NsFinAck = { type:"ns_fin_ack", sessionId:string };
```

---

## Flow control (credit mode)

If the receiver sends `READY` with `features.credit` and `windowChunks > 0`:

1. Sender begins with `credit = windowChunks`.
2. Each `DATA` consumes 1 credit; sender stalls when credit is 0.
3. Receiver issues `CREDIT {chunks}` as it decrypts/writes.
4. If `windowChunks === 0`, crediting is disabled and the sender transmits immediately (subject to transport backpressure).

---

## Errors

All errors are thrown as `NoisyError` with a machine‑readable `code`:
- `NC_BAD_PARAM` – option/validation failure
- `NC_ABORTED` – aborted via `AbortSignal`
- `NC_TX_SEND` / `NC_TX_CLOSED` – transport issues
- `NC_PROTOCOL` – out‑of‑order or unexpected frame
- `NC_STREAM_MISMATCH` – byte count mismatch at finalize
- `NC_SIGN_VERIFY_FAILED` – signature did not verify on the receiver

---

## License

AGPL‑3.0
