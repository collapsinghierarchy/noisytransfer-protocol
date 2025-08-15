//TODO: currently obsolete
/* Shared helper: wait for ICE gathering to finish */
async function waitIceGatheringComplete(pc) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise(res => {
    pc.addEventListener("icegatheringstatechange", function cb() {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", cb);
        res();
      }
    });
  });
}

/* Helper: wait until ICE gathering is done */
async function waitIceComplete(pc) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise(res => pc.addEventListener("icegatheringstatechange", function cb() {
    if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", cb); res(); }
  }));
}