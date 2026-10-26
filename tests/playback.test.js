const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Response } = require('node-fetch');
const { _createCrawler: createCrawler, _parsePlayer: parsePlayer, _parseSearch: parseSearch, _parseEpisodes: parseEpisodes } = require('../src/main/crawler');

const TITLE = '测试动漫';
const BASE = 'https://missjun.com';
const searchHtml = '<a href="/missjundy/101/" title="测试动漫">详情</a>';
const detailHtml = '<a href="/missjunpy/101-9-1/">第01集</a><a href="/missjunpy/101-12-1/">第01集</a><a href="/missjunpy/101-12-2/">第2.5集</a>';
const playerHtml = url => '<script>var player_aaaa=' + JSON.stringify({ url, encrypt: 0, vod_data: { note: 'a }; string' } }) + '</script><script>other();</script>';
function fixtureFetch(overrides = {}) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    if (overrides[url]) return overrides[url](options);
    if (url.includes('/tag/')) return new Response(searchHtml);
    if (url === BASE + '/missjundy/101/') return new Response(detailHtml);
    if (url.includes('/missjunpy/101-9-')) return new Response(playerHtml('https://media.test/nine.m3u8'));
    if (url.includes('/missjunpy/101-12-')) return new Response(playerHtml('https://media.test/twelve.m3u8'));
    if (url.startsWith('https://media.test/')) return new Response('#EXTM3U\n#EXT-X-ENDLIST');
    throw new Error('Unexpected URL: ' + url);
  };
  fn.calls = calls;
  return fn;
}

test('parses actual nested player JSON without a semicolon and encoded URLs without eval', () => {
  const url = 'https://video.test/a.m3u8?token=a%3Bb';
  assert.equal(parsePlayer(playerHtml(url)), url);
  assert.equal(parsePlayer('<script>var player_aaaa=' + JSON.stringify({ encrypt: 2, url: Buffer.from(encodeURIComponent(url)).toString('base64') }) + '</script>'), url);
  assert.equal(parsePlayer('var player_aaaa={"url":"javascript:alert(1)"}'), null);
  assert.equal(parsePlayer('var player_aaaa={"url":"https://video.test/embed.html"}'), null);
});

test('search examines all records and refuses a different season or recap', () => {
  const html = ['第二季', '[电影解说]', '剧场版', '续作', '特别篇', ''].map((suffix, i) => '<a href="/missjundy/' + i + '/" title="测试动漫' + suffix + '"></a>').join('');
  assert.deepEqual(parseSearch(html, TITLE), [{ title: TITLE, url: BASE + '/missjundy/5/' }]);
});

test('uses playlist labels and actual line IDs instead of guessing six lines or ordinal episodes', () => {
  const entries = parseEpisodes(detailHtml + '<a href="/missjunpy/101-1-1/">更新至28集</a><a href="/missjunpy/222-1-1/">第01集</a>', BASE + '/missjundy/101/');
  assert.deepEqual(entries.map(entry => [entry.sid, entry.episode]), [[9, 1], [12, 1], [12, 2.5]]);
});

test('returns first successful GET manifest without waiting for a slow line', async () => {
  let slowFinished = false;
  const fetchImpl = fixtureFetch({
    'https://media.test/nine.m3u8': async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
      slowFinished = true;
      return new Response('HEAD is rejected here, GET works', { status: 405 });
    },
  });
  const crawler = createCrawler({ fetchImpl, requestTimeout: 100, totalTimeout: 200 });
  const result = await crawler.getPlayUrl(TITLE, 1);
  assert.equal(result.url, 'https://media.test/twelve.m3u8');
  assert.equal(slowFinished, false);
  assert.ok(fetchImpl.calls.every(call => call.options.method !== 'HEAD'));
});

test('concurrent/repeated resolves share searches and forced refresh invalidates cached URLs', async () => {
  const fetchImpl = fixtureFetch();
  const crawler = createCrawler({ fetchImpl });
  const [first, second, catalog] = await Promise.all([crawler.getPlayUrl(TITLE), crawler.getPlayUrl(TITLE), crawler.getSourceEpisodes(TITLE)]);
  assert.equal(first.url, second.url);
  assert.deepEqual(catalog.episodes, [1, 2.5]);
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/tag/')).length, 1);
  await crawler.getPlayUrl(TITLE);
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/tag/')).length, 1);
  await crawler.getPlayUrl(TITLE, 1, { forceRefresh: true });
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/tag/')).length, 2);
});

test('HTTP and invalid manifest failures are surfaced instead of treating an error page as playable', async () => {
  const forbidden = createCrawler({ fetchImpl: async () => new Response('forbidden', { status: 403 }) });
  assert.match((await forbidden.getPlayUrl(TITLE)).error, /HTTP 403/);
  const invalid = createCrawler({ fetchImpl: fixtureFetch({
    'https://media.test/nine.m3u8': async () => new Response('<html>error</html>'),
    'https://media.test/twelve.m3u8': async () => new Response('<html>error</html>'),
  }) });
  assert.match((await invalid.getPlayUrl(TITLE)).error, /有效视频清单/);
});

test('resolution deadline bounds a stalled source and missing episodes are never guessed', async () => {
  const stalledFetch = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  const crawler = createCrawler({ fetchImpl: stalledFetch, totalTimeout: 10, requestTimeout: 20 });
  assert.match((await crawler.getPlayUrl(TITLE)).error, /超时/);
  const fetchImpl = fixtureFetch();
  const missing = await createCrawler({ fetchImpl }).getPlayUrl(TITLE, 80);
  assert.match(missing.error, /尚未收录第80集/);
  assert.ok(fetchImpl.calls.every(call => !call.url.includes('/missjunpy/')));
});

function playerHarness(api = {}) {
  const timers = new Map();
  let timerId = 0;
  const videoListeners = new Map();
  const video = { pause() {}, load() {}, removeAttribute() {}, play: async () => {}, playbackRate: 1,
    addEventListener(name, handler) { videoListeners.set(name, handler); } };
  const errorMessage = { textContent: '' };
  const elements = {
    'video-player': video,
    'player-loading': { style: {}, querySelector: () => ({ textContent: '' }) },
    'player-error': { style: {}, querySelector: () => errorMessage },
    'btn-switch-source': { style: {} },
  };
  const context = { window: { api }, document: { getElementById: id => elements[id], body: { classList: { remove() {} } } }, console, AbortController,
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/js/pages/player.js'), 'utf8') + '\nglobalThis.page = PlayerPage;', context);
  return { page: context.page, context, timers, video, videoListeners, elements, errorMessage };
}

test('stale episode resolution and results after leaving the player cannot start playback', async () => {
  const deferred = [];
  const harness = playerHarness({ getPlayUrl: () => new Promise(resolve => deferred.push(resolve)) });
  const played = [];
  harness.page.playHls = (_video, url) => played.push(url);
  const old = harness.page.resolveAndPlay({ animeTitle: 'old', episode: 1 });
  const next = harness.page.resolveAndPlay({ animeTitle: 'new', episode: 2 });
  deferred[1]({ url: 'https://test/new.m3u8', sid: 2 });
  await next;
  deferred[0]({ url: 'https://test/old.m3u8', sid: 1 });
  await old;
  assert.deepEqual(played, ['https://test/new.m3u8']);
  const leaving = harness.page.resolveAndPlay({ animeTitle: 'left', episode: 3 });
  harness.page.cleanup();
  deferred[2]({ url: 'https://test/left.m3u8', sid: 3 });
  await leaving;
  assert.deepEqual(played, ['https://test/new.m3u8']);
});

test('switch source uses a different discovered URL rather than retrying the same IPC call', async () => {
  const harness = playerHarness({ getAllSources: async () => ({ sources: [{ url: 'https://test/second.m3u8', sid: 8 }] }) });
  harness.page.currentParams = { animeTitle: TITLE, episode: 1 };
  harness.page.sources = [{ url: 'https://test/first.m3u8', sid: 1 }];
  harness.page.triedSources.add('https://test/first.m3u8');
  const played = [];
  harness.page.playHls = (_video, url) => played.push(url);
  await harness.page.switchSource();
  assert.deepEqual(played, ['https://test/second.m3u8']);
});

test('manifest parsed does not cancel startup timeout; actual playing does', () => {
  const harness = playerHarness();
  class FakeHls {
    static isSupported() { return true; }
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    static ErrorTypes = { MEDIA_ERROR: 'media', NETWORK_ERROR: 'network' };
    constructor() { this.handlers = {}; }
    on(event, handler) { this.handlers[event] = handler; }
    attachMedia() {}
    loadSource() {}
    destroy() {}
  }
  harness.context.Hls = FakeHls;
  harness.page.playHls(harness.video, 'https://test/video.m3u8');
  harness.page.hls.handlers.manifest();
  assert.equal(harness.timers.size, 1);
  harness.videoListeners.get('playing')();
  assert.equal(harness.timers.size, 0);
});

test('details fetch one catalogue with the unchanged title, retaining fractional episodes', async () => {
  const calls = [];
  const context = { window: { api: { getSourceEpisodes: async (...args) => { calls.push(args); return { episodes: [1, 2.5] }; } } }, document: { getElementById: () => ({ style: {}, textContent: '' }) }, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/js/pages/detail.js'), 'utf8') + '\nglobalThis.page = DetailPage;', context);
  const anime = { titleCn: TITLE, episodes: [{ ep: 1 }, { ep: 2.5 }, { ep: 3 }] };
  context.page.currentAnime = anime;
  context.page.renderEpisodePage = () => {};
  assert.equal(await context.page.checkEpisodePlayable(anime), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], TITLE);
  assert.equal(context.page.episodePlayableCache.get(2.5), true);
  assert.equal(context.page.episodePlayableCache.get(3), false);
});

test('a timed out resolution cannot start video when IPC eventually returns', async () => {
  let release;
  const harness = playerHarness({ getPlayUrl: () => new Promise(resolve => { release = resolve; }) });
  const played = [];
  harness.page.playHls = (_video, url) => played.push(url);
  const pending = harness.page.resolveAndPlay({ animeTitle: TITLE, episode: 1 });
  [...harness.timers.values()][0]();
  release({ url: 'https://test/late.m3u8' });
  await pending;
  assert.deepEqual(played, []);
  assert.match(harness.errorMessage.textContent, /超时/);
});

test('cleanup removes keyboard and media listeners instead of duplicating them across episodes', () => {
  const harness = playerHarness();
  const handlers = new Map();
  const target = { addEventListener: (name, handler) => handlers.set(name, handler), removeEventListener: name => handlers.delete(name) };
  harness.page.listen(target, 'keydown', () => {});
  harness.page.listen(target, 'timeupdate', () => {});
  assert.equal(handlers.size, 2);
  harness.page.cleanup();
  assert.equal(handlers.size, 0);
});

test('a source catalogue failure leaves availability unknown instead of marking every episode unavailable', async () => {
  const status = { style: {}, textContent: '' };
  const context = { window: { api: { getSourceEpisodes: async () => ({ error: 'request timeout' }) } }, document: { getElementById: () => status }, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/js/pages/detail.js'), 'utf8') + '\nglobalThis.page = DetailPage;', context);
  const anime = { titleCn: TITLE, episodes: [{ ep: 1 }, { ep: 2 }] };
  context.page.currentAnime = anime;
  assert.equal(await context.page.checkEpisodePlayable(anime), false);
  assert.equal(context.page.episodePlayableCache, null);
  assert.match(status.textContent, /request timeout/);
});

function detailHarness(api) {
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', style: {}, children: [], appendChild(child) { this.children.push(child); } });
    return nodes.get(id);
  };
  const context = { window: { api }, document: { getElementById: getNode, querySelector: getNode,
    createElement: () => ({ addEventListener(name, callback) { this[name] = callback; } }) }, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/js/pages/detail.js'), 'utf8') + '\nglobalThis.page = DetailPage;', context);
  context.page.container = { innerHTML: '', querySelector: () => null };
  return { page: context.page, nodes, getNode };
}

test('slow remaining episode pages do not block detail first paint and do not repeat source lookup', async () => {
  const first = Array.from({ length: 200 }, (_, i) => ({ ep: i + 1 }));
  const all = Array.from({ length: 1155 }, (_, i) => ({ ep: i + 1 }));
  const anime = { id: 'one', titleCn: TITLE, episodes: first, episodesTotal: 1155, episodesHasMore: true };
  let releaseAll;
  let sourceCalls = 0;
  const harness = detailHarness({ getDetail: async () => anime, getHistory: async () => [],
    getEpisodes: () => new Promise(resolve => { releaseAll = resolve; }),
    getSourceEpisodes: async () => { sourceCalls++; return { episodes: [1, 250, 1155] }; } });
  const painted = [];
  const refreshed = [];
  harness.page.render = function (item) { painted.push(item.episodes.length); this.checkEpisodePlayable(item); };
  harness.page.renderEpisodePage = item => refreshed.push(item.episodes.length);
  await harness.page.load('one'); // Must resolve while getEpisodes is still pending.
  assert.deepEqual(painted, [200]);
  assert.equal(anime.episodes.length, 200);
  assert.match(harness.getNode('episode-load-status').textContent, /200 \/ 1155.*正在补全/);
  harness.page.episodePage = 3;
  const pending = harness.page.episodesRequest.promise;
  releaseAll(all);
  await pending;
  assert.deepEqual(painted, [200]);
  assert.equal(refreshed.at(-1), 1155);
  assert.equal(harness.page.episodePage, 3);
  assert.equal(anime.episodesHasMore, false);
  assert.equal(harness.page.episodePlayableCache.get(250), true);
  assert.equal(sourceCalls, 1);
  assert.equal(harness.getNode('btn-jump-latest').disabled, false);
});

test('failed remaining pages preserve the first page and retry full episodes without reloading detail', async () => {
  const anime = { id: 'one', episodes: [{ ep: 1 }], episodesTotal: 2, episodesHasMore: true };
  let attempts = 0;
  const harness = detailHarness({ getEpisodes: async () => {
    if (++attempts === 1) throw new Error('offset 200 timeout');
    return [{ ep: 1 }, { ep: 2 }];
  } });
  harness.page.currentAnime = anime;
  harness.page.renderEpisodePage = () => {};
  await harness.page.loadRemainingEpisodes(anime);
  assert.equal(anime.episodes.length, 1);
  assert.equal(anime.episodesHasMore, true);
  assert.match(harness.getNode('episode-load-status').textContent, /offset 200 timeout/);
  const retry = harness.getNode('episode-load-status').children.at(-1);
  await retry.click();
  assert.equal(anime.episodes.length, 2);
  assert.equal(attempts, 2);
  assert.equal(anime.episodesError, '');
});

test('remaining episodes from a previously opened detail cannot overwrite the new page', async () => {
  const previous = { id: 'old', episodes: [{ ep: 1 }], episodesHasMore: true };
  const current = { id: 'new', episodes: [{ ep: 8 }] };
  let release;
  const harness = detailHarness({ getEpisodes: () => new Promise(resolve => { release = resolve; }) });
  harness.page.currentAnime = previous;
  harness.page.renderEpisodePage = () => assert.fail('stale list was rendered');
  const pending = harness.page.loadRemainingEpisodes(previous);
  await Promise.resolve();
  harness.page.loadId++;
  harness.page.currentAnime = current;
  release([{ ep: 1 }, { ep: 2 }]);
  await pending;
  assert.equal(current.episodes[0].ep, 8);
  assert.equal(previous.episodes.length, 1);
});
