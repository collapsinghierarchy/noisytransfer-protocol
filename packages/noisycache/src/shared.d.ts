/**
 * makeCourierFrame
 * @param {{ sessionId: string, enc: Uint8Array|ArrayBuffer, ct: Uint8Array|ArrayBuffer, sig: Uint8Array|ArrayBuffer }} p
 * @returns {{ type: string, sessionId: string, enc: string, ct: string, sig: string, sigAlg: string }}
 */
export function makeCourierFrame({ sessionId, enc, ct, sig }: {
    sessionId: string;
    enc: Uint8Array | ArrayBuffer;
    ct: Uint8Array | ArrayBuffer;
    sig: Uint8Array | ArrayBuffer;
}): {
    type: string;
    sessionId: string;
    enc: string;
    ct: string;
    sig: string;
    sigAlg: string;
};
export const FRAME_TYPE: string;
export function isCourierFrame(o: any): boolean;
