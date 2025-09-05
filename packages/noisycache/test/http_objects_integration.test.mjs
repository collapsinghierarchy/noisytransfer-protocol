// test/http/http_objects_integration.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const BASE = process.env.NOISY_BASE ?? "http://localhost:1234";

async function readJSON(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON (${res.status}): ${text}`);
  }
}

function randomBytes(n) {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (Math.random() * 256) | 0;
  return u;
}

test.skip(
  "HTTP objects API: end-to-end (create → upload → manifest → commit → ranges)",
  { timeout: 60_000 },
  async (t) => {
    // 0) Prepare a fake ciphertext blob (~5.5 MiB) to upload
    const SIZE = (5.5 * 1024 * 1024) | 0; // 5.5 MiB
    const CT = randomBytes(SIZE);
    const SHA256 = createHash("sha256").update(CT).digest("hex");

    // 1) Create object
    const resCreate = await fetch(`${BASE}/objects`, { method: "POST" });
    assert.equal(resCreate.status, 200, "POST /objects should be 200");
    const { objectId, uploadUrl, manifestUrl } = await readJSON(resCreate);
    assert.ok(objectId && uploadUrl && manifestUrl, "create response missing fields");

    // 2) Upload blob (PUT)
    const resPut = await fetch(uploadUrl, {
      method: "PUT",
      body: CT, // Buffer is fine; Node 18+ streams it
      headers: { "Content-Type": "application/octet-stream" },
    });
    assert.equal(resPut.status, 204, "PUT blob should be 204 No Content");
    const etag = resPut.headers.get("etag");
    assert.ok(etag, "ETag header missing on PUT");
    assert.equal(etag, SHA256, "ETag must equal sha256(ciphertext)");

    // 3) Upload manifest (PUT)
    const CHUNK_BYTES = 1 * 1024 * 1024; // 1 MiB
    const TAG_BYTES = 16;
    const totalBytes = CT.length; // (for the test; real manifests use plaintext size)
    const totalChunks = Math.ceil(totalBytes / CHUNK_BYTES);
    const lastPt = totalBytes - (totalChunks - 1) * CHUNK_BYTES;

    const manifest = {
      version: 1,
      aead: "AES-GCM",
      tagBytes: TAG_BYTES,
      chunkBytes: CHUNK_BYTES,
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
        chunkBytes: CHUNK_BYTES,
        counterStart: 0,
      },
    };

    const resManifest = await fetch(manifestUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
    });
    assert.equal(resManifest.status, 204, "PUT manifest should be 204");

    // after uploading blob + manifest, but before commit:
    {
      const resHeadPre = await fetch(`${BASE}/objects/${objectId}/blob`, { method: "HEAD" });
      assert.equal(resHeadPre.status, 409, "HEAD before commit must be 409");
      // Optionally verify the problem+json content type header — body is intentionally empty on HEAD.
      const ct = resHeadPre.headers.get("content-type") || "";
      // Depending on proxies/middleware this might not always be present; keep this check lenient or remove if flaky.
      if (ct) {
        if (!/^application\/problem\+json/i.test(ct)) {
          throw new Error(`unexpected content-type for HEAD 409: ${ct}`);
        }
      }
    }

    // 4) GET blob before commit → 409 Problem JSON
    {
      const resPre = await fetch(`${BASE}/objects/${objectId}/blob`);
      assert.equal(resPre.status, 409, "GET before commit must be 409");
      const prob = await readJSON(resPre);
      assert.equal(prob.code, "NC_NOT_COMMITTED", "Problem.code should be NC_NOT_COMMITTED");
    }

    // 5) Commit
    const resCommit = await fetch(`${BASE}/objects/${objectId}/commit`, { method: "POST" });
    assert.equal(resCommit.status, 200, "POST commit should be 200");
    const meta = await readJSON(resCommit);
    assert.equal(meta.committed, true, "meta.committed must be true");
    assert.equal(meta.size, CT.length, "meta.size must equal uploaded size");
    assert.equal(meta.etag, SHA256, "meta.etag must equal sha256");

    // after commit:
    {
      const metaRes = await fetch(`${BASE}/objects/${objectId}/blob`, { method: "HEAD" });
      const sizeGuess = (await metaRes.headers.get("etag")) ? CT.length : CT.length; // fallback
      const tooLargeStart = sizeGuess + 10;
      const res416 = await fetch(`${BASE}/objects/${objectId}/blob`, {
        headers: { Range: `bytes=${tooLargeStart}-${tooLargeStart + 100}` },
      });
      assert.equal(res416.status, 416, "Out-of-range GET should be 416");
    }

    // after commit:
    {
      // [start, end] inclusive ranges
      const ranges = [
        [0, 1 * 1024 * 1024 - 1],
        [1 * 1024 * 1024, 2 * 1024 * 1024 - 1],
        [CT.length - 512 * 1024, CT.length - 1],
      ];

      // Fire all requests concurrently; verify each response individually
      await Promise.all(
        ranges.map(async ([start, end]) => {
          const res = await fetch(`${BASE}/objects/${objectId}/blob`, {
            headers: { Range: `bytes=${start}-${end}`, "Accept-Encoding": "identity" },
          });
          assert.equal(res.status, 206, `Range ${start}-${end} should be 206`);

          // Verify Content-Range is sane and matches request
          const cr = res.headers.get("content-range") || "";
          const m = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(cr);
          assert.ok(m, `invalid Content-Range for ${start}-${end}: ${cr}`);
          const gotStart = Number(m[1]),
            gotEnd = Number(m[2]),
            total = Number(m[3]);
          assert.equal(gotStart, start, `start mismatch for ${start}-${end}`);
          assert.equal(gotEnd, end, `end mismatch for ${start}-${end}`);
          assert.equal(total, CT.length, `total length mismatch for ${start}-${end}`);

          // No compression (we asked for identity) — just sanity check if present:
          const enc = res.headers.get("content-encoding");
          assert.ok(!enc, `unexpected content-encoding=${enc} for ${start}-${end}`);

          const buf = Buffer.from(await res.arrayBuffer());
          const expected = CT.subarray(start, end + 1);
          assert.equal(buf.length, expected.length, `length mismatch for ${start}-${end}`);
          assert.ok(buf.equals(expected), `bytes mismatch for ${start}-${end}`);
        })
      );
    }

    // 6) HEAD blob → 204 with ETag + Accept-Ranges
    const resHead = await fetch(`${BASE}/objects/${objectId}/blob`, { method: "HEAD" });
    assert.equal(resHead.status, 204, "HEAD should be 204");
    assert.equal(resHead.headers.get("etag"), SHA256, "HEAD must return ETag");
    assert.equal(
      resHead.headers.get("accept-ranges"),
      "bytes",
      "HEAD must advertise Accept-Ranges: bytes"
    );

    // 7) Range: first 1 MiB
    const resR1 = await fetch(`${BASE}/objects/${objectId}/blob`, {
      headers: { Range: `bytes=0-${CHUNK_BYTES - 1}` },
    });
    assert.equal(resR1.status, 206, "Range GET should be 206");
    const r1 = Buffer.from(await resR1.arrayBuffer());
    assert.equal(r1.length, CHUNK_BYTES, "first range length mismatch");
    assert.ok(
      resR1.headers.get("content-range")?.startsWith("bytes 0-"),
      "Content-Range missing/invalid for first range"
    );
    assert.equal(Buffer.compare(r1, CT.subarray(0, CHUNK_BYTES)), 0, "first range bytes mismatch");

    // 8) Range: last 1 MiB (suffix)
    const resR2 = await fetch(`${BASE}/objects/${objectId}/blob`, {
      headers: { Range: "bytes=-1048576" },
    });
    assert.equal(resR2.status, 206, "Suffix range GET should be 206");
    const r2 = Buffer.from(await resR2.arrayBuffer());
    assert.equal(r2.length, 1 * 1024 * 1024, "suffix range length mismatch");
    const tail = CT.subarray(CT.length - 1 * 1024 * 1024);
    assert.equal(Buffer.compare(r2, tail), 0, "suffix range bytes mismatch");

    // 9) Full download
    const resFull = await fetch(`${BASE}/objects/${objectId}/blob`);
    assert.equal(resFull.status, 200, "Full GET should be 200");
    const full = Buffer.from(await resFull.arrayBuffer());
    assert.equal(full.length, CT.length, "full size mismatch");
    assert.equal(Buffer.compare(full, CT), 0, "full blob mismatch");

    // 10) Negative: 404 for unknown id
    const res404 = await fetch(`${BASE}/objects/not-a-real-id/blob`);
    assert.equal(res404.status, 404, "unknown object must be 404");
  }
);
