/**
 * Mailbox transport surface (stable):
 *
 *  - send(frame)                      // single-argument; frame is a JSON-serialisable object
 *  - onMessage(cb(frame)) => unsub    // receive frames (already de-duped/ordered by seq if provided)
 *  - onUp(cb) / onDown(cb) / onClose(cb)
 *  - close(code?, reason?)
 *
 * Durable semantics: frames queued while offline; delivery resumes in-order on reconnect.
 * Callers MUST send objects like { type: "xyz", ... } — no dual-arity variants.
 */
export { mailboxTransport } from "./mailbox.js";
export { browserWSWithReconnect } from "./ws.js";