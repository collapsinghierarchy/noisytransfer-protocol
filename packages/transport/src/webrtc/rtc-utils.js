export function addEvt(target, type, cb) {
  target.addEventListener(type, cb);
  return () => target.removeEventListener(type, cb);
}

export function shouldAcceptCandidate(cand, { allowTcp = true, allowLoopbackV6 = false } = {}) {
  let s = "";
  if (typeof cand === "string") s = cand;
  else if (cand && typeof cand === "object") s = cand.candidate ?? "";
  if (!s) return false;
  if (!allowLoopbackV6 && s.includes("::1")) return false;
  if (!allowTcp && /\stcp\s/i.test(s)) return false;
  return true;
}