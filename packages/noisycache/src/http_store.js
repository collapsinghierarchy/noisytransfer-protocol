import { NoisyError, fromUnknown  } from '@noisytransfer/errors/noisy-error.js';

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

function join(base, path) {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function httpStatusToCode(status) {
  switch (status) {
    case 400: return 'NC_HTTP_400';
    case 401: return 'NC_HTTP_401';
    case 403: return 'NC_HTTP_403';
    case 404: return 'NC_HTTP_404';
    case 409: return 'NC_HTTP_409';
    case 412: return 'NC_HTTP_412';
    case 416: return 'NC_HTTP_416';
    case 429: return 'NC_HTTP_429';
    case 500: return 'NC_HTTP_500';
    case 502: return 'NC_HTTP_502';
    case 503: return 'NC_HTTP_503';
    case 504: return 'NC_HTTP_504';
    default:  return 'NC_HTTP';
  }
}

export class HttpStore {
  /**
   * @param {string} base - e.g., "http://localhost:1234"
   * @param {Object} [opts]
   * @param {typeof fetch} [opts.fetch]
   * @param {number} [opts.retries=3]
   * @param {number} [opts.retryDelay=250]
   * @param {Console} [opts.logger]
   */
  constructor(base, opts = {}) {
    this.base = base.replace(/\/$/, '');
    this._fetch = opts.fetch || globalThis.fetch;
    this.retries = opts.retries ?? 3;
    this.retryDelay = opts.retryDelay ?? 250;
    this.log = opts.logger || console;
  }

  async _request(method, url, {
    headers = {}, body, signal, expect = 200, parseJson = false,
    duplex,                       // 'half' for streaming bodies (Node/undici)
    retriesOverride,              // override retry count for this call
  } = {}) {
    const retryable = new Set([429, 502, 503, 504]);
    let attempt = 0;
    const max = (retriesOverride ?? this.retries) + 1;
    let lastErr;
    while (attempt < max) {
      try {
        const fetchOpts = { method, headers, body, signal };
        if (duplex) fetchOpts.duplex = duplex;
        const res = await this._fetch(url, fetchOpts);
        if (res.status === expect || (Array.isArray(expect) && expect.includes(res.status))) {
          if (!parseJson) return res;
          const txt = await res.text();
          try { return JSON.parse(txt || 'null'); } catch (e) {
            throw new NoisyError({ code: 'NC_BAD_JSON', message: 'Invalid JSON', context: { url, method, status: res.status, body: txt }, cause: e });
          }
        }
        // Non-expected status → read body (unless HEAD)
        const bodyText = method === 'HEAD' ? '' : await res.text();
        const err = new NoisyError({ code: httpStatusToCode(res.status), message: 'HTTP error', context: { url, method, status: res.status, body: bodyText }, cause: res });
        if (retryable.has(res.status) && attempt < max - 1) {
          attempt++;
          await sleep(this.retryDelay * Math.pow(2, attempt - 1), signal);
          continue;
        }
          throw fromUnknown(err, { where: 'http_store' });
      } catch (e) {
        if (e?.name === 'AbortError') throw new NoisyError({ code: 'NC_ABORTED', message: 'fetch aborted', cause: e, retriable: true });
        lastErr = e;
        // Network-level error: retry
        if (attempt < max - 1) {
          attempt++;
          await sleep(this.retryDelay * Math.pow(2, attempt - 1), signal);
          continue;
        }
        if (e instanceof NoisyError)
          throw new NoisyError({ code: 'NC_NETWORK', message: 'Network error', context: { url, method }, cause: e });
      }
    }
   throw fromUnknown(lastErr, { where: 'http_store' });
  }

  // API wrappers
  async create({ signal } = {}) {
    const url = join(this.base, '/objects');
    return await this._request('POST', url, { signal, parseJson: true, expect: 200 });
  }

    // helper: detect stream-like bodies (Node Readable or Web ReadableStream)
  _isStreamBody(body) {
    if (!body) return false;
    // Node.js Readable streams usually have .pipe and .readable
    if (typeof body.pipe === 'function') return true;
    // Web ReadableStream has getReader()
    if (typeof body.getReader === 'function') return true;
    return false;
  }

  async putBlob({ objectId, uploadUrl, data, signal }) {
    const url = uploadUrl || join(this.base, `/objects/${objectId}/blob`);
    const isStream = this._isStreamBody(data);
    const res = await this._request('PUT', url, {
      signal,
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
      expect: 204,
      duplex: isStream ? 'half' : undefined,
      // streamed bodies are not replayable; disable retries to avoid reuse errors
      retriesOverride: isStream ? 0 : undefined,
    });
    return { etag: res.headers.get('etag') };
  }

  async putManifest({ objectId, manifestUrl, manifest, signal }) {
    const url = manifestUrl || join(this.base, `/objects/${objectId}/manifest`);
    await this._request('PUT', url, {
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
      expect: 204,
    });
  }

  async commit({ objectId, signal }) {
    const url = join(this.base, `/objects/${objectId}/commit`);
    return await this._request('POST', url, { signal, parseJson: true, expect: 200 });
  }

  async headBlob({ objectId, signal }) {
    const url = join(this.base, `/objects/${objectId}/blob`);
    const res = await this._request('HEAD', url, { signal, expect: [204, 409] });
    // Status 204 (committed) or 409 (not committed)
    return {
      status: res.status,
      etag: res.headers.get('etag'),
      acceptRanges: res.headers.get('accept-ranges'),
      contentType: res.headers.get('content-type'),
    };
  }

  async getRange({ objectId, start, end, signal }) {
    const url = join(this.base, `/objects/${objectId}/blob`);
    const res = await this._request('GET', url, {
      signal,
      headers: { 'Range': `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
      expect: 206,
    });
   const ab = await res.arrayBuffer();
   return { bytes: new Uint8Array(ab), contentRange: res.headers.get('content-range') };
  }

  async get({ objectId, signal }) {
    const url = join(this.base, `/objects/${objectId}/blob`);
    const res = await this._request('GET', url, {
      signal,
      headers: { 'Accept-Encoding': 'identity' },
      expect: 200,
    });
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  }
}