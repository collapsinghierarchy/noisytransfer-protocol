# @noisytransfer/crypto

Internal cryptographic primitives for the NoisyTransfer project.

## Exports

- `deriveIv`, `makeEncryptor`, `makeDecryptor` – AES-GCM helpers
- `computeSASFromFrames` – Short Authentication String derivation
- `mkAeadStreamFromHpke` – derive an AEAD stream from HPKE
- Hash helpers: `createSHA256`, `sha256`, `sha3_256`, `shake128`, `constantTimeEqual`, `toHex`, `fromHex`, `Readable`
- Signature helpers: `genRSAPSS`, `signChunk`, `importVerifyKey`, `verifyChunk`, `createRSAVerifier`
- `suite` – HPKE cipher suite
- Commitment utilities: `randomNonce`, `computeCommitment`, `verifyCommitment`, `packCommitment`, `parseCommitment`

```js
import { sha256, genRSAPSS, suite } from "@noisytransfer/crypto";
```

APIs are unstable and may change without notice.