/**
 * Receiver: run authcore; import sender VK from msgS; verify & open courier frame; return parsed KeyPacket.
 *
 * Stable API: runCourierReceiver({ tx, sessionId, recvMsg, recipientPrivateKey })
 */
export function runCourierReceiver({ tx, sessionId, recvMsg, recipientPrivateKey }: {
    tx: any;
    sessionId: any;
    recvMsg: any;
    recipientPrivateKey: any;
}): Promise<any>;
