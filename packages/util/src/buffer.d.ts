export function asU8(x: any): Uint8Array<any>;
/** Predicate to decide if a value should be treated as binary. */
export function isByteLike(x: any): any;
/** Concatenate ArrayBuffer/TypedArray values; returns ArrayBuffer to match existing ABI. */
export function concat(...bufs: any[]): any;
/** Boolean flag → 1-byte ArrayBuffer (0 | 1). */
export function boolByte(b: any): ArrayBuffer;
/** length-prefixed concat using your utils; returns Uint8Array for noble */
export function lpConcat(parts: any): Uint8Array<any>;
export function toHex(u8: any): string;
