# NoisyTransfer Protocol

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg?style=flat-square)](./LICENSE) [![CI](https://github.com/collapsinghierarchy/noisytransfer-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/collapsinghierarchy/noisytransfer-protocol/actions/workflows/ci.yml)

> Experimental monorepo of cryptographic, WebRTC, and WebSocket transport primitives.


---

## Packages

| Package                                                                                                        | Version                                                                                          | What it is                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [`@noisytransfer/crypto`](https://www.npmjs.com/package/@noisytransfer/crypto)                                 | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fcrypto?style=flat-square)                 | Cryptographic primitives (AES-GCM, HPKE, hashes, signatures, stream contexts). |
| [`@noisytransfer/transport`](https://www.npmjs.com/package/@noisytransfer/transport)                           | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Ftransport?style=flat-square)              | WebSocket reconnect wrapper; WebRTC initiator/responder; flush helpers.        |
| [`@noisytransfer/noisystream`](https://www.npmjs.com/package/@noisytransfer/noisystream)                       | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fnoisystream?style=flat-square)            | Stream/file transfer frames (init/chunk/fin) with optional FIN ACK.            |
| [`@noisytransfer/noisyauth`](https://www.npmjs.com/package/@noisytransfer/noisyauth)                           | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fnoisyauth?style=flat-square)              | Auth handshake state machines and SAS confirmation hooks.                      |
| [`@noisytransfer/noisycache`](https://www.npmjs.com/package/@noisytransfer/noisycache)                         | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fnoisycache?style=flat-square)             | Courier (KeyPacket exchange), upload/download & decrypt helpers.               |
| [`@noisytransfer/errors`](https://www.npmjs.com/package/@noisytransfer/errors)                                 | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Ferrors?style=flat-square)                 | `NoisyError`, `CODES`, and utilities.                                          |
| [`@noisytransfer/util`](https://www.npmjs.com/package/@noisytransfer/util)                                     | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Futil?style=flat-square)                   | Small helpers (logger, UUID, base64, async).                                   |
| [`@noisytransfer/constants`](https://www.npmjs.com/package/@noisytransfer/constants)                           | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fconstants?style=flat-square)              | Common constants shared across packages.                                       |
| [`@noisytransfer/noisytransfer-protocol`](https://www.npmjs.com/package/@noisytransfer/noisytransfer-protocol) | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fnoisytransfer-protocol?style=flat-square) | Umbrella export that re-exports all of the above.                              |

> Some packages (e.g. `@noisytransfer/test-helpers`) are primarily for development and CI.

---

## Install

Using npm (examples; install only what you need):

```sh
npm i @noisytransfer/crypto
npm i @noisytransfer/transport
npm i @noisytransfer/noisystream
npm i @noisytransfer/noisyauth
npm i @noisytransfer/noisycache
```

Using pnpm:

```sh
pnpm add @noisytransfer/crypto @noisytransfer/transport @noisytransfer/noisystream @noisytransfer/noisyauth @noisytransfer/noisycache
```

Using yarn:

```sh
yarn add @noisytransfer/crypto @noisytransfer/transport @noisytransfer/noisystream @noisytransfer/noisyauth @noisytransfer/noisycache
```

---

## Quick Start

> APIs are unstable and may change.

If you want a single import, use the umbrella package:

```ts
import { transport, noisyauth, noisystream, noisycache, crypto } from "@noisytransfer/noisytransfer-protocol";
```

Or import individual packages as shown below.

---

## Examples

### 1) WebSocket transport with reconnect (browser)

```ts
import { browserWSWithReconnect } from "@noisytransfer/transport";

const tx = browserWSWithReconnect("wss://example.invalid/nt", {
  maxRetries: 5,
  backoffMs: [50, 100, 250, 500, 1000],
});

tx.onUp(() => console.log("ws up"));
tx.onDown(() => console.log("ws down"));
tx.onMessage((frame) => {
  // Uint8Array | string depending on sender
  console.log("got", frame);
});

tx.send(new Uint8Array([1, 2, 3]));
```

### 2) WebRTC: initiator ↔ responder (minimal signaling shape)

```ts
import { rtcInitiator, rtcResponder } from "@noisytransfer/transport";

// Your signaling must provide { send(any), onMessage(cb) } for both sides.
// For tests you can pipe two EventTargets together, or use your own WS.
const makeSignal = () => {
  const cbs = new Set<(m:any)=>void>();
  return {
    send: (m:any) => cbs.forEach(cb => cb(m)),
    onMessage: (cb:(m:any)=>void) => (cbs.add(cb), () => (cbs.delete(cb), true)),
  };
};

const aliceSignal = makeSignal();
const bobSignal = makeSignal();
// wire them together
aliceSignal.onMessage((m) => bobSignal.send(m));
bobSignal.onMessage((m) => aliceSignal.send(m));

const aliceTx = await rtcInitiator(aliceSignal, { iceServers: [] });
const bobTx   = rtcResponder(bobSignal); // connects once offer flows

bobTx.onUp(() => console.log("RTC up"));
bobTx.onMessage((d) => console.log("bob got", d));

aliceTx.send(new TextEncoder().encode("hello"));
```

### 3) Auth handshake (SAS) over a transport

```ts
import { createAuthSender, createAuthReceiver } from "@noisytransfer/noisyauth";

const sender = createAuthSender(aliceTx, {
  onSAS: (sas) => console.log("compare SAS:", sas),
  waitConfirm: async (sas) => confirm(`Do codes match? ${sas}`),
});

const receiver = createAuthReceiver(bobTx, {
  onSAS: (sas) => console.log("receiver SAS:", sas),
  waitConfirm: async () => true, // auto-accept for demo
});

sender.onState((s) => console.log("sender:", s));
receiver.onState((s) => console.log("receiver:", s));
```

### 4) File/stream transfer frames

```ts
import { sendFileWithAuth, recvFileWithAuth } from "@noisytransfer/noisystream";

const sessionId = crypto.randomUUID?.() ?? "session-001";

// Sender side
await sendFileWithAuth({
  tx: aliceTx,
  sessionId,
  source: new Blob(["hello world"], { type: "text/plain" }),
  onProgress: (sent, total) => console.log(`sent ${sent}/${total}`),
  finAck: true,
});

// Receiver side
const chunks: Uint8Array[] = [];
await recvFileWithAuth({
  tx: bobTx,
  sessionId,
  sink: (u8) => chunks.push(u8),
  finAck: true,
});
console.log("received bytes", chunks.reduce((n, u8) => n + u8.byteLength, 0));
```

### 5) Crypto: AES‑GCM helpers

```ts
import { makeEncryptor, makeDecryptor, deriveIv } from "@noisytransfer/crypto";

const keyBytes = crypto.getRandomValues(new Uint8Array(16)); // 128-bit
const enc = await makeEncryptor(keyBytes); // generates baseIV for you
const ct = await enc.seal("file", 0, new TextEncoder().encode("hello"));

const dec = await makeDecryptor(keyBytes, enc.baseIV);
const pt = await dec.open("file", 0, ct);
console.log(new TextDecoder().decode(pt)); // "hello"

// If you want predictable per-chunk IVs:
const iv0 = deriveIv(enc.baseIV, 0);
const iv1 = deriveIv(enc.baseIV, 1);
```

### 6) NoisyCache: courier + upload/download

```ts
import { mkSendMsgWithVK, runCourierSender, runCourierReceiver, buildKeyPacket, parseKeyPacket, uploadCiphertext, downloadAndDecrypt } from "@noisytransfer/noisycache";
import { genRSAPSS } from "@noisytransfer/crypto";

// 1) Build and send a KeyPacket over a mailbox transport
const { verificationKey, signingKey } = await genRSAPSS();
const sendMsg = mkSendMsgWithVK(verificationKey);

const keyPacket = buildKeyPacket({ id: "file#1", fk: new Uint8Array(16), baseIV: new Uint8Array(12), chunkSize: 64<<10, totalSize: 1234, chunks: 20, hash: "sha256" });
await runCourierSender({ tx: aliceTx, sessionId: "kpex", sendMsg, keyPacket, signingKey });

// 2) Receiver side: obtain and parse the KeyPacket
const parsed = await runCourierReceiver({ tx: bobTx, sessionId: "kpex", recvMsg: sendMsg, recipientPrivateKey: /* HPKE priv */ null });
const kp = parseKeyPacket(parsed);

// 3) Upload/download helpers expect a storage adapter (implement fetch/put/etc)
// See types in noisycache/src/*.d.ts for exact shapes.
```

---

## Monorepo Layout

```
packages/
  crypto/
  transport/
  noisystream/
  noisyauth/
  noisycache/
  // errors/, util/, etc.
```

---

## Development

Clone the repo and install dependencies, then run tests:

```sh
npm install
npm test
```

A local backend is required to run integration tests, e.g. the [NoisyTransfer back-end](https://github.com/collapsinghierarchy/noisytransfer).

### Common Scripts

```sh
# lint, build, and test (adapt to your scripts)
npm run lint
npm run build
npm test
```

If you use workspaces (npm/pnpm/yarn), consider documenting top-level scripts like `npm run -w packages/* build` to build everything at once.

---

## Known Issues

* WebRTC integration tests in `noisyauth` and `noisystream` currently have a connection teardown bug that causes some tests to fail.

If you can reproduce or have a fix, please open an issue/PR with details and logs.


---

## Security

If you discover a security issue or vulnerability, please **do not** open a public issue. Instead, email the maintainers or use your preferred private disclosure channel. We’ll coordinate a fix and release.

---

## License

AGPL-3.0-or-later. See [LICENSE](./LICENSE).
