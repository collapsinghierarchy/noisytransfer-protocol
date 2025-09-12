// types.js
// Centralized JSDoc typedefs for noisystream. No runtime exports required.

/**
 * A minimal transport used by noisystream (e.g., an ordered RTCDataChannel wrapper).
 * onMessage returns an unsubscribe function.
 * @typedef {{ send:(f:any)=>void, onMessage:(cb:(f:any)=>void)=>()=>void, onClose?:(cb:()=>void)=>()=>void, close?:()=>void }} TxLike
 */

/**
 * Writable sink abstraction for the receiver.
 * @typedef {{ write:(u8:Uint8Array)=>any, close?:()=>any }} WritableLike
 */

/** @typedef {Uint8Array|ArrayBuffer} ByteLike */
/** @typedef {ByteLike|Blob|Iterable<ByteLike>|AsyncIterable<ByteLike>} ByteSource */

/**
 * Options for the sender.
 * @typedef {Object} SendOpts
 * @property {TxLike} tx
 * @property {string} sessionId
 * @property {ByteSource} source
 * @property {number=} totalBytes               - required if length not derivable
 * @property {number=} chunkBytes               - default 65536
 * @property {ByteLike|null=} encTag            - echoed in INIT for app use
 * @property {{ peerMaterial: ByteLike }} hpke  - recipient public key bytes
 * @property {{ alg?:string, privateKey?:CryptoKey, publicKeySpki?:Uint8Array }=} sign
 * @property {(sent:number,total:number)=>void=} onProgress
 * @property {AbortSignal=} abortSignal
 * @property {number=} finAckTimeoutMs          - default 5000
 * @property {number=} finAckMaxRetries         - default 3
 * @property {number=} finAckBackoffMs          - default 100
 * @property {boolean=} adaptiveChunking        - default false
 * @property {number=} maxBufferedBytes
 */

/**
 * Options for the receiver.
 * @typedef {Object} RecvOpts
 * @property {TxLike} tx
 * @property {string} sessionId
 * @property {WritableLike | ((u8:Uint8Array)=>any)=} sink
 * @property {(rcvd:number,total?:number)=>void=} onProgress
 * @property {AbortSignal=} abortSignal
 * @property {number=} backlogChunks
 * @property {number=} backlogBytes
 * @property {number=} windowChunks
 * @property {number=} credit
 * @property {{ ownPriv: CryptoKey }} hpke
 */

// Make this a module (helps some tooling)
export {};
