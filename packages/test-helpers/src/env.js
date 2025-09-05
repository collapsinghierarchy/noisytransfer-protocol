// TEST_SIGNAL_MODE: "memory" | "ws-ephemeral" | "ws-external"
export function signallingMode() {
  return String(process.env.TEST_SIGNAL_MODE || "memory");
}
export function testSignalBase() {
  return String(process.env.TEST_SIGNAL_BASE || "ws://127.0.0.1:1234");
}
