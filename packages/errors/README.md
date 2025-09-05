# @noisytransfer/errors

Shared error utilities used across NoisyTransfer packages.

## Exports

- `NoisyError` – structured error base class
- `isNoisyError(e)` – type guard
- `fromUnknown(code, message, context?, cause?)`
- `httpStatusToCode(status)` – map HTTP status codes
- `CODES` – common error code mapping

```js
import { NoisyError, isNoisyError, CODES } from "@noisytransfer/errors";
```

APIs are internal and may change without notice.
