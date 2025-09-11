/**
 * Create a single-phase timer: at most one active phase at a time.
 * T is an object mapping PHASE -> ms (e.g. { WAIT_COMMIT: 8000, ... }).
 */
export function makePhaseTimer({ T, onTimeout, resend }: {
    T: any;
    onTimeout: any;
    resend: any;
}): {
    arm: (nextPhase: any, code: any, overrideMs: any) => void;
    clear: () => void;
    is: (p: any) => boolean;
    readonly phase: any;
};
