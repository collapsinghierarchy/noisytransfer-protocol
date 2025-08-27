/**
 * Build a symmetric stream context derived from HPKE via the **exporter**.
 * There is **no insecure fallback**; the HPKE context must provide an exporter.
 *
 * Returns:
 *   Sender => { seal(pt): Promise<Uint8Array>, open: throws, enc: ArrayBuffer, id: string }
 *   Receiver => { open(ct): Promise<Uint8Array>, seal: throws, id: string }
 *
 * The AAD 'id' defaults to a stable string derived from 'enc' so both sides agree.
 */
export function mkAeadStreamFromHpke(role: any, peerMaterial: any, ownPriv: any, opts?: {}): Promise<{
    seal: (pt: any) => Promise<Uint8Array<ArrayBuffer>>;
    open: () => Promise<never>;
    enc: any;
    id: any;
} | {
    open: (ct: any) => Promise<Uint8Array<ArrayBuffer>>;
    seal: () => Promise<never>;
    id: any;
    enc?: undefined;
}>;
/**
 * Build a symmetric stream context derived from HPKE via the **exporter**.
 * There is **no insecure fallback**; the HPKE context must provide an exporter.
 *
 * Returns:
 *   Sender => { seal(pt): Promise<Uint8Array>, open: throws, enc: ArrayBuffer, id: string }
 *   Receiver => { open(ct): Promise<Uint8Array>, seal: throws, id: string }
 *
 * The AAD 'id' defaults to a stable string derived from 'enc' so both sides agree.
 */
export function mkStream(role: any, peerMaterial: any, ownPriv: any, opts?: {}): Promise<{
    seal: (pt: any) => Promise<Uint8Array<ArrayBuffer>>;
    open: () => Promise<never>;
    enc: any;
    id: any;
} | {
    open: (ct: any) => Promise<Uint8Array<ArrayBuffer>>;
    seal: () => Promise<never>;
    id: any;
    enc?: undefined;
}>;
