import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, constantTimeEqual } from "@noisytransfer/crypto";

test("sha256 produces 32 bytes", async () => {
  const dig = await sha256(new Uint8Array([1, 2, 3]));
  assert.equal(dig.length, 32);
  assert.ok(constantTimeEqual(dig, dig));
});
