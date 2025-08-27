import { computeCommitment } from "@noisytransfer/crypto";
import { computeSASFromFrames } from "@noisytransfer/crypto";
import { NoisyError } from '@noisytransfer/errors/noisy-error';
import { unb64 } from "@noisytransfer/util/base64";

import { attachTransportLifecycle } from "./connectivity.js";
import { makeScope } from "./lifecycle.js";
import { makeCommit, makeReveal, makeRcvConfirm, isFrame } from "./messages.js";
import { makePhaseTimer } from "./phase_timer.js";
import { ReceiverFsm } from "./receiver_fsm.js";
import { makeSessionCtx } from "./session.js";
import { STATES } from "./states.js";
import { timeoutsFor } from "./timeouts.js";




export function createAuthReceiver(tx, hooks = {}, opts = {}) {
  const scope   = makeScope();
  const session = makeSessionCtx(tx, opts.session || opts);
  const T       = timeoutsFor(session.policy);

  const RC = tx;
  const waitAckAtLeast    = async () => {};
  const minRecoverableRid = () => 0;

  let lastSent = null;
  const stateSubs = new Set();
  const emitState = (t) => {
    try { hooks.onState?.(t); } catch {}
    for (const cb of stateSubs) { try { cb(t); } catch {} }
  };
  const fsm = new ReceiverFsm(frame => RC.send(frame), { onTransition: emitState });
  const timer = makePhaseTimer({
    T,
    resend: () => { if (lastSent) try { RC.send(lastSent); } catch {} },
    onTimeout: (code) => fail(code),
  });
  scope.addUnsub(() => timer.clear());

  function fail(code, more) {
    timer.clear();
    const err = Object.assign(new Error(code), { code, more });
    hooks.onError?.(err);
    scope.teardown(err);
  }

  // required input per new protocol
  const recvMsg = opts.recvMsg; // ArrayBuffer | Uint8Array (msg_R)
  if (!recvMsg) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'authcore/receiver: recvMsg is required' });

  const algs = opts.algs ?? { kem: "X25519Kyber25519", kdf: "HKDF-SHA-256" };
  // Keep sender/receiver in sync with the same commitment parameters
  const COMMIT_HASH  = "SHA3-256";
  const COMMIT_LABEL = "noisyauth";

  // idempotency caches
  let sentCommit = null;     // commit frame we send (resend on retry)
  let sentConfirm = null;    // rcvconfirm frame we send (resend on retry)
  let seenOffer = null;      // last offer frame seen

  // stash for reveal
  let nonceR = null;
  let waitingPeerConfirm = false;
  let msgS = null; // msg_S (from offer frame, used for SAS)

  // async-start: proactively send commit
  async function ensureCommitSent() {
    if (!sentCommit) {
      const bytesR = recvMsg instanceof Uint8Array ? recvMsg : new Uint8Array(recvMsg);
      // Generate commitment; keep nonce private until REVEAL
      const { commitment, nonce } = await computeCommitment(bytesR, {
        hash: COMMIT_HASH,
        label: COMMIT_LABEL,
        // Optional: match your previous 16-byte nonce size; default is 32
        nonceBytes: 16,
      });
      nonceR = nonce;
      sentCommit = makeCommit({
        session,
        commitment,
        algs,
        recvMeta: opts.recvMeta, // optional metadata only
      });
    }
    try {
      lastSent = sentCommit;
      RC.send(sentCommit);
      if (fsm.state === STATES.IDLE) fsm.roomFull();
      if (fsm.state === STATES.WAIT_COMMIT) fsm.commit(); // -> WAIT_OFFER
    } catch {
      if (!scope.signal?.aborted) setTimeout(ensureCommitSent, 300);
    }
  }

  let ASYNC = false;
  if (session.policy === "rtc") {
    // Arm WAIT_COMMIT timer immediately if not already armed
    ASYNC = true;
    timer.arm(STATES.WAIT_COMMIT, "timeout_wait_commit");
  }
  
  // Kick-off depending on policy (RTC: when up; mailbox: immediately)
  attachTransportLifecycle({
    tx, scope, hooks, fsm,
    policy: session.policy,
    startNow:     session.policy === "ws_async" ? ensureCommitSent : null,
    startWhenUp:  session.policy === "rtc"      ? ensureCommitSent : null,
  });

  // inbound serialization
  let q = Promise.resolve();
  const unMsg = tx.onMessage((m) => {
    q = q.then(() => handle(m)).catch(e => fail("receiver_handle_error", e));
  });
  if (unMsg) scope.addUnsub(unMsg);

  async function handle(m) {
    if (!m || m.sessionId !== session.sessionId) return;

    if (m.type === "room_full") {
      // For non-async RTC we don't use room_full.
      if (!ASYNC) ensureCommitSent();
      return;
    }

    if (isFrame(m, "offer", session.sessionId)) {
      // idempotency / mismatch check
      if (seenOffer) {
        if (JSON.stringify(seenOffer.offer) !== JSON.stringify(m.offer)) {
          return fail("receiver:offer_conflict");
        }
        return; // duplicate exact
      }
      timer.clear();
      seenOffer = m;
      fsm.offer();
      // Immediately reveal msg_R || nonce_R
      const reveal = makeReveal({ session, msgR: recvMsg, nonceR });
      msgS = unb64(m.offer.msgS); // Uint8Array
      lastSent = reveal;
      RC.send(reveal);

      const { sas, fullHashHex } = await computeSASFromFrames({
           roomId: session.roomId,
           sessionId: session.sessionId,
           commit: sentCommit,
           offer:  m,
           reveal, // our reveal
       });
      console.log("receiver: computed SAS", sas);
      hooks.onSAS?.(sas);
      hooks.onSASHash?.(fullHashHex);

      timer.arm(STATES.SAS_CONFIRM, "timeout_wait_sas");
      const ok = await Promise.resolve(hooks.waitConfirm?.(sas));
      if (!ok) {
        // user rejected SAS → MALLORY
        fsm.rejected();
        RC.close?.();
        return fail("receiver:sas_rejected");
      }

      // Send our confirm, but DO NOT enter READY yet — wait for peer confirm (RTC)
      sentConfirm = makeRcvConfirm({ session });
      lastSent = sentConfirm;
      RC.send(sentConfirm);
    waitingPeerConfirm = (session.policy === "rtc");
    if (!waitingPeerConfirm) {
      await waitAckAtLeast(minRecoverableRid());
      timer.clear();
      fsm.rcvconfirm(); // -> READY
      hooks.onDone?.({ msgS });
      return;
    }
    // RTC: wait for peer rcvconfirm or close/timeout
    timer.arm(STATES.SAS_CONFIRM, "timeout_wait_peer_confirm");
    return;
    }

    if (isFrame(m, "rcvconfirm", session.sessionId)) {
      hooks.onPeerConfirm?.(m);
      if (waitingPeerConfirm) {
        timer.clear();
        waitingPeerConfirm = false;
        fsm.rcvconfirm(); // SAS_CONFIRM -> READY
        hooks.onDone?.({ msgS });
      }
      return;
    }
  }

  return {
    close: () => scope.teardown(),
    getState: () => fsm.state,
    onState: (cb) => { stateSubs.add(cb); return () => stateSubs.delete(cb); },
  };
}