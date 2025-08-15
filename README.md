# noisytransfer-protocol
Currently WiP. Our target is this structure eventually:

```
noisytransfer/
├─ package.json                # workspaces + dev scripts
├─ pnpm-workspace.yaml         # or npm/yarn equivalent
├─ packages/
│  ├─ errors/                  # @noisy/errors   (NoisyError, mapping)
│  ├─ util/                    # @noisy/util     (buffer/base64/serial/logger)
│  ├─ crypto-core/             # @noisy/crypto-core (hash, commitment, SAS)
│  ├─ crypto-aead/             # @noisy/crypto-aead (aead.js, deriveIv)
│  ├─ crypto-handshake/        # @noisy/crypto-handshake (HPKE wrappers)
│  ├─ transport-ws/            # @noisy/transport-ws (mailbox surface, ser.js)
│  ├─ transport-rtc/           # @noisy/transport-rtc (initiator/responder/dc)
│  ├─ noisyauth/               # @noisy/noisyauth (sender/receiver FSM)
│  ├─ noisystream/             # @noisy/noisystream (frames + send/recv API)
│  └─ noisycache/              # @noisy/noisycache (sender/receiver + keypacket)
└─ tools/ & scripts/
```