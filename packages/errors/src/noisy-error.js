/**
 * TODO: Enrich error codes with default messages and have NoisyError use them.
 *
 * Goal:
 *   - Keep a central CODES map, but map each code → human-readable default message.
 *   - NoisyError uses that default when `message` is omitted.
 *
 * Steps:
 * 1) packages/errors/src/codes.js
 *    - Turn CODES into code → default message:
 *      export const CODES = Object.freeze({
 *        NC_PROTOCOL:          'Protocol misuse',
 *        NC_BAD_PARAM:         'Invalid parameter',
 *        NC_RTC_SDP_FAILED:    'WebRTC SDP error',
 *        NC_RTC_ICE_TIMEOUT:   'ICE negotiation timed out',
 *        NC_AEAD_MISMATCH:     'AEAD/tagBytes mismatch',
 *        NC_DECRYPT_FAILED:    'Decryption failed',
 *        NC_DECRYPT_SIZE:      'Plaintext length mismatch',
 *        NC_RANGE_SIZE:        'HTTP range length mismatch',
 *        NC_HASH_MISMATCH:     'Digest mismatch',
 *        NC_SIGNATURE_INVALID: 'Signature verification failed',
 *        NC_INTERNAL_ORDER:    'Out-of-order draining',
 *        // ...add any others used in the repo
 *      });
 *    - Keep KNOWN_CODES / isErrorCode as they are.
 */


export class NoisyError extends Error {
  /**
   * @param {Object} opts
   * @param {NoisyCode|string} opts.code // stable machine code (e.g., "NC_NOT_COMMITTED")
   * @param {string} opts.message    // human message (can change)
   * @param {Record<string, any>=} opts.context
   * @param {any=} opts.cause
   * @param {boolean=} opts.retriable
   */
  constructor({ code, message, context = undefined, cause = undefined, retriable = false }) {
    super(String(message));
    this.name = 'NoisyError';
    this.code = String(code);
    if (context !== undefined) this.context = context;
    if (cause !== undefined)   this.cause = cause;
    this.retriable = !!retriable;
    // carry the underlying stack if present
    if (cause?.stack && !String(this.stack).includes(String(cause.stack))) {
      this.stack += '\nCaused by: ' + cause.stack;
    }
  }
}

/** Type guard */
export function isNoisyError(e) {
  return !!(e && typeof e === 'object' && e.name === 'NoisyError' && typeof e.code === 'string');
}

/** Convenience: wrap an unknown error value as a NoisyError with a known code. */
export function fromUnknown(code, message, context, cause) {
  if (isNoisyError(cause)) return cause;
  return new NoisyError({ code, message, context, cause });
}

/** Stable mapping for HTTP status */
export function httpStatusToCode(status) {
  if (status === 404) return 'NC_NOT_FOUND';
  if (status === 409) return 'NC_NOT_COMMITTED';
  if (status === 405) return 'NC_METHOD_NOT_ALLOWED';
  if (status === 413) return 'NC_PAYLOAD_TOO_LARGE';
  if (status === 416) return 'NC_RANGE_UNSATISFIABLE';
  if (status === 429) return 'NC_TOO_MANY_REQUESTS';
  if (status >= 500) return 'NC_HTTP_5XX';
  return 'NC_HTTP_STATUS';
}
