const test = require('node:test');
const assert = require('node:assert/strict');
const { Response } = require('node-fetch');
const { SOURCE_CONFIGS, createJsonSource, createJsonSources, _parsePlaylists: parsePlaylists } = require('../src/main/json-sources');

const config = { id: 'test-json', name: '测试来源', apiUrl: 'https://api.test/vod/', siteUrl: 'https://api.test/' };
const title = '无职转生 第三季 ～到了异世界就拿出真本事～';
const makeRecord = (extra = {}) => ({ vod_id: 85658, vod_name: '无职转生到了异世界就拿出真本事第三季', vod_year: '2026', vod_play_from: 'line-one', vod_play_url: '第01集$https://video.test/one.m3u8#第12集$https://video.test/twelve.m3u8', ...extra });
const json = list => new Response(JSON.stringify({ code: 1, list, pagecount: 1 }), { headers: { 'Content-Type': 'application/json' } });
function fetchFixture({ records = [makeRecord()], handle } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const override = handle?.(url, options);
    if (override !== undefined) return override;
    if (url.startsWith(config.apiUrl)) return json(records);
    if (url.startsWith('https://video.test/')) return new Response('#EXTM3U\n#EXTINF:5\nsegment.ts\n#EXT-X-ENDLIST');
    throw new Error('Unexpected test URL: ' + url);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('default adapters are lazy and enable only the live-verified public provider', () => {
  let calls = 0;
  const sources = createJsonSources({ fetchImpl: () => { calls++; throw new Error('unexpected request'); } });
  assert.deepEqual(sources.map(source => source.id), ['modu']);
  assert.equal(SOURCE_CONFIGS.find(source => source.id === 'baofeng').enabled, false);
  assert.equal(calls, 0);
});

test('parses MacCMS line separators and explicit zero/fractional episodes without counting specials', () => {
  const entries = parsePlaylists(makeRecord({ vod_play_from: 'first$$$second', vod_play_url:
    '第00集$https://video.test/zero.m3u8#第01集$https://video.test/one.m3u8#OVA$https://video.test/special.m3u8#第12.5集$https://video.test/extra.m3u8#第13-14集$https://video.test/double.m3u8$$$EP1$https://video.test/alternate.mp4?token=a$b' }), config);
  assert.deepEqual(entries.map(entry => [entry.episode, entry.sid]), [[0, 1], [1, 1], [12.5, 1], [1, 2]]);
  assert.equal(entries[3].url, 'https://video.test/alternate.mp4?token=a$b');
  assert.equal(entries[3].name, '测试来源 · second');
});

test('does not silently shift a thirteen-episode catalogue or accept executable/embedded URLs', () => {
  const entries = parsePlaylists(makeRecord({ vod_play_url: '第1集$javascript:alert(1)#第2集$https://video.test/player.html#第13集$https://video.test/thirteen.m3u8' }), config);
  assert.deepEqual(entries.map(entry => entry.episode), [13]);
  assert.equal(parsePlaylists(makeRecord({ vod_play_url: '正片$https://video.test/movie.mp4' }), config)[0].episode, 1);
});

test('broad query fallback retains the target title and rejects second season, Part 2 and commentaries', async () => {
  const records = [
    makeRecord({ vod_id: 5617, vod_name: '无职转生Ⅱ 到了异世界就拿出真本事', vod_play_url: '第1集$https://video.test/wrong-season.m3u8' }),
    makeRecord({ vod_id: 8117, vod_name: '无职转生Ⅱ ～到了异世界就拿出真本事～ 第2部分', vod_play_url: '第1集$https://video.test/wrong-part.m3u8' }),
    makeRecord({ vod_id: 99, vod_name: '无职转生 第三季 ～到了异世界就拿出真本事～[电影解说]', vod_play_url: '第1集$https://video.test/commentary.m3u8' }), makeRecord(),
  ];
  const fetchImpl = fetchFixture({ records, handle: url => new URL(url).searchParams.get('wd') === title ? json([]) : undefined });
  const result = await createJsonSource(config, { fetchImpl }).getPlayUrl(title, 1);
  assert.equal(result.recordId, '85658');
  assert.equal(result.url, 'https://video.test/one.m3u8');
  assert.deepEqual(fetchImpl.calls.filter(call => call.url.startsWith(config.apiUrl)).map(call => new URL(call.url).searchParams.get('wd')), [title, '无职转生']);
  assert.ok(fetchImpl.calls.every(call => !/wrong-|commentary/.test(call.url)));
});

test('catalogue, simultaneous playback and subsequent calls share requests; force refresh really refetches', async () => {
  const fetchImpl = fetchFixture();
  const source = createJsonSource(config, { fetchImpl });
  const [episodes, first, second] = await Promise.all([source.getSourceEpisodes(title), source.getPlayUrl(title, 1), source.getPlayUrl(title, 1)]);
  assert.deepEqual(episodes.episodes, [1, 12]);
  assert.equal(first.url, second.url);
  assert.equal(fetchImpl.calls.filter(call => call.url.startsWith(config.apiUrl)).length, 1);
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/one.m3u8')).length, 1);
  await source.getPlayUrl(title, 1);
  assert.equal(fetchImpl.calls.length, 2);
  await source.getPlayUrl(title, 1, { forceRefresh: true });
  assert.equal(fetchImpl.calls.length, 4);
});

test('retrieves missing detail fields in one request and rechecks returned identity', async () => {
  const fetchImpl = fetchFixture({ records: [makeRecord({ vod_play_url: undefined })], handle: url => {
    if (new URL(url).searchParams.has('ids')) return json([makeRecord({ vod_name: '无职转生Ⅱ 到了异世界就拿出真本事' })]);
  } });
  const result = await createJsonSource(config, { fetchImpl }).getPlayUrl(title, 1);
  assert.ok(result.error);
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls.every(call => call.url.startsWith(config.apiUrl)));
});

test('GET verifies the master and media playlist; HEAD is never used', async () => {
  const fetchImpl = fetchFixture({ handle: url => url === 'https://video.test/one.m3u8'
    ? new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nvariant/index.m3u8\n') : undefined });
  const result = await createJsonSource(config, { fetchImpl }).getPlayUrl(title, 1);
  assert.equal(result.url, 'https://video.test/one.m3u8');
  assert.ok(fetchImpl.calls.some(call => call.url === 'https://video.test/variant/index.m3u8'));
  assert.ok(fetchImpl.calls.every(call => call.options.method !== 'HEAD'));
});

test('HTML or HTTP errors cannot turn into playable sources', async () => {
  for (const response of [new Response('<html>blocked</html>'), new Response('not found', { status: 404 })]) {
    const fetchImpl = fetchFixture({ handle: url => url === 'https://video.test/one.m3u8' ? response : undefined });
    const result = await createJsonSource(config, { fetchImpl }).getPlayUrl(title, 1);
    assert.ok(result.error);
    assert.equal(result.url, undefined);
  }
});

test('first verified source wins without waiting for another line; all-sources retains successful lines', async () => {
  const record = makeRecord({ vod_play_from: 'slow$$$fast', vod_play_url: '第1集$https://video.test/slow.m3u8$$$第1集$https://video.test/fast.m3u8' });
  const fetchImpl = fetchFixture({ records: [record], handle: (url, { signal }) => {
    if (url.includes('/slow.m3u8')) return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
  } });
  const source = createJsonSource(config, { fetchImpl, requestTimeout: 30, totalTimeout: 80 });
  const first = await source.getPlayUrl(title, 1);
  assert.equal(first.url, 'https://video.test/fast.m3u8');
  const all = await source.getAllPlayUrls(title, 1);
  assert.equal(all.primary, 'https://video.test/fast.m3u8');
  assert.equal(all.sources.length, 1);
});

test('catalogue deadlines bound stalled fetches, and missing episodes never trigger guessed URLs', async () => {
  const stalled = createJsonSource(config, { fetchImpl: () => new Promise(() => {}), requestTimeout: 10, catalogTimeout: 20, totalTimeout: 30 });
  assert.match((await stalled.getPlayUrl(title, 1)).error, /超时/);
  const fetchImpl = fetchFixture();
  const absent = await createJsonSource(config, { fetchImpl }).getPlayUrl(title, 99);
  assert.match(absent.error, /尚未收录第99集/);
  assert.ok(fetchImpl.calls.every(call => call.url.startsWith(config.apiUrl)));
});

test('at most two network requests are active even for concurrent different titles', async () => {
  let active = 0, maximum = 0;
  const fetchImpl = async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 3));
    active--;
    return json([]);
  };
  const source = createJsonSource(config, { fetchImpl });
  await Promise.all(['动漫甲', '动漫乙', '动漫丙', '动漫丁'].map(value => source.getSourceEpisodes(value)));
  assert.equal(maximum, 2);
});
