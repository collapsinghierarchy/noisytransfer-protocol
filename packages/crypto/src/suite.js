import { CipherSuite, Aes256Gcm, HkdfSha256 } from "@hpke/core";
import { HybridkemX25519Kyber768 } from "@hpke/hybridkem-x25519-kyber768";

export const suite = new CipherSuite({
  kem: new HybridkemX25519Kyber768(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});
