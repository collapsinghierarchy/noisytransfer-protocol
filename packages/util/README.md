# @noisytransfer/util

Miscellaneous utilities shared across NoisyTransfer packages.

## Exports

- Base64 helpers: `b64`, `unb64`, `b64url`, `b64u`, `unb64u`
- Buffer helpers: `asU8`, `isByteLike`, `concat`, `boolByte`, `lpConcat`, `toHex`
- Async: `withTimeout`
- Logging: `logger`
- Streaming: `CHUNK_SIZE`, `readChunks`
- Serialization: `u32be`
- UUID generation: `makeUUID`

```js
import { b64u, withTimeout, makeUUID } from "@noisytransfer/util";
```

APIs are internal and may change.
