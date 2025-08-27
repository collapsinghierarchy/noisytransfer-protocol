/**
 * noisyauth: Short Authentication String (SAS) based authentication (3-way non-blocking SAS log/reveal).
 */
import { computeSASFromFrames } from "@noisytransfer/crypto";
import { verifyCommitment } from "@noisytransfer/crypto";
import { NoisyError } from "@noisytransfer/errors/noisy-error";
import { unb64 } from "@noisytransfer/util";

import { attachTransportLifecycle } from "./connectivity.js";
import { makeScope } from "./lifecycle.js";
import { makeOffer, makeReveal, makeRcvConfirm, isFrame } from "./messages.js";
import { makePhaseTimer } from "./phase_timer.js";
import { SenderFsm } from "./sender_fsm.js";
import { makeSessionCtx } from "./session.js";
import { STATES } from "./states.js";
import { timeoutsFor } from "./timeouts.js";

export function createAuthSender(tx, hooks = {}, opts = {}) {
  const scope   = makeScope();
  const session = makeSessionCtx(tx, opts.session || opts);
  const T       = timeoutsFor(session.policy);

  const RC = tx;
  // Transports are durable/ordered; no per-message ACKs needed.
  const waitAckAtLeast    = async () => {};
  const minRecoverableRid = () => 0;

  // --- FSM + timers ---------------------------------------------------------
  const stateSubs = new Set();
  const emitState = (t) => {
    try { hooks.onState?.(t); } catch {}
    for (const cb of stateSubs) { try { cb(t); } catch {} }
  };
  const fsm = new SenderFsm(frame => RC.send(frame), { onTransition: emitState });

  let nudged = false, lastSent = null, finished = false;
  let waitingPeerConfirm = false;
  let sas = null;
   const timer = makePhaseTimer({
     T,
     resend: () => { if (!finished && lastSent) try { RC.send(lastSent); } catch {} },
     onTimeout: (code) => fail(code),
   });
   scope.addUnsub(() => timer.clear());

  function fail(code, more) {
    timer.clear();
    const err = Object.assign(new Error(code), { code, more });
    fsm.error();
    hooks.onError?.(err);
    scope.teardown(err);
  }

  let started = false;
  const startSenderPreReady = () => {
    if (started) return;
    started = true;
    if (fsm.state === STATES.IDLE) {
      fsm.roomFull(); // IDLE -> WAIT_COMMIT
      timer.arm(STATES.WAIT_COMMIT, "timeout_wait_commit");
    }
  };
  
  attachTransportLifecycle({
    tx, scope, hooks, fsm, policy: session.policy,
    startNow:    session.policy === "ws_async" ? startSenderPreReady : null,
    startWhenUp: session.policy === "rtc"      ? startSenderPreReady : null,
  });

  // --- options / ids --------------------------------------------------------
  const sendMeta    = opts.sendMeta ?? opts.id?.send ?? null;  // optional metadata
  const expectRecv  = opts.recvMeta ?? opts.id?.recv ?? null;  // optional metadata
  const algs        = opts.algs ?? { kem: "X25519Kyber25519", kdf: "HKDF-SHA-256" };
  // commitment verification parameters (must match receiver’s computeCommitment)
  const COMMIT_HASH  = "SHA3-256";
  const COMMIT_LABEL = "noisyauth";

  // protocol input: msg_S
  const sendMsg = opts.sendMsg ?? crypto.getRandomValues(new Uint8Array(32)).buffer;

  // --- state vars -----------------------------------------------------------
  let seenCommit = null;        // last commit frame (idempotency)
  let myOffer    = null;
  let myConfirm  = null;
  let finishedSAS = false;
  let msgR = null; // msg_R (from reveal frame, used for SAS)

  // for commitment verify
  let pendingCommitU8 = null;  // Uint8Array (decoded commitment)

  // --- inbound serialization ------------------------------------------------
  let q = Promise.resolve();
  const unMsg = tx.onMessage((m) => {
    q = q.then(() => handle(m)).catch(e => fail("sender_handle_error", e));
  });
  if (unMsg) scope.addUnsub(unMsg);

  async function handle(m) {
    if (!m || m.sessionId !== session.sessionId) return;

    if (isFrame(m, "commit", session.sessionId)) {
    if (!seenCommit && fsm.state !== STATES.WAIT_COMMIT) {
      return fail("sender:unexpected_commit");
    }
    if (seenCommit) {
      // Already bound: a different commitment is a hard violation.
      if (seenCommit.commit?.commitment !== m.commit?.commitment) {
        return fail("sender:commit_mismatch");
      }
      // Exact duplicate -> harmless; ignore.
      return;
    }
      timer.clear();
      seenCommit = m;
      fsm.commit(); // WAIT_COMMIT -> WAIT_REVEAL (we'll wait for reveal next)

      // optional peer id check (if metadata present)
      if (expectRecv && JSON.stringify(m.commit?.recv ?? m.commit?.recv?.id) !== JSON.stringify(expectRecv?.id ?? expectRecv)) {
        return fail("sender:peer_id_mismatch");
      }

      // store the commitment digest
      const c = m?.commit?.commitment;
      pendingCommitU8 = c ? unb64(c) : null;  // keep as Uint8Array

      // Send our offer immediately: msg_S || nonce_S
      const nonceS = crypto.getRandomValues(new Uint8Array(16)).buffer;
      myOffer = makeOffer({ session, msgS: sendMsg, nonceS });
      lastSent = myOffer;
      RC.send(myOffer);
      timer.arm(STATES.WAIT_REVEAL, "timeout_wait_reveal");
      return;
    }

    if (isFrame(m, "reveal", session.sessionId)) {
      timer.clear();

      const msgR_b64   = m.reveal?.msgR;
      msgR = msgR_b64;  // keep original (string) for hooks/onDone
      const nonceR_b64 = m.reveal?.nonceR;
      if (!msgR_b64 || !nonceR_b64) return fail("sender:bad_reveal");
      const msgR_u8   = unb64(msgR_b64);     // Uint8Array
      const nonceR_u8 = unb64(nonceR_b64);   // Uint8Array
      // verify commitment using centralized API
      const ok = pendingCommitU8 && await verifyCommitment({
        data:        msgR_u8,
        nonce:       nonceR_u8,
        commitment:  pendingCommitU8,
        hash:        COMMIT_HASH,
        label:       COMMIT_LABEL,
      });
      if (!ok) {
        fsm.vrfyFail();             // -> MALLORY
        return fail("sender:commitment_mismatch");
      }

      fsm.reveal(); // WAIT_REVEAL -> SAS_CONFIRM
      const { sas, fullHashHex } = await computeSASFromFrames({
           roomId: session.roomId,
           sessionId: session.sessionId,
           commit: seenCommit,
           offer:  myOffer,
           reveal: m,
       });
      console.log("sender: computed SAS", sas);
      hooks.onSAS?.(sas);
      hooks.onSASHash?.(fullHashHex);

      timer.arm(STATES.SAS_CONFIRM, "timeout_wait_sas");
      const ok2 = await Promise.resolve(hooks.waitConfirm?.(sas));
      if (!ok2) {
        fsm.rejected();             // -> MALLORY
        RC.close?.(); 
        return fail("sender:sas_rejected");
      }

      // Send our confirm, but DO NOT enter READY yet — wait for peer confirm (RTC)
      const rcv = makeRcvConfirm({ session });
      myConfirm = rcv;
      lastSent = rcv;
      RC.send(rcv);
      waitingPeerConfirm = (session.policy === "rtc");
      if (!waitingPeerConfirm) {
        await waitAckAtLeast(minRecoverableRid());
        timer.clear();
        finished = true;
        fsm.rcvconfirm(); // -> READY
        hooks.onDone?.({msgR});
        return;
    }
    // RTC: wait for peer rcvconfirm or close/timeout
    timer.arm(STATES.SAS_CONFIRM, "timeout_wait_peer_confirm");
    return;
    }

    if (isFrame(m, "rcvconfirm", session.sessionId)) {
      // Unauthenticated: do not change state. Notify UI only.
      hooks.onPeerConfirm?.(m);
      if (waitingPeerConfirm && !finished) {
        timer.clear();
        waitingPeerConfirm = false;
        finished = true;
        hooks.onDone?.({msgR});
        fsm.rcvconfirm(); // SAS_CONFIRM -> READY
      }
    }
  }

  return {
    close: () => scope.teardown(),
    getState: () => fsm.state,
    onState: (cb) => { stateSubs.add(cb); return () => stateSubs.delete(cb); },
  };
}