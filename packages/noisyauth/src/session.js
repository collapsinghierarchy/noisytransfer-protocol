import { NoisyError } from "@noisytransfer/errors/noisy-error";
/**
 * @typedef {Object} SessionCtx
 * @property {string} roomId
 * @property {string} sessionId
 * @property {"rtc"|"ws_async"} policy
 * @property {() => number} [nowMs]
 */

export function makeSessionCtx(tx, opts = {}) {
  const policy = opts.policy ?? "ws_async";
  const sessionId = opts.sessionId ?? crypto.randomUUID?.() ?? String(Date.now());
  const roomId = opts.roomId ?? tx?.room ?? "unknown-room";

  return {
    roomId,
    sessionId,
    policy,
    nowMs: opts.nowMs ?? (() => Date.now()),
  };
}

/** @param {any} ctx */
export function assertSessionCtx(ctx) {
  if (!ctx || typeof ctx !== "object")
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "authcore/session: SessionCtx missing" });
  for (const k of ["roomId", "sessionId", "policy"]) {
    if (!ctx[k])
      throw new NoisyError({ code: "NC_BAD_PARAM", message: `authcore/session: ${k} missing` });
  }
}

/** @param {SessionCtx} ctx */
export function freezeSessionCtx(ctx) {
  return Object.freeze(ctx);
}
