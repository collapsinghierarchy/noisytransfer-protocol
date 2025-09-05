export function waitForDrain(dc: any): Promise<any>;
/** Wraps a DataChannel with our transport surface (send/onMessage/onUp/onDown/onClose/close + features). */
export function wrapDataChannel(
  dc: any,
  pc: any,
  side?: string
): {
  features: {
    durableOrdered: boolean;
    ordered: boolean;
    reliable: boolean;
    peerFingerprints: () => {
      alg: string;
      bytes: Uint8Array<ArrayBuffer>;
    }[];
  };
  readonly isUp: boolean;
  readonly bufferedAmount: any;
  flush(): Promise<void>;
  getLocalFingerprint: () => {
    alg: string;
    bytes: Uint8Array<ArrayBuffer>;
  };
  getRemoteFingerprint: () => {
    alg: string;
    bytes: Uint8Array<ArrayBuffer>;
  };
  send: (data: any) => void;
  onMessage: (cb: any) => () => void;
  onUp: (cb: any) => () => boolean;
  onDown: (cb: any) => () => boolean;
  onClose: (cb: any) => () => boolean;
  close: (code?: number, reason?: string) => Promise<void>;
};
