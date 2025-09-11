/** @typedef {import("./types").AuthHooks} AuthHooks */
/** @typedef {import("./types").AuthReceiverOpts} AuthReceiverOpts */
/** @typedef {import("./types").AuthState} AuthState */
/**
 * @param {import("../transport").TxLike} tx
 * @param {AuthHooks=} hooks
 * @param {AuthSReceiverOpts=} opts
 * @returns {{ close:()=>void, getState:()=>AuthState, onState:(cb:(s:AuthState)=>void)=>()=>void }}
 */
export function createAuthReceiver(tx: any, hooks?: AuthHooks | undefined, opts?: AuthSReceiverOpts | undefined): {
    close: () => void;
    getState: () => AuthState;
    onState: (cb: (s: AuthState) => void) => () => void;
};
export type AuthHooks = any;
export type AuthReceiverOpts = any;
export type AuthState = any;
