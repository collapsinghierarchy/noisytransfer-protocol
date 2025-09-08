# @noisytransfer/test-helpers

Test harnesses and transports used in NoisyTransfer tests.

```js
import { mkMailbox, withSignalPair } from "@noisytransfer/test-helpers";

// mailbox-based TxLike pair for tests
const { A, B } = await mkMailbox("https://mailbox.example.com", {
  room: "room-123", side: "A", sessionId: crypto.randomUUID()
});

// WebRTC signal harness (initiator/responder)
await withSignalPair(async ({ A, B }) => {
  // use A/B as TxLike
});
