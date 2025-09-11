/** @typedef {import("./types").AuthHooks} AuthHooks */
/** @typedef {import("./types").AuthSenderOpts} AuthSenderOpts */
/** @typedef {import("./types").AuthState} AuthState */
/**
 * @param {import("../transport").TxLike} tx
 * @param {AuthHooks=} hooks
 * @param {AuthSenderOpts=} opts
 * @returns {{ close:()=>void, getState:()=>AuthState, onState:(cb:(s:AuthState)=>void)=>()=>void }}
 */
export function createAuthSender(tx: any, hooks?: AuthHooks | undefined, opts?: AuthSenderOpts | undefined): {
    close: () => void;
    getState: () => AuthState;
    onState: (cb: (s: AuthState) => void) => () => void;
};
export type AuthHooks = any;
export type AuthSenderOpts = any;
export type AuthState = any;
