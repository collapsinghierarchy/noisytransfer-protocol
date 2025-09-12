// test/storage/http_store_integration.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { HttpStore } from "@noisytransfer/noisycache/http_store";
import { NoisyError } from "@noisytransfer/errors/noisy-error";

const BASE = process.env.NOISY_BASE ?? "http://localhost:1234";

function sha256hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function randomBytes(n) {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (Math.random() * 256) | 0;
  return u;
}

test.skip(
  "http_store: create → upload → manifest → 409 → commit → ranges → full → 404",
  { timeout: 60_000 },
  async () => {
    const store = new HttpStore(BASE);

    // Prepare ciphertext blob (~5 MiB)
    const CT = randomBytes(5 * 1024 * 1024);
    const SHA = sha256hex(CT);

    // create
    const { objectId, uploadUrl, manifestUrl } = await store.create();
    assert.ok(objectId && uploadUrl && manifestUrl);

    // upload blob
    const { etag } = await store.putBlob({ uploadUrl, data: CT });
    assert.equal(etag, SHA);

    // upload manifest
    const CHUNK = 1 * 1024 * 1024; // 1 MiB
    const totalBytes = CT.length;
    const totalChunks = Math.ceil(totalBytes / CHUNK);
    const lastPt = totalBytes - (totalChunks - 1) * CHUNK;
    const manifest = {
      version: 1,
      aead: "AES-GCM",
      tagBytes: 16,
      chunkBytes: CHUNK,
      totalBytes,
      totalChunks,
      lastChunkPlaintextBytes: lastPt,
      counterStart: 0,
      encTag: "demo",
      cipherDigest: "",
      finSigAlg: "RSA-PSS-SHA256",
      finSignature: "",
      context: {
        aead: "AES-GCM",
        kdf: "HKDF-SHA256",
        kem: "X25519+Kyber768",
        chunkBytes: CHUNK,
        counterStart: 0,
      },
    };
    await store.putManifest({ manifestUrl, manifest });
    console.log("manifest uploaded");
    // GET before commit → 409
    let got409 = false;
    try {
      await store.get({ objectId });
    } catch (e) {
      assert.ok(e instanceof NoisyError);
      assert.equal(e.code, "NC_NOT_COMMITTED");
      got409 = true;
    }
    assert.ok(got409, "expected NC_NOT_COMMITTED before commit");

    // commit
    const meta = await store.commit({ objectId });
    assert.equal(meta.etag, SHA);
    assert.equal(meta.size, CT.length);
    assert.equal(meta.committed, true);

    // HEAD after commit
    {
      const head = await store.headBlob({ objectId });
      assert.equal(head.status, 204);
      assert.equal(head.etag, SHA);
      assert.equal(head.acceptRanges, "bytes");
    }

    // Range checks (parallel)
    {
      const ranges = [
        [0, 1 * 1024 * 1024 - 1],
        [1 * 1024 * 1024, 2 * 1024 * 1024 - 1],
        [CT.length - 512 * 1024, CT.length - 1],
      ];
      await Promise.all(
        ranges.map(async ([start, end]) => {
          const { bytes, contentRange } = await store.getRange({ objectId, start, end });
          const m = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(contentRange || "");
          assert.ok(m, `invalid Content-Range for ${start}-${end}: ${contentRange}`);
          const gotStart = Number(m[1]),
            gotEnd = Number(m[2]),
            total = Number(m[3]);
          assert.equal(gotStart, start);
          assert.equal(gotEnd, end);
          assert.equal(total, CT.length);
          const expected = CT.subarray(start, end + 1);
          assert.equal(bytes.length, expected.length);
          assert.ok(bytes.equals(expected), `bytes mismatch for ${start}-${end}`);
        })
      );
    }

    // Full download
    const full = await store.get({ objectId });
    assert.equal(full.length, CT.length);
    assert.ok(full.equals(CT));

    // Unknown object → 404
    let notFound = false;
    try {
      await store.get({ objectId: "not-a-real-id" });
    } catch (e) {
      assert.ok(e instanceof NoisyError);
      assert.equal(e.code, "NC_NOT_FOUND");
      notFound = true;
    }
    assert.ok(notFound, "expected NC_NOT_FOUND");
  }
);
