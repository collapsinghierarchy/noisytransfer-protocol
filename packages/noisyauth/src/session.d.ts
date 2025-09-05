/**
 * @typedef {Object} SessionCtx
 * @property {string} roomId
 * @property {string} sessionId
 * @property {"rtc"|"ws_async"} policy
 * @property {() => number} [nowMs]
 */
export function makeSessionCtx(
  tx: any,
  opts?: {}
): {
  roomId: any;
  sessionId: any;
  policy: any;
  nowMs: any;
};
/** @param {any} ctx */
export function assertSessionCtx(ctx: any): void;
/** @param {SessionCtx} ctx */
export function freezeSessionCtx(ctx: SessionCtx): Readonly<SessionCtx>;
export type SessionCtx = {
  roomId: string;
  sessionId: string;
  policy: "rtc" | "ws_async";
  nowMs?: () => number;
};
