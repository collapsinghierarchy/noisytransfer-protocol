export function isPreReady(s: any): boolean;
export function classifyTransportClose(cur: any): {
    code: string;
    kind: string;
};
export function nextState(role: any, cur: any, evt: any): any;
export const STATES: Readonly<{
    IDLE: "IDLE";
    WAIT_COMMIT: "WAIT_COMMIT";
    WAIT_OFFER: "WAIT_OFFER";
    WAIT_REVEAL: "WAIT_REVEAL";
    SAS_CONFIRM: "SAS_CONFIRM";
    READY: "READY";
    ERROR: "ERROR";
    MALLORY: "MALLORY";
}>;
export const PRE_READY: Readonly<Set<"IDLE" | "WAIT_COMMIT" | "WAIT_OFFER" | "WAIT_REVEAL" | "SAS_CONFIRM">>;
