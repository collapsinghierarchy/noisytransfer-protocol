/** Pure FSM facade (auth-only) for logging/tests */
export class ReceiverFsm {
    constructor(send: any, opts?: {});
    send: any;
    state: "IDLE";
    onTransition: any;
    transportClosed(): {
        code: string;
        kind: string;
    };
    start(): void;
    roomFull(): void;
    commit(): void;
    offer(): void;
    reveal(): void;
    rcvconfirm(): void;
    error(): void;
    rejected(): void;
    vrfyFail(): void;
    #private;
}
