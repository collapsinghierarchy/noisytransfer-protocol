/**
 * @typedef {{
 *   write:(u8:Uint8Array)=>any,
 *   close?:()=>any
 * }} WritableLike
 *
 * @typedef {{
 *   tx: { send:(f:any)=>void, onMessage:(cb:(f:any)=>void)=>()=>void, onClose?:(cb:()=>void)=>()=>void, close?:(...a:any[])=>void },
 *   sessionId: string,
 *   sink?: WritableLike | ((u8:Uint8Array)=>any),
 *   expectBytes?: number,         // optional extra guard against short/long transfers
 *   abortSignal?: AbortSignal,
 *   onProgress?:(rcvd:number,total:number)=>void,
 *   finAck?: boolean
 * }} RecvOpts
 */
/**
 * Stable API: recvFileWithAuth(...)
 * Waits ns_init → replies ns_ready → accepts ns_data (monotonic seq) → expects ns_fin.
 * @param {RecvOpts} opts
 * @returns {Promise<{ ok:true, bytes:number, frames:number, result?:Uint8Array }>}
 */
export function recvFileWithAuth(opts: RecvOpts): Promise<{
  ok: true;
  bytes: number;
  frames: number;
  result?: Uint8Array;
}>;
export type WritableLike = {
  write: (u8: Uint8Array) => any;
  close?: () => any;
};
export type RecvOpts = {
  tx: {
    send: (f: any) => void;
    onMessage: (cb: (f: any) => void) => () => void;
    onClose?: (cb: () => void) => () => void;
    close?: (...a: any[]) => void;
  };
  sessionId: string;
  sink?: WritableLike | ((u8: Uint8Array) => any);
  expectBytes?: number;
  abortSignal?: AbortSignal;
  onProgress?: (rcvd: number, total: number) => void;
  finAck?: boolean;
};
