/**
 * @typedef {{
 *   tx: { send:(f:any)=>void, onMessage:(cb:(f:any)=>void)=>()=>void, onClose?:(cb:()=>void)=>()=>void, close?:(...a:any[])=>void },
 *   sessionId: string,
 *   source: Uint8Array|ArrayBuffer|Blob|AsyncIterable<Uint8Array|ArrayBuffer>|Iterable<Uint8Array|ArrayBuffer>,
 *   totalBytes?: number,               // required if source length cannot be derived
 *   chunkBytes?: number,               // default 64 KiB
 *   encTag?: Uint8Array|ArrayBuffer|null, // optional, echoed in ns_init
 *   onProgress?:(sent:number,total:number)=>void,
 *   abortSignal?: AbortSignal,
 *   // optional behaviors (default: off)
 *   finAck?: boolean,
 *   finAckTimeoutMs?: number,
 *   finAckMaxRetries?: number,
 *   finAckBackoffMs?: number,
 *   adaptiveChunking?: boolean,
 * }} SendOpts
 */
/**
 * Stable API: sendFileWithAuth(...)
 * Sends ns_init → waits ns_ready → streams ns_data(seq++) → sends ns_fin(ok).
 * @param {SendOpts} opts
 */
export function sendFileWithAuth(opts: SendOpts): Promise<{
  ok: boolean;
  bytesSent: number;
  frames: number;
}>;
/**
 * ?: boolean,
 *   finAckTimeoutMs?: number,
 *   finAckMaxRetries?: number,
 *   finAckBackoffMs?: number,
 *   adaptiveChunking?: boolean,
 * }} SendOpts
 */
export type finAck = {
  tx: {
    send: (f: any) => void;
    onMessage: (cb: (f: any) => void) => () => void;
    onClose?: (cb: () => void) => () => void;
    close?: (...a: any[]) => void;
  };
  sessionId: string;
  source:
    | Uint8Array
    | ArrayBuffer
    | Blob
    | AsyncIterable<Uint8Array | ArrayBuffer>
    | Iterable<Uint8Array | ArrayBuffer>;
  totalBytes?: number;
  chunkBytes?: number;
  encTag?: Uint8Array | ArrayBuffer | null;
  onProgress?: (sent: number, total: number) => void;
  abortSignal?: AbortSignal;
};
