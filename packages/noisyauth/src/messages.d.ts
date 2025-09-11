export function isFrame(m: any, type: any, sessionId: any): boolean;
/** commit: carries only commitment digest (no key material) */
export function makeCommit({ session, commitment, algs, recvMeta }: {
    session: any;
    commitment: any;
    algs: any;
    recvMeta: any;
}): {
    type: string;
    sessionId: any;
    commit: {
        roomId: any;
        algs: any;
        commitment: string;
        recv: {
            id: any;
            vk: any;
        };
    };
};
/** offer: sender -> receiver (msg_S || nonce_S) */
export function makeOffer({ session, msgS, nonceS }: {
    session: any;
    msgS: any;
    nonceS: any;
}): {
    type: string;
    sessionId: any;
    offer: {
        msgS: string;
        nonceS: string;
    };
};
/** reveal: receiver -> sender (msg_R || nonce_R) */
export function makeReveal({ session, msgR, nonceR }: {
    session: any;
    msgR: any;
    nonceR: any;
}): {
    type: string;
    sessionId: any;
    reveal: {
        msgR: string;
        nonceR: string;
    };
};
/** optional ack */
export function makeRcvConfirm({ session }: {
    session: any;
}): {
    type: string;
    sessionId: any;
};
export function normalizeId(id: any): {
    kind: any;
    data: string | Uint8Array<ArrayBufferLike>;
};
export function toBytes(x: any): Uint8Array<ArrayBufferLike>;
export function toString(x: any): string;
