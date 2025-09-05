/**
 * mkSendMsgWithVK(verificationKeyU8)
 * Helper so callers can pre-build the WS mailbox message for sender auth.
 * @param {Uint8Array} verificationKeyU8
 * @returns {Uint8Array}
 */
export function mkSendMsgWithVK(verificationKeyU8: Uint8Array): Uint8Array;
/**
 * Sender: run authcore; receive receiver's HPKE KEM public key; open HPKE;
 * sign and seal the KeyPacket into a courier frame; then send it over WS mailbox.
 *
 * Stable API: runCourierSender({ tx, sessionId, sendMsg, signingKey, keyPacket })
 */
export function runCourierSender({
  tx,
  sessionId,
  sendMsg,
  keyPacket,
  signingKey,
}: {
  tx: any;
  sessionId: any;
  sendMsg: any;
  keyPacket: any;
  signingKey: any;
}): Promise<any>;
