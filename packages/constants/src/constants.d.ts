export namespace AUTH {
    let PROTO_LABEL: string;
}
export namespace ALG {
    let KDF: string;
    let SAS: string;
}
export namespace FRAME {
    let COMMIT: string;
    let OFFER: string;
    let REVEAL: string;
    let RCVCONFIRM: string;
}
export namespace ID_KIND {
    let CERT: string;
    let PUBKEY: string;
}
export namespace STREAM {
    let LABEL_S2R: string;
    let LABEL_R2S: string;
}
export namespace CRYPTO {
    let COMMIT_DS_PREFIX: string;
}
export namespace CACHE {
    let FRAME_TYPE: string;
    let KEYPACKET_TYPE: string;
    let SIG_ALG: string;
}
export const BINARY_FIELDS: Set<string>;
export namespace TIMEOUTS {
    namespace ws_async {
        let WAIT_COMMIT: number;
        let WAIT_OFFER: number;
        let WAIT_REVEAL: number;
        let SAS_CONFIRM: number;
    }
    namespace rtc {
        let WAIT_COMMIT_1: any;
        export { WAIT_COMMIT_1 as WAIT_COMMIT };
        let WAIT_OFFER_1: any;
        export { WAIT_OFFER_1 as WAIT_OFFER };
        let WAIT_REVEAL_1: any;
        export { WAIT_REVEAL_1 as WAIT_REVEAL };
        let SAS_CONFIRM_1: any;
        export { SAS_CONFIRM_1 as SAS_CONFIRM };
    }
}
export const PROTO_LABEL: string;
