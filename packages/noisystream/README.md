# @noisytransfer/noisystream

Frame-based streaming utilities for the NoisyTransfer protocol.

## Exports

- `sendFileWithAuth(opts)`
- `recvFileWithAuth(opts)`
- `STREAM` frame type constants
- Frame helpers: `packStreamInit`, `parseStreamInit`, `packStreamReady`, `parseStreamReady`, `packStreamData`, `parseStreamData`, `packStreamFin`, `parseStreamFin`
- Type guards: `isStreamInit`, `isStreamReady`, `isStreamData`, `isStreamFin`

```js
import { sendFileWithAuth, STREAM } from "@noisytransfer/noisystream";
```

APIs are unstable and may evolve.