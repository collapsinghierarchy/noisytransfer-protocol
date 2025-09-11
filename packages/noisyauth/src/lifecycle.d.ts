export function makeScope(): {
    signal: AbortSignal;
    addUnsub(fn: any): any;
    teardown(reason: any): void;
};
export function throwIfAborted(signal: any): void;
export function raceAbort(p: any, signal: any): Promise<any>;
