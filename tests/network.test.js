const test = require('node:test');
const assert = require('node:assert/strict');
const { ReadableStream } = require('node:stream/web');
const { createNetworkFetch, networkErrorMessage } = require('../src/main/network');

function systemFetch(fetchImpl, { whenReady = async () => {}, logError = () => {} } = {}) {
  return createNetworkFetch({
    getElectron: () => ({ app: { whenReady }, net: { fetch: fetchImpl } }),
    nodeFetchImpl: () => { throw new Error('Desktop requests must use the system network stack'); },
    logError,
  });
}

function withoutProxyEnvironment(work) {
  const names = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  return Promise.resolve().then(work).finally(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test('desktop requests use Chromium after app readiness with no injected proxy environment', async () => {
  await withoutProxyEnvironment(async () => {
    let ready;
    let calls = 0;
    const waitForReady = new Promise(resolve => { ready = resolve; });
    const fetch = systemFetch(async () => {
      calls++;
      return new Response('{"data":[]}');
    }, { whenReady: () => waitForReady });
    const pending = fetch('https://api.bgm.tv/calendar');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 0);
    ready();
    assert.deepEqual(await (await pending).json(), { data: [] });
    assert.equal(calls, 1);
  });
});

test('Chromium receives request data and abort signal but no node-only transport options', async () => {
  let observed;
  const controller = new AbortController();
  const headers = { 'Content-Type': 'application/json' };
  const fetch = systemFetch(async (url, options) => {
    observed = { url, options };
    return new Response('{"ok":true}');
  });
  const response = await fetch('https://api.bgm.tv/v0/search/subjects', {
    method: 'POST', body: '{"keyword":"动画"}', headers, signal: controller.signal,
    agent: { testOnlyAgent: true }, timeout: 10000, size: 100,
  });
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.body, '{"keyword":"动画"}');
  assert.equal(observed.options.headers, headers);
  assert.equal(observed.options.signal, controller.signal);
  for (const key of ['agent', 'timeout', 'size', 'rejectUnauthorized']) {
    assert.equal(Object.hasOwn(observed.options, key), false);
  }
  assert.deepEqual(await response.json(), { ok: true });
});

test('an already cancelled request never reaches Chromium', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const fetch = systemFetch(async () => { calls++; return new Response(''); });
  await assert.rejects(fetch('https://api.bgm.tv/calendar', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('HTTP media removes an HTTPS referrer without mutating shared headers or the user agent', async () => {
  const received = [];
  const headers = { Referer: 'https://missjun.com/', 'User-Agent': 'AniView media test' };
  const original = { ...headers };
  const fetch = systemFetch(async (_url, options) => {
    received.push(new Headers(options.headers));
    return new Response('');
  });
  await fetch('http://media.example.test/video.mp4', { headers });
  assert.equal(received[0].get('referer'), null);
  assert.equal(received[0].get('user-agent'), 'AniView media test');
  assert.deepEqual(headers, original);

  await fetch('https://media.example.test/video.mp4', { headers });
  assert.equal(received[1].get('referer'), 'https://missjun.com/');
  assert.equal(received[1].get('user-agent'), 'AniView media test');
  assert.deepEqual(headers, original);
});

test('aborting while reading a stalled body cancels the stream and rejects the request', async () => {
  const controller = new AbortController();
  let cancelled = 0;
  const stream = new ReadableStream({
    start(source) { source.enqueue(Uint8Array.from([1, 2, 3])); },
    cancel() { cancelled++; },
  });
  const fetch = systemFetch(async () => new Response(stream));
  const response = await fetch('https://example.test/stream', { signal: controller.signal });
  const reading = response.buffer();
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(reading, { name: 'AbortError' });
  assert.equal(cancelled, 1);
});

test('the buffer adapter preserves binary bytes and prevents reading the same body twice', async () => {
  const binary = Uint8Array.from([0, 255, 128, 13, 10]);
  const fetch = systemFetch(async () => new Response(binary));
  const response = await fetch('https://example.test/binary');
  const result = await response.buffer();
  assert.ok(Buffer.isBuffer(result));
  assert.deepEqual(result, Buffer.from(binary));
  await assert.rejects(response.buffer(), TypeError);
});

test('HTTP status and headers remain available and callers can stop an unwanted response', async () => {
  let cancelled = 0;
  const fetch = systemFetch(async () => new Response(new ReadableStream({
    cancel() { cancelled++; },
  }), { status: 404, headers: { 'Content-Type': 'text/html; charset=gbk' } }));
  const response = await fetch('https://example.test/missing');
  assert.equal(response.ok, false);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=gbk');
  response.body.destroy();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1);
});

test('the body size limit counts all chunks and cancels oversized downloads', async () => {
  let cancelled = 0;
  const logs = [];
  const fetch = systemFetch(async () => new Response(new ReadableStream({
    start(source) {
      source.enqueue(new Uint8Array(6));
      source.enqueue(new Uint8Array(6));
    },
    cancel() { cancelled++; },
  })), { logError: record => logs.push(record) });
  const response = await fetch('https://example.test/large', { size: 10 });
  await assert.rejects(response.buffer(), { code: 'ERR_RESPONSE_TOO_LARGE' });
  assert.equal(cancelled, 1);
  assert.equal(logs[0].code, 'ERR_RESPONSE_TOO_LARGE');
});

test('certificate errors remain failures and never trigger an insecure transport fallback', async () => {
  const failure = new Error('net::ERR_CERT_AUTHORITY_INVALID');
  const logs = [];
  const fetch = systemFetch(async () => { throw failure; }, { logError: record => logs.push(record) });
  await assert.rejects(fetch('https://api.bgm.tv/calendar'), error => error === failure);
  assert.equal(logs[0].code, 'ERR_CERT_AUTHORITY_INVALID');
  assert.match(networkErrorMessage(failure), /证书/);
});

test('diagnostics omit credentials, query strings, and raw exception messages', async () => {
  const logs = [];
  const failure = Object.assign(new Error('Proxy http://alice:private-password@proxy.example:80 failed for ?token=private-token'), {
    code: 'ERR_PROXY_CONNECTION_FAILED',
  });
  const fetch = systemFetch(async () => { throw failure; }, { logError: record => logs.push(record) });
  await assert.rejects(fetch('https://user:private-url-password@api.bgm.tv/calendar?token=private-token'));
  assert.deepEqual(logs, [{ transport: 'system', host: 'api.bgm.tv', code: 'ERR_PROXY_CONNECTION_FAILED' }]);
  assert.doesNotMatch(JSON.stringify(logs), /alice|password|private|token|proxy\.example/);
  assert.match(networkErrorMessage(failure), /系统代理/);
});

test('the Node fallback keeps node-fetch response compatibility and normal certificate verification', async () => {
  await withoutProxyEnvironment(async () => {
    let captured;
    const expected = { ok: true, status: 200, buffer: async () => Buffer.from('ok') };
    const fetch = createNetworkFetch({
      getElectron: () => null,
      nodeFetchImpl: async (url, options) => { captured = { url, options }; return expected; },
      logError: () => {},
    });
    const response = await fetch('https://api.bgm.tv/calendar', { size: 1024 });
    assert.equal(response, expected);
    assert.equal(captured.options.size, 1024);
    const agent = captured.options.agent(new URL(captured.url));
    assert.notEqual(agent.options.rejectUnauthorized, false);
    agent.destroy();
  });
});

test('a diagnostics write failure cannot replace the original network failure', async () => {
  const failure = Object.assign(new Error('Network unavailable'), { code: 'ERR_INTERNET_DISCONNECTED' });
  const fetch = systemFetch(async () => { throw failure; }, { logError: () => { throw new Error('Read only profile'); } });
  await assert.rejects(fetch('https://api.bgm.tv/calendar'), error => error === failure);
});
