/** Type guard */
export function isNoisyError(e: any): boolean;
/** Convenience: wrap an unknown error value as a NoisyError with a known code. */
export function fromUnknown(code: any, message: any, context: any, cause: any): any;
/** Stable mapping for HTTP status */
export function httpStatusToCode(status: any): "NC_NOT_FOUND" | "NC_NOT_COMMITTED" | "NC_METHOD_NOT_ALLOWED" | "NC_PAYLOAD_TOO_LARGE" | "NC_RANGE_UNSATISFIABLE" | "NC_TOO_MANY_REQUESTS" | "NC_HTTP_5XX" | "NC_HTTP_STATUS";
export class NoisyError extends Error {
    /**
     * @param {Object} opts
     * @param {NoisyCode|string} opts.code // stable machine code (e.g., "NC_NOT_COMMITTED")
     * @param {string} opts.message    // human message (can change)
     * @param {Record<string, any>=} opts.context
     * @param {any=} opts.cause
     * @param {boolean=} opts.retriable
     */
    constructor({ code, message, context, cause, retriable }: {
        code: NoisyCode | string;
        message: string;
        context?: Record<string, any> | undefined;
        cause?: any | undefined;
        retriable?: boolean | undefined;
    });
    code: string;
    context: Record<string, any>;
    cause: any;
    retriable: boolean;
}
