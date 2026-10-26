const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const nodeFetch = require('node-fetch');
const HttpsProxyAgent = require('https-proxy-agent');

function getElectron() {
  if (!process.versions.electron || process.type === 'renderer') return null;
  const electron = require('electron');
  return electron.app && electron.net ? electron : null;
}

function errorCode(error) {
  // Only log a short symbolic code; an exception message can contain proxy credentials or URLs.
  const token = error?.code || error?.cause?.code ||
    String(error?.message || '').match(/\b(?:net::)?(ERR_[A-Z_]+)\b/)?.[1] || error?.name || 'NETWORK_ERROR';
  return /^[A-Za-z_][A-Za-z_0-9]{0,79}$/.test(token) ? token : 'NETWORK_ERROR';
}

function logNetworkError(record) {
  try {
    const electron = getElectron();
    if (!electron?.app.isReady()) return;
    const file = path.join(electron.app.getPath('userData'), 'network-errors.log');
    const line = JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.writeFileSync(file, line);
    else fs.appendFileSync(file, line);
  } catch { /* Diagnostics must never cause a request failure. */ }
}

function networkErrorMessage(error) {
  const code = errorCode(error);
  if (/PROXY|TUNNEL/.test(code)) return '无法连接系统代理，请确认代理软件已启动，或在 Windows 中关闭无效代理后重试';
  if (/NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/.test(code)) return '无法解析数据服务地址，请检查网络或系统代理后重试';
  if (/CERT|SSL|TLS/.test(code)) return '网络安全证书验证失败，请检查系统时间和代理证书后重试';
  if (/TIMED_OUT|ETIMEDOUT|AbortError/.test(code)) return '网络请求超时，请检查网络或系统代理后重试';
  if (/INTERNET_DISCONNECTED|ENETUNREACH/.test(code)) return '当前网络未连接，请联网后重试';
  return '无法连接数据服务，请检查网络或 Windows 系统代理后重试';
}

function abortError() {
  return Object.assign(new Error('The request was aborted'), { name: 'AbortError', type: 'aborted' });
}

function createNetworkFetch({ getElectron: electronProvider = getElectron,
  nodeFetchImpl = nodeFetch, logError = logNetworkError } = {}) {
  let directHttp, directHttps;
  const proxyAgents = new Map();

  function nodeAgent(parsed) {
    const proxy = (parsed.protocol === 'https:' ? process.env.https_proxy || process.env.HTTPS_PROXY : '') ||
      process.env.http_proxy || process.env.HTTP_PROXY;
    if (proxy) {
      if (!proxyAgents.has(proxy)) proxyAgents.set(proxy, new HttpsProxyAgent(proxy));
      return proxyAgents.get(proxy);
    }
    if (parsed.protocol === 'https:') return directHttps ||= new https.Agent({ keepAlive: true });
    return directHttp ||= new http.Agent({ keepAlive: true });
  }

  return async function networkFetch(url, options = {}) {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Unsupported network protocol');
    const electron = electronProvider();
    const transport = electron?.net?.fetch && electron?.app ? 'system' : 'node';
    const report = error => {
      try { logError({ transport, host: target.hostname, code: errorCode(error) }); } catch { /* best effort */ }
    };
    try {
      if (transport === 'node') {
        // CLI/tests keep node-fetch support. Desktop requests always use Chromium's system network stack.
        return await nodeFetchImpl(url, { ...options, agent: options.agent || nodeAgent });
      }
      await electron.app.whenReady();
      if (options.signal?.aborted) throw abortError();
      // Node-only options must not leak into Chromium. The caller owns a deadline covering headers AND body.
      const { agent, timeout, size = 8 * 1024 * 1024, ...init } = options;
      if (target.protocol === 'http:' && init.headers) {
        const headers = new Headers(init.headers);
        // Match normal browser referrer policy: do not send an HTTPS referrer to an HTTP media URL.
        if (/^https:/i.test(headers.get('referer') || '')) {
          headers.delete('referer');
          init.headers = headers;
        }
      }
      const response = await electron.net.fetch(url, init);
      let used = false;
      let reader;
      let cancelled = false;
      function destroy() {
        cancelled = true;
        const cancel = reader ? reader.cancel() : response.body?.cancel();
        cancel?.catch(() => {});
      }
      async function buffer() {
        if (used) throw new TypeError('Response body has already been consumed');
        used = true;
        const signal = options.signal;
        const onAbort = () => destroy();
        try {
          if (signal?.aborted || cancelled) throw abortError();
          if (!response.body) return Buffer.alloc(0);
          reader = response.body.getReader();
          signal?.addEventListener('abort', onAbort, { once: true });
          const chunks = [];
          let length = 0;
          while (true) {
            const result = await reader.read();
            if (signal?.aborted || cancelled) throw abortError();
            if (result.done) break;
            length += result.value.byteLength;
            if (size > 0 && length > size) {
              throw Object.assign(new Error('Response body is too large'), { code: 'ERR_RESPONSE_TOO_LARGE' });
            }
            chunks.push(Buffer.from(result.value));
          }
          return Buffer.concat(chunks, length);
        } catch (error) {
          destroy();
          report(error);
          throw error;
        } finally {
          signal?.removeEventListener('abort', onAbort);
          reader?.releaseLock();
        }
      }
      // Compatibility with the small subset of node-fetch used by the catalogue and crawler.
      return {
        ok: response.ok, status: response.status, headers: response.headers,
        body: { destroy },
        buffer,
        text: async () => (await buffer()).toString('utf8'),
        json: async () => JSON.parse((await buffer()).toString('utf8').replace(/^\uFEFF/, '')),
      };
    } catch (error) {
      report(error);
      throw error;
    }
  };
}

module.exports = { networkFetch: createNetworkFetch(), createNetworkFetch, networkErrorMessage, errorCode };
