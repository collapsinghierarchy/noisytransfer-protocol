type AuthState =
  | "IDLE"
  | "WAIT_COMMIT"
  | "WAIT_OFFER"
  | "WAIT_REVEAL"
  | "SAS_CONFIRM"
  | "READY"
  | "ERROR"
  | "MALLORY";
type AuthHooks = {
  onState?: ((s: AuthState) => void) | undefined;
  onError?: ((err: any) => void) | undefined;
  onSAS?: ((sas: string) => void) | undefined;
  onSASHash?: ((hex: string) => void) | undefined;
  waitConfirm?: ((sas: string) => Promise<boolean>) | undefined;
  /**
   * =>void=} onDone
   */
  "": {
    msgR?: Uint8Array;
    msgS?: Uint8Array;
  };
};
type SessionOpts = {
  policy?: ("rtc" | "ws_async") | undefined;
  sessionId?: string | undefined;
  roomId?: string | undefined;
  nowMs?: (() => number) | undefined;
};
type AuthSenderOpts = {
  session?: SessionOpts;
} & AuthSenderOnlyOpts;
type AuthReceiverOpts = {
  session?: SessionOpts;
} & AuthReceiverOnlyOpts;
type AuthSenderOnlyOpts = {
  sendMsg?: (Uint8Array | ArrayBuffer) | undefined;
  recvMeta?: (string | Uint8Array | ArrayBuffer) | undefined;
};
type AuthReceiverOnlyOpts = {
  recvMsg: Uint8Array | ArrayBuffer;
  algs?:
    | {
        kem?: string;
        kdf?: string;
      }
    | undefined;
};
