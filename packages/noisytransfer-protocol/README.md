# NoisyTransfer Protocol

> Experimental monorepo of cryptographic, WebRTC, and transport primitives. **APIs may change.**

## Packages

| Package | Description |
| --- | --- |
| `@noisytransfer/noisytransfer-protocol` | Umbrella entry that re-exports the building blocks. |
| `@noisytransfer/noisyauth` | SAS-based authentication (commit → offer → reveal) with policies for RTC or mailbox flows. |
| `@noisytransfer/noisystream` | Frame-based streaming with AEAD, flow control, and final signatures. |
| `@noisytransfer/crypto` | HPKE + AEAD stream via exporter, SAS, hash/sign/commitment helpers. |
| `@noisytransfer/transport` | Tiny adapters that normalize WebSocket/RTC/etc. into a single `TxLike`. |
| `@noisytransfer/util` | Shared utilities (base64, buffers, async, logger, lpConcat, uuid, etc.). |
| `@noisytransfer/constants` | Shared constants and protocol labels. |
| `@noisytransfer/errors` | Error base class with typed codes. |
| `@noisytransfer/noisycache` | **Deprecated**: use `@noisytransfer/noisystream` + `@noisytransfer/crypto`. |

## Quickstart

Install the umbrella package:

```bash
npm i @noisytransfer/noisytransfer-protocol
```

Use specific modules as needed:

```js
import { noisyauth, noisystream, crypto, transport } from "@noisytransfer/noisytransfer-protocol";

// 1) Auth handshake (SAS shown to both parties)
const rx = noisyauth.createAuthReceiver(tx, {
  onSAS: (code) => console.log("Receiver SAS", code),
  waitConfirm: async (code) => confirm(code),
  onDone: ({ msgS }) => console.log("Auth ready", msgS?.byteLength),
});
const sx = noisyauth.createAuthSender(tx, {
  onSAS: (code) => console.log("Sender SAS", code),
  onDone: ({ msgS }) => console.log("Auth ready", msgS?.byteLength),
});

const rxP = withTimeout(
    asPromise(() => recvFileWithAuth({
      tx: rawB, sessionId, hpke: { ownPriv: privateKey }, sink, sign: { sx.verifyKey }
    })),
    15000, "recvFileWithAuth stalled/failed"
  );

const txP = withTimeout(
    asPromise(() => sendFileWithAuth({
      tx: rawA, sessionId, source: src, hpke: { peerMaterial: rx.recipientPk }, sign: { privateKey: signingKey, publicKeySpki: verificationKey },
    })),
    15000, "sendFileWithAuth stalled/failed"
  );
```

## Development

- Node 18+.
- `npm test` runs unit tests; `npm run test:ci` runs additional RTC tests (requires headless WebRTC).
- Linting: `eslint .` and `prettier -c .`

## License

AGPL-3.0-only