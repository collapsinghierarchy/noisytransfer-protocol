import { NoisyError } from '@noisytransfer/errors/noisy-error';
// Minimal FSM for auth-only (no data-transfer states)
export const STATES = Object.freeze({
  IDLE:        "IDLE",
  WAIT_COMMIT: "WAIT_COMMIT",
  WAIT_OFFER:  "WAIT_OFFER",  // new (receiver)
  WAIT_REVEAL: "WAIT_REVEAL",  // (sender)
  SAS_CONFIRM: "SAS_CONFIRM",
  READY:       "READY",
  ERROR:       "ERROR",
  MALLORY:     "MALLORY",
});

export const PRE_READY = Object.freeze(new Set([
  STATES.IDLE, STATES.WAIT_COMMIT, STATES.WAIT_OFFER, STATES.WAIT_REVEAL, STATES.SAS_CONFIRM
]));
export function isPreReady(s) { return PRE_READY.has(s); }

// Transition tables
const T_SENDER = Object.freeze({
  [STATES.IDLE]:        { room_full: STATES.WAIT_COMMIT },
  [STATES.WAIT_COMMIT]: { commit:    STATES.WAIT_REVEAL },
  [STATES.WAIT_REVEAL]: { reveal:    STATES.SAS_CONFIRM },
  [STATES.SAS_CONFIRM]: { rcvconfirm:STATES.READY, rejected: STATES.MALLORY },
});

const T_RECEIVER = Object.freeze({
  [STATES.IDLE]:        { room_full: STATES.WAIT_COMMIT },
  [STATES.WAIT_COMMIT]: { commit:    STATES.WAIT_OFFER },
  [STATES.WAIT_OFFER]:  { offer:     STATES.SAS_CONFIRM }, // reveal is sent immediately
  [STATES.SAS_CONFIRM]: { rcvconfirm:STATES.READY, rejected: STATES.MALLORY },
});

export function classifyTransportClose(cur) {
  if (cur === STATES.READY)   return { code: "authcore/closed_ready", kind: "clean" };
  if (cur === STATES.ERROR)   return { code: "authcore/closed_error", kind: "error" };
  if (cur === STATES.MALLORY) return { code: "authcore/closed_mal",   kind: "error" };
  return { code: "authcore/closed_incomplete", kind: "error" };
}

export function nextState(role, cur, evt) {
  const T = role === "Sender" ? T_SENDER : T_RECEIVER;

  if ([STATES.ERROR, STATES.MALLORY, STATES.READY].includes(cur)) {
    console.log(`${role}: ${cur} -> ${evt} => ${cur} (terminal/ready)`); return cur;
  }
  if (evt === "error") { console.log(`${role}: ${cur} -> ${evt} => ${STATES.ERROR}`); return STATES.ERROR; }
  if (["bad_sig","vrfyFail","rejected"].includes(evt)) {
    console.log(`${role}: ${cur} -> ${evt} => ${STATES.MALLORY}`); return STATES.MALLORY;
  }
  const next = T[cur]?.[evt];
  console.log(`${role}: ${cur} -> ${evt} => ${next}`);
  if (!next) throw new NoisyError({
    code: 'NC_PROTOCOL',
    message: `authcore/states: ${role} protocol violation: ${cur} → "${evt}" disallowed`,
    context: { role, from: cur, evt }
  });
  return next;
}