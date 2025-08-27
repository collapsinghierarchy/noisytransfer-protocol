// Canonical NoisyTransfer error codes (documentation + discoverability).
// Note: NoisyError accepts any string; this list is our stable vocabulary.
export const CODES = Object.freeze({
  // Parameters & protocol
  NC_BAD_PARAM: 'NC_BAD_PARAM',
  NC_PROTOCOL: 'NC_PROTOCOL',

  // Crypto
  NC_SIGNATURE_INVALID: 'NC_SIGNATURE_INVALID',
  NC_UNSUPPORTED_ALG: 'NC_UNSUPPORTED_ALG',

  // Frames / parsing
  NC_FRAME_INVALID: 'NC_FRAME_INVALID',

  // Transports / send/close/abort
  NC_TX_SEND: 'NC_TX_SEND',
  NC_TX_CLOSED: 'NC_TX_CLOSED',
  NC_ABORTED: 'NC_ABORTED',

  // WebRTC specifics
  NC_RTC_SDP_FAILED: 'NC_RTC_SDP_FAILED',
  NC_RTC_ICE_TIMEOUT: 'NC_RTC_ICE_TIMEOUT',

  // Object store / HTTP mapping
  NC_NOT_FOUND: 'NC_NOT_FOUND',
  NC_NOT_COMMITTED: 'NC_NOT_COMMITTED',
  NC_METHOD_NOT_ALLOWED: 'NC_METHOD_NOT_ALLOWED',
  NC_PAYLOAD_TOO_LARGE: 'NC_PAYLOAD_TOO_LARGE',
  NC_RANGE_UNSATISFIABLE: 'NC_RANGE_UNSATISFIABLE',
  NC_TOO_MANY_REQUESTS: 'NC_TOO_MANY_REQUESTS',
  NC_HTTP_5XX: 'NC_HTTP_5XX',
  NC_HTTP_STATUS: 'NC_HTTP_STATUS',

  // Storage / I/O outside HTTP status mapping (optional bucket)
  NC_STORE_IO: 'NC_STORE_IO',
});

export const KNOWN_CODES = new Set(Object.keys(CODES));
export function isErrorCode(x) {
  return KNOWN_CODES.has(x);
}