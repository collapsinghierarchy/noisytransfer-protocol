export function uploadCiphertext({
  storage,
  source,
  encryptor,
  chunkBytes,
  abortSignal,
  onProgress,
  signingKey,
  encTag,
  context,
}: {
  storage: any;
  source: any;
  encryptor: any;
  chunkBytes?: number;
  abortSignal: any;
  onProgress: any;
  signingKey: any;
  encTag?: string;
  context?: {};
}): Promise<{
  objectId: any;
  manifestUrl: any;
  uploadUrl: any;
  manifest: {
    version: number;
    aead: string;
    tagBytes: number;
    chunkBytes: any;
    totalBytes: any;
    totalChunks: number;
    lastChunkPlaintextBytes: number;
    counterStart: number;
    encTag: string;
    cipherDigest: string;
    finSigAlg: string;
    finSignature: string;
    context: {
      chunkBytes: any;
      counterStart: number;
      aead: string;
    };
  };
  etag: any;
  meta: any;
}>;
