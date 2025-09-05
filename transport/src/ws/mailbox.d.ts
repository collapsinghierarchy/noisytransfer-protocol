export function mailboxTransport(
  baseUrl: any,
  {
    room,
    side,
    sessionId,
    deliveredUpTo: initialDelivered,
  }?: {
    deliveredUpTo?: number;
  }
): Promise<{
  features: {
    durableOrdered: boolean;
  };
  send(rawFrame: any): void;
  onMessage: (cb: any) => () => void;
  onClose(cb: any): () => () => void;
  onUp(cb: any): () => () => void;
  onDown(cb: any): () => () => void;
  close(code?: number, reason?: string): void;
  readonly isConnected: boolean;
}>;
