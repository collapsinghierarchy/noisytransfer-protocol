# @noisytransfer/noisycache

Content caching and transfer helpers for NoisyTransfer.

## Exports

- `uploadCiphertext({ storage, source, encryptor, ... })`
- `downloadAndDecrypt({ storage, objectId, manifest, decryptor, ... })`
- `runCourierSender({ tx, sessionId, sendMsg, keyPacket, signingKey })`
- `mkSendMsgWithVK(verificationKeyU8)`
- `runCourierReceiver({ tx, sessionId, recvMsg, recipientPrivateKey })`
- `buildKeyPacket(details)`
- `parseKeyPacket(bytes)`

```js
import { uploadCiphertext, downloadAndDecrypt } from "@noisytransfer/noisycache";
```

APIs are experimental and may change.