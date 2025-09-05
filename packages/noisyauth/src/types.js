/**
 * @typedef {"IDLE"|"WAIT_COMMIT"|"WAIT_OFFER"|"WAIT_REVEAL"|"SAS_CONFIRM"|"READY"|"ERROR"|"MALLORY"} AuthState
 */

/**
 * @typedef {Object} AuthHooks
 * @property {(s: AuthState)=>void=} onState
 * @property {(err: any)=>void=} onError
 * @property {(sas: string)=>void=} onSAS
 * @property {(hex: string)=>void=} onSASHash
 * @property {(sas: string)=>Promise<boolean>=} waitConfirm
 * @property {({msgR?:Uint8Array, msgS?:Uint8Array})=>void=} onDone
 */

/**
 * @typedef {Object} SessionOpts
 * @property {"rtc"|"ws_async"=} policy
 * @property {string=} sessionId
 * @property {string=} roomId
 * @property {()=>number=} nowMs
 */

/** @typedef {{ session?: SessionOpts } & AuthSenderOnlyOpts} AuthSenderOpts */
/** @typedef {{ session?: SessionOpts } & AuthReceiverOnlyOpts} AuthReceiverOpts */

/**
 * @typedef {Object} AuthSenderOnlyOpts
 * @property {Uint8Array|ArrayBuffer=} sendMsg
 * @property {string|Uint8Array|ArrayBuffer=} recvMeta
 */

/**
 * @typedef {Object} AuthReceiverOnlyOpts
 * @property {Uint8Array|ArrayBuffer} recvMsg
 * @property {{kem?:string, kdf?:string}=} algs
 */
