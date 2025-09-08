# NoisyTransfer Protocol

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg?style=flat-square)](./LICENSE) [![CI](https://github.com/collapsinghierarchy/noisytransfer-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/collapsinghierarchy/noisytransfer-protocol/actions/workflows/ci.yml)

> Experimental monorepo of cryptographic, WebRTC, and WebSocket transport primitives.

This README refresh focuses on:

* Correct, working links to each published package on npm.
* A clear overview table with live version badges.
* Quick install snippets.
* Development & contribution instructions.
* Known issues called out explicitly.

---

## Packages

| Package                                                                                  | Version                                                                               | What it is                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [`@noisytransfer/crypto`](https://www.npmjs.com/package/@noisytransfer/crypto)           | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fcrypto?style=flat-square)      | Cryptographic primitives (hashing, AEAD, HPKE, SAS). |
| [`@noisytransfer/transport`](https://www.npmjs.com/package/@noisytransfer/transport)     | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Ftransport?style=flat-square)   | WebSocket/WebRTC transport wrappers.                 |
| [`@noisytransfer/noisystream`](https://www.npmjs.com/package/@noisytransfer/noisystream) | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fnoisystream?style=flat-square) | Frame-based streaming helpers.                       |
| [`@noisytransfer/noisyauth`](https://www.npmjs.com/package/@noisytransfer/noisyauth)     | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fnoisyauth?style=flat-square)   | Authentication handshake state machines.             |
| [`@noisytransfer/noisycache`](https://www.npmjs.com/package/@noisytransfer/noisycache)   | ![npm](https://img.shields.io/npm/v/%40noisytransfer%2Fnoisycache?style=flat-square)  | Caching and file-transfer utilities.                 |

> **Note:** Additional internal packages (e.g. `@noisytransfer/errors`, `@noisytransfer/util`, or an umbrella `@noisytransfer/noisytransfer-protocol`) may live in the monorepo but might not be published to npm. Keep them documented here if/when they’re public.

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

> APIs are experimental and may change without notice.

```ts
// Pseudocode example (interfaces may differ between releases)
import * as ntCrypto from "@noisytransfer/crypto";
import { createTransport } from "@noisytransfer/transport";
import { StreamMuxer } from "@noisytransfer/noisystream";
import { HandshakeMachine } from "@noisytransfer/noisyauth";

async function main() {
  // 1) Set up transport (WebSocket or WebRTC)
  const transport = await createTransport({
    kind: "websocket", // or "webrtc"
    url: "wss://example.invalid/nt",
  });

  // 2) Authenticate (handshake state machine)
  const hs = new HandshakeMachine(/* keys, options */);
  await hs.run(transport);

  // 3) Derive keys / ciphers
  const { aead } = await ntCrypto.aeadFromSecret(/* ... */);

  // 4) Build a multiplexed stream
  const mux = new StreamMuxer({ transport, aead });
  const fileStream = mux.openStream("file");
  await fileStream.write(new Uint8Array([1, 2, 3]));
}

main().catch(console.error);
```

> Replace the pseudocode with real imports/constructors that match your current API. Keeping a minimal runnable example here helps users quickly validate the stack.

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

## Contributing

Contributions are welcome! Please:

1. Open an issue for discussion (feature, bug, or question).
2. Follow the established code style and testing approach.
3. Add tests and documentation for new features.

> You can also add a simple **`CONTRIBUTING.md`** and **`CODE_OF_CONDUCT.md`** and link them here.

---

## Security

If you discover a security issue or vulnerability, please **do not** open a public issue. Instead, email the maintainers or use your preferred private disclosure channel. We’ll coordinate a fix and release.

---

## License

AGPL-3.0-or-later. See [LICENSE](./LICENSE).
