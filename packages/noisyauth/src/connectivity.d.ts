export function attachTransportLifecycle({
  tx,
  scope,
  startNow,
  startWhenUp,
  onUp,
  onDown,
}: {
  tx: any;
  scope: any;
  startNow: any;
  startWhenUp: any;
  onUp: any;
  onDown: any;
}): () => void;
