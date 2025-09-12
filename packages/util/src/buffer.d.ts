export function asU8(x: any): Uint8Array<ArrayBufferLike>;
/** Normalize to a tight Uint8Array view (no offset/length surprises). */
export function toU8(input: any): Uint8Array<ArrayBufferLike>;
/** Predicate to decide if a value should be treated as binary. */
export function isByteLike(x: any): x is ArrayBuffer | Uint8Array<ArrayBufferLike> | ArrayBufferView<ArrayBufferLike> | Buffer<ArrayBufferLike>;
/** Concatenate values and return a Uint8Array. */
export function concat(...bufs: any[]): any;
/** Boolean flag → 1-byte ArrayBuffer (0 | 1). */
export function boolByte(b: any): ArrayBuffer;
/** length-prefixed concat using your utils; returns Uint8Array for noble */
export function lpConcat(parts: any): Uint8Array<ArrayBufferLike>;
export function toHex(u8: any): string;
