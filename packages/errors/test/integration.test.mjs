import { test } from "node:test";
import assert from "node:assert/strict";
import { NoisyError, isNoisyError } from "@noisytransfer/errors";

test("NoisyError exposes code", () => {
  const err = new NoisyError({ code: "TEST", message: "x" });
  assert.equal(err.code, "TEST");
  assert.ok(isNoisyError(err));
});
