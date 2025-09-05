export function downloadAndDecrypt({
  storage,
  objectId,
  manifest,
  _manifestUrl,
  decryptor,
  parallel,
  sink,
  verifyKey,
  expectCipherDigest,
  abortSignal,
  onProgress,
}: {
  storage: any;
  objectId: any;
  manifest: any;
  _manifestUrl: any;
  decryptor: any;
  parallel?: number;
  sink: any;
  verifyKey: any;
  expectCipherDigest: any;
  abortSignal: any;
  onProgress: any;
}): Promise<{
  bytesWritten: number;
  verified: boolean;
}>;
