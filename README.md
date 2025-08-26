# noisytransfer-protocol
Experimental monorepo implementing the NoisyTransfer protocol in JavaScript.

## Packages

- `@noisytransfer/crypto` – cryptographic primitives (hashing, AEAD, HPKE, SAS).
- `@noisytransfer/errors` – shared `NoisyError` class and error codes.
- `@noisytransfer/noisyauth` – authentication handshake state machines.
- `@noisytransfer/noisystream` – frame-based streaming helpers.
- `@noisytransfer/noisycache` – caching and file transfer utilities.
- `@noisytransfer/transport` – WebSocket/WebRTC transport wrappers.
- `@noisytransfer/util` – internal utility helpers.
- `@noisytransfer/noisytransfer-protocol` – umbrella package re-exporting the above.

Each package lives under `packages/` and is versioned together.

## Development

Install dependencies with your preferred package manager and run tests:

```sh
bun install
npm test
```

For the tests you will need a running backend e.g. [noisytransfer back-end](https://github.com/collapsinghierarchy/noisytransfer).

> APIs are unstable and may change without notice.

## Notice on WebRTC Tests
Some webRTC integration tests inside noisyauth and noisystream have a connection teardown bug, because of which the tests are failing.