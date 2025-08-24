import { suite } from "@noisytransfer/crypto/suite.js";
import { genRSAPSS } from "@noisytransfer/crypto/signature.js";

export async function makeSenderSigningKeys() {
  return genRSAPSS(); // { verificationKey: Uint8Array, signingKey: CryptoKey }
}

export async function makeReceiverKemKeys() {
  const { publicKey, privateKey } = await suite.kem.generateKeyPair();
  const pk = await suite.kem.serializePublicKey(publicKey);
  return { pk, kp: { publicKey, privateKey } };
}

export async function importSenderVkFromMsgS(msgS_spki) {
  const u8 = typeof msgS_spki === "string"
    ? Uint8Array.from(Buffer.from(msgS_spki.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((msgS_spki.length+3)%4), "base64"))
    : new Uint8Array(msgS_spki);
  return crypto.subtle.importKey("spki", u8, { name: "RSA-PSS", hash: "SHA-256" }, true, ["verify"]);
}
