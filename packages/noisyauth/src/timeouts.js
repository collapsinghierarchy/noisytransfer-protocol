import { TIMEOUTS } from "@noisytransfer/constants";

const envNum = (name, fallback) => {
  const v = Number(process?.env?.[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

export function timeoutsFor(policy = "ws_async") {
  return TIMEOUTS[policy] || TIMEOUTS.ws_async;
}