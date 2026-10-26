// Manual diagnostic: node tests/network-probe.cjs. No app catalogue cache is used.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const BASE = 'https://api.bgm.tv';
const PROXY_KEYS = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY', 'no_proxy', 'NO_PROXY'];
const proxies = PROXY_KEYS.map(key => process.env[key]).filter(Boolean);

function redact(value) {
  let text = String(value || '');
  for (const proxy of proxies) text = text.split(proxy).join('[proxy redacted]');
  return text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[credentials redacted]@');
}

async function probe(mode, fetchImpl) {
  const results = await Promise.all([
    { name: 'calendar', endpoint: '/calendar' },
    { name: 'hot', endpoint: '/v0/search/subjects?limit=1&offset=0', body: { keyword: '', sort: 'heat', filter: { type: [2] } } },
  ].map(async target => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const started = Date.now();
    try {
      const response = await fetchImpl(BASE + target.endpoint, {
        signal: controller.signal, timeout: 12000, cache: 'no-store',
        method: target.body ? 'POST' : 'GET',
        body: target.body ? JSON.stringify(target.body) : undefined,
        headers: { 'User-Agent': 'AniView/1.0.1 network diagnostics', Accept: 'application/json', ...(target.body ? { 'Content-Type': 'application/json' } : {}) },
      });
      const data = await response.json();
      return { mode, target: target.name, ms: Date.now() - started, status: response.status,
        count: Array.isArray(data) ? data.reduce((n, day) => n + (day.items || []).length, 0) : data.data?.length };
    } catch (error) {
      return { mode, target: target.name, ms: Date.now() - started, error: {
        name: error.name, type: error.type, code: error.code, errno: error.errno,
        message: redact(error.message), cause: error.cause ? { code: error.cause.code, message: redact(error.cause.message) } : undefined,
      } };
    } finally { clearTimeout(timer); }
  }));
  for (const result of results) console.log(JSON.stringify(result));
}

async function child(mode) {
  if (mode === 'electron-system') {
    const { app, net, session } = require('electron');
    app.disableHardwareAcceleration();
    app.setPath('userData', path.join(__dirname, '..', '.repair-verification', `network-profile-${Date.now()}-${process.pid}`));
    await app.whenReady();
    const proxyDecision = await session.defaultSession.resolveProxy(BASE);
    console.log(JSON.stringify({ mode, systemProxy: redact(proxyDecision), proxyEnvPresent: PROXY_KEYS.some(key => !!process.env[key]) }));
    try { await probe(mode, (...args) => net.fetch(...args)); }
    finally { app.quit(); }
  } else {
    const fetch = require('node-fetch');
    const HttpsProxyAgent = require('https-proxy-agent');
    const proxy = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
    const agent = mode === 'node-env-agent' && proxy ? new HttpsProxyAgent(proxy) : new (require('https').Agent)();
    console.log(JSON.stringify({ mode, proxyEnvPresent: !!proxy, usesExplicitProxy: mode === 'node-env-agent' && !!proxy }));
    try { await probe(mode, (url, options) => fetch(url, { ...options, agent })); }
    finally { agent.destroy(); }
  }
}

async function run() {
  const electron = require('electron');
  const output = [];
  await Promise.all(['node-env-agent', 'node-direct', 'electron-system'].map(mode => new Promise(resolve => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    if (mode !== 'node-env-agent') for (const key of PROXY_KEYS) delete env[key];
    const executable = mode === 'electron-system' ? electron : process.execPath;
    const processChild = spawn(executable, [__filename, mode], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    processChild.stdout.on('data', chunk => { stdout += chunk; });
    processChild.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => processChild.kill(), 20000);
    processChild.on('close', code => {
      clearTimeout(timer);
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean).map(redact);
      for (const line of lines) console.log(line);
      const result = { mode, code, lines, stderr: redact(stderr).slice(0, 2000) };
      if (result.stderr) console.log(JSON.stringify({ mode, stderr: result.stderr }));
      output.push(result);
      resolve();
    });
  })));
  const directory = path.join(__dirname, '..', '.repair-verification');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'network-probe.json'), JSON.stringify({ at: new Date().toISOString(), output }, null, 2));
}

const mode = process.argv[2];
(mode ? child(mode) : run()).catch(error => { console.error(redact(error.stack)); process.exitCode = 1; });
