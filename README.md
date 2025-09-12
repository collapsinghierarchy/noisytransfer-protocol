
# NoisyTransfer Protocol

[![License](https://img.shields.io/badge/License-Multi--license-blue.svg?style=flat-square)](./LICENSE-APACHE-2.0) [![CI](https://github.com/collapsinghierarchy/noisytransfer-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/collapsinghierarchy/noisytransfer-protocol/actions/workflows/ci.yml)

> Monorepo of cryptographic, WebRTC, and transport primitives for **encrypted, signed streaming** over ordered message channels.

- **Node 20+** required (uses WebCrypto on `globalThis.crypto`).
- Encryption/signature primitives are provided by `@noisytransfer/crypto` *(which wraps `hpke-js` for HPKE handling)*.
- Typical flow in apps/CLI: **noisyauth → noisystream** (authenticate keys, then stream encrypted data).

---

## Packages

| Package                                                                                                        | Version                                                                                          | What it is (one‑liner)                                                                        |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [`@noisytransfer/crypto`](https://www.npmjs.com/package/@noisytransfer/crypto)                                 | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fcrypto?style=flat-square)                 | HPKE (X25519+Kyber768), AES‑GCM, hashes, signatures; helpers & contexts.                      |
| [`@noisytransfer/transport`](https://www.npmjs.com/package/@noisytransfer/transport)                           | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Ftransport?style=flat-square)              | WebSocket reconnect, WebRTC initiator/responder, simple Tx adapters.                          |
| [`@noisytransfer/noisyauth`](https://www.npmjs.com/package/@noisytransfer/noisyauth)                           | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fnoisyauth?style=flat-square)              | SAS‑based authentication + **distribution of KEM & signature public keys**.                   |
| [`@noisytransfer/noisystream`](https://www.npmjs.com/package/@noisytransfer/noisystream)                       | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fnoisystream?style=flat-square)            | **Encrypted, ordered** streaming of data sources; per‑chunk HPKE; stream **signature**.       |                                    |
| [`@noisytransfer/errors`](https://www.npmjs.com/package/@noisytransfer/errors)                                 | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Ferrors?style=flat-square)                 | `NoisyError` + error codes/utilities.                                                         |
| [`@noisytransfer/util`](https://www.npmjs.com/package/@noisytransfer/util)                                     | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Futil?style=flat-square)                   | Base64url/buffer/async helpers, logging, small utils.                                         |
| [`@noisytransfer/constants`](https://www.npmjs.com/package/@noisytransfer/constants)                           | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fconstants?style=flat-square)              | Shared constants and types.                                                                   |

> Some internal tooling (e.g. `@noisytransfer/test-helpers`) is primarily for development/CI.

---

## Install

Use only what you need; all packages are ESM.

```bash
npm i @noisytransfer/crypto @noisytransfer/transport @noisytransfer/noisyauth @noisytransfer/noisystream
```

---

## Quick Start (auth → encrypted stream)

> **Contract:** transports must deliver messages **in order** (e.g., an ordered `RTCDataChannel`).

```ts
import { rtcInitiator, rtcResponder } from "@noisytransfer/transport";
import { createAuthSender, createAuthReceiver } from "@noisytransfer/noisyauth";
import { sendFileWithAuth, recvFileWithAuth } from "@noisytransfer/noisystream";
import { suite, genRSAPSS, importVerifyKey } from "@noisytransfer/crypto";

// 1) Set up a transport pair (shape: { send, onMessage } with ordered delivery)
const A = await rtcInitiator(signalA, { iceServers: [] });
const B = await rtcResponder(signalB,   { iceServers: [] });

// 2) Receiver prepares HPKE key pair and a verification key (SPKI) to advertise
const { publicKey, privateKey } = await suite.kem.generateKeyPair();
const hpkePubBytes = await suite.kem.serializePublicKey(publicKey);
const { verificationKey, signingKey } = await genRSAPSS();
const verifyKey = await importVerifyKey(verificationKey);

// 3) Run noisyauth to exchange & authenticate public materials (KEM+SPKI)
//    Each side passes opaque byte bundles; noisyauth binds them with SAS.
createAuthReceiver(B, {
  onSAS: showSAS, waitConfirm: confirmSAS,
  onDone: ({ msgS }) => db.savePeerBundle("peer", msgS),
}, { session: { policy: "rtc", sessionId: crypto.randomUUID() }, recvMsg: hpkePubBytes});

createAuthSender(A, {
  onSAS: showSAS, waitConfirm: confirmSAS,
  onDone: ({ msgR }) => db.savePeerBundle("peer", msgR),
}, { session: { policy: "rtc", sessionId: /* same */ "" }, sendMsg: verificationKey });

// 4) Start encrypted, signed stream (sender signs; receiver verifies)
const sessionId = crypto.randomUUID();

const recvP = recvFileWithAuth({
  tx: B,
  sessionId,
  hpke: { ownPriv: privateKey },
  sign: { verifyKey },                 // receiver must verify sender's signature
  sink: (u8) => sinkWriter.write(u8),
});

const sendP = sendFileWithAuth({
  tx: A,
  sessionId,
  source: new Uint8Array([1,2,3]),    // Buffer | ArrayBuffer | Blob | (Async)Iterable<bytes>
  hpke: { peerMaterial: hpkePubBytes },
  sign: { privateKey: signingKey, publicKeySpki: verificationKey }, // sender signs stream
});

await Promise.allSettled([recvP, sendP]);
```

---

## Data sources supported by `noisystream`

- `Uint8Array`, `ArrayBuffer` (and typed views)
- `Blob` (browser)
- **(Async)Iterable** of byte chunks — including Node streams that implement `Symbol.asyncIterator`

For streaming sources, you must pass `totalBytes`; for buffer/Blob, length is derived.

---

## Monorepo layout

```
packages/
  crypto/
  transport/
  noisyauth/
  noisystream/
  noisycache/
  errors/
  util/
  constants/
  noisytransfer-protocol/
```

---

## Contributing & development

```bash
npm ci
npm run test
NOISY_LOG_LEVEL=debug CI_ALLOW_INTEGRATION=1 TEST_SIGNAL_MODE=memory node --test
```

Please open issues/PRs with logs and reproduction steps when possible.

---

## Licensing

This monorepo is **multi‑licensed** at the package level:

- **AGPL‑3.0‑only**
  - `@noisytransfer/noisystream` – encrypted, ordered streaming of data sources
  - `@noisytransfer/noisyauth` – SAS‑based authentication & key announcement
  - `@noisytransfer/noisycache` – Deprecated

- **Apache‑2.0**
  - `@noisytransfer/crypto` – HPKE & signatures toolkit (wraps hpke-js for HPKE handling)
  - `@noisytransfer/constants`, `@noisytransfer/errors`, `@noisytransfer/util`,
    `@noisytransfer/transport`, `@noisytransfer/noisycache`,
    `@noisytransfer/noisytransfer-protocol`, `@noisytransfer/test-helpers`

Each published package includes its own `LICENSE` file; the repo root also ships
`LICENSE-APACHE-2.0` and `LICENSE-AGPL-3.0` for convenience.
