export function makeSenderSigningKeys(): Promise<{
    verificationKey: Uint8Array;
    signingKey: CryptoKey;
}>;
export function makeReceiverKemKeys(): Promise<{
    pk: ArrayBuffer;
    kp: {
        publicKey: CryptoKey;
        privateKey: CryptoKey;
    };
}>;
export function importSenderVkFromMsgS(msgS_spki: any): Promise<CryptoKey>;
