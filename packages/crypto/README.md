# @noisytransfer/crypto

Internal cryptographic primitives for NoisyTransfer.

- **HPKE** (suite exported) + **AEAD stream** via exporter.
- **SAS** derivation over auth frames.
- **Hash / Signature / Commitment** helpers.

## Install

```bash
npm i @noisytransfer/crypto
```

## Highlights

### AEAD stream from HPKE

```js
import {
  mkAeadStreamFromHpke,
  createSenderSession,
  createReceiverSession,
} from "@noisytransfer/crypto";

// Sender
const hpkeSender = await createSenderSession(receiverPubKey);
const streamS = await mkAeadStreamFromHpke("sender", hpkeSender, /* peerMaterial? */ null);

// Receiver
const hpkeReceiver = await createReceiverSession(hpkeSender.encapsulation, receiverPrivKey);
const streamR = await mkAeadStreamFromHpke(
  "receiver",
  hpkeReceiver,
  /* peerMaterial? */ hpkeSender.encapsulation
);

// Use
const ct = await streamS.seal(plaintext, aad);
const pt = await streamR.open(ct, aad);
```

- Keys: AES-256 GCM; IV is 96-bit; per-chunk nonces derived from baseIV + BE counter (low 32 bits).
- Stream id `id` derived from HPKE material (first 8 bytes, base64url) for AAD tagging.

### SAS derivation

```js
import { computeSASFromFrames } from "@noisytransfer/crypto";

const { sas, fullHashHex } = await computeSASFromFrames({
  roomId,
  sessionId,
  commit, // commit frame
  offer, // offer frame
  reveal, // reveal frame
});
// sas: short string (e.g. "123456"); fullHashHex: full transcript digest for logs/OOB.
```

### Other exports

- **AEAD**: `makeEncryptor`, `makeDecryptor`, `deriveIv`
- **Hash**: `createSHA256`, `sha256`, `sha3_256`, `shake128`, `constantTimeEqual`, `toHex`, `fromHex`
- **Signatures**: `genRSAPSS`, `signChunk`, `importVerifyKey`, `verifyChunk`, `createRSAVerifier`
- **Commitment**: `randomNonce`, `computeCommitment`, `verifyCommitment`, `packCommitment`, `parseCommitment`
- **Suite**: `suite` (HPKE cipher suite, e.g. `X25519Kyber25519`, `HKDF-SHA-256`)

## Errors

All helpers throw `NoisyError` with `code` such as `NC_BAD_PARAM`, `NC_UNSUPPORTED_ALG`, and contextual info in `cause/context`.

APIs are unstable and may change without notice.
