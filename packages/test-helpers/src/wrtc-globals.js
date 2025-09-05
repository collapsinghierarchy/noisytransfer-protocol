// Install @roamhq/wrtc globals for Node test environment.
export function installWrtcGlobals(wrtc) {
  globalThis.RTCPeerConnection ??= wrtc.RTCPeerConnection;
  globalThis.RTCIceCandidate ??= wrtc.RTCIceCandidate;
  globalThis.RTCSessionDescription ??= wrtc.RTCSessionDescription;
}
