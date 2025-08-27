import { TIMEOUTS } from "@noisytransfer/constants";

export function timeoutsFor(policy = "ws_async") {
  return TIMEOUTS[policy] || TIMEOUTS.ws_async;
}