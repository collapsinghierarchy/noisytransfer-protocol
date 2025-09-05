/**
 * Sender: given the receiver’s public key, perform HPKE sender handshake.
 * Returns:
 *   {
 *     seal(pt[, aad]) : Promise<Uint8Array>,
 *     hpkeSeal(pt[, aad]) : Promise<Uint8Array>,   // alias (clearer name)
 *     exportSecret?(info:Uint8Array, len:number) : Promise<Uint8Array>, // if HPKE impl supports exporter
 *     enc : ArrayBuffer
 *   }
 */
export function createSenderSession(receiverPublicKey: any): Promise<{
  seal: (pt: any, aad: any) => Promise<ArrayBuffer>;
  hpkeSeal: (pt: any, aad: any) => Promise<ArrayBuffer>;
  exportSecret: (info: any, len: any) => Promise<Uint8Array<ArrayBuffer>>;
  enc: ArrayBuffer;
}>;
/**
 * Receiver: given the HPKE encapsulation and the recipient's private key, complete HPKE.
 * Returns:
 *   {
 *     open(ct[, aad]) : Promise<Uint8Array>,
 *     hpkeOpen(ct[, aad]) : Promise<Uint8Array> // alias (clearer name)
 *   }
 */
export function createReceiverSession(
  encapsulation: any,
  recipientPrivateKey: any
): Promise<{
  open: (ct: any, aad: any) => Promise<ArrayBuffer>;
  hpkeOpen: (ct: any, aad: any) => Promise<ArrayBuffer>;
}>;
