/**
 * @typedef {{send:(f:any)=>void, onMessage:(cb:(f:any)=>void)=>()=>void, onClose?:(cb:()=>void)=>()=>void, close?:()=>void}} TxLike
 * @typedef {{write:(u8:Uint8Array)=>any, close?:()=>any}} WritableLike
 *
 * @typedef {Object} SendOpts
 * @property {TxLike} tx
 * @property {string} sessionId
 * @property {Uint8Array|ArrayBuffer|Blob|AsyncIterable<Uint8Array|ArrayBuffer>|Iterable<Uint8Array|ArrayBuffer>} source
 * @property {number=} totalBytes
 * @property {number=} chunkBytes
 * @property {Uint8Array|ArrayBuffer|null=} encTag
 * @property {(sent:number,total:number)=>void=} onProgress
 * @property {AbortSignal=} abortSignal
 * @property {boolean=} finAck
 * @property {number=} finAckTimeoutMs
 * @property {number=} finAckMaxRetries
 * @property {number=} finAckBackoffMs
 * @property {boolean=} adaptiveChunking
 *
 * @typedef {Object} RecvOpts
 * @property {TxLike} tx
 * @property {string} sessionId
 * @property {WritableLike | ((u8:Uint8Array)=>any)=} sink
 * @property {number=} expectBytes
 * @property {AbortSignal=} abortSignal
 * @property {(rcvd:number,total:number)=>void=} onProgress
 */
