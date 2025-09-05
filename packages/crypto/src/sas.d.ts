/**
 * Compute SAS + full transcript hash (hex) from auth frames.
 * @returns {Promise<{ sas: string, fullHashHex: string }>}
 */
export function computeSASFromFrames({
  roomId,
  sessionId,
  commit,
  offer,
  reveal,
  digits,
}: {
  roomId: any;
  sessionId: any;
  commit: any;
  offer: any;
  reveal: any;
  digits?: number;
}): Promise<{
  sas: string;
  fullHashHex: string;
}>;
