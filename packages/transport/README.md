# @noisytransfer/transport (internal)

> Internal transport utilities for the NoisyTransfer monorepo.  
> **Not intended for standalone installation or external use.** APIs may change without notice.

## What’s here

- WebSocket client with automatic reconnect: `browserWSWithReconnect`
- Durable mailbox transport over WebSocket: `mailboxTransport`
- WebRTC DataChannel helpers: `rtcInitiator`, `rtcResponder`, `dialRtcUntilReady`
- Common `Transport` interface & helper: `isTransport`

All exports are available from the **top-level** module:

```js
import {
  browserWSWithReconnect,
  mailboxTransport,
  rtcInitiator,
  rtcResponder,
  dialRtcUntilReady,
  isTransport,
} from '@noisytransfer/transport';
```

## Environment notes

- Browser: uses native WebSocket and WebRTC.
- Node (tests/dev): provide environment shims:
    - globalThis.WebSocket = require('ws') (or import WebSocket from 'ws')
    - globalThis.RTCPeerConnection, RTCIceCandidate, RTCSessionDescription (e.g. from wrtc)

## Transport Interface
```ts
type Transport = {
  send: (data: any) => void
  close: (code?: number, reason?: string) => void
  onMessage: (cb: (data: any) => void) => () => void
  onClose: (cb: (ev: { code: number, reason?: string }) => void) => () => void
  onUp?: () => void
  onDown?: () => void
  isConnected?: boolean
}
```
Use `isTransport(obj)` to sanity-check implementations.