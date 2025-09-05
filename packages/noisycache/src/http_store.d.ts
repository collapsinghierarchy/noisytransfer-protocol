export class HttpStore {
    /**
     * @param {string} base - e.g., "http://localhost:1234"
     * @param {Object} [opts]
     * @param {typeof fetch} [opts.fetch]
     * @param {number} [opts.retries=3]
     * @param {number} [opts.retryDelay=250]
     * @param {Console} [opts.logger]
     */
    constructor(base: string, opts?: {
        fetch?: typeof fetch;
        retries?: number;
        retryDelay?: number;
        logger?: Console;
    });
    base: string;
    _fetch: typeof fetch;
    retries: number;
    retryDelay: number;
    log: Console;
    _request(method: any, url: any, { headers, body, signal, expect, parseJson, duplex, retriesOverride, }?: {
        headers?: {};
        expect?: number;
        parseJson?: boolean;
    }): Promise<any>;
    create({ signal }?: {}): Promise<any>;
    _isStreamBody(body: any): boolean;
    putBlob({ objectId, uploadUrl, data, signal }: {
        objectId: any;
        uploadUrl: any;
        data: any;
        signal: any;
    }): Promise<{
        etag: any;
    }>;
    putManifest({ objectId, manifestUrl, manifest, signal }: {
        objectId: any;
        manifestUrl: any;
        manifest: any;
        signal: any;
    }): Promise<void>;
    commit({ objectId, signal }: {
        objectId: any;
        signal: any;
    }): Promise<any>;
    headBlob({ objectId, signal }: {
        objectId: any;
        signal: any;
    }): Promise<{
        status: any;
        etag: any;
        acceptRanges: any;
        contentType: any;
    }>;
    getRange({ objectId, start, end, signal }: {
        objectId: any;
        start: any;
        end: any;
        signal: any;
    }): Promise<{
        bytes: Uint8Array<any> | Buffer<any>;
        contentRange: any;
    }>;
    get({ objectId, signal }: {
        objectId: any;
        signal: any;
    }): Promise<Uint8Array<any> | Buffer<any>>;
}
