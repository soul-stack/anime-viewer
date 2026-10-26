const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApi } = require('../src/main/api');

function subject(id, overrides = {}) {
  return {
    id, type: 2, name: `Anime ${id}`, name_cn: `动画 ${id}`,
    date: '2024-04-01', platform: 'TV',
    images: { common: `https://example.test/${id}.jpg` },
    rating: { score: 8.5, rank: 42 },
    ...overrides,
  };
}

function paged(data, total = data.length, limit = data.length, offset = 0) {
  return { data, total, limit, offset };
}

function harness(respond, overrides = {}) {
  const calls = [];
  const api = createApi({
    requestIntervalMs: 0,
    ...overrides,
    fetchImpl: async (url, options = {}) => {
      const call = {
        url: new URL(url), options,
        body: options.body ? JSON.parse(options.body) : undefined,
      };
      calls.push(call);
      const result = await respond(call, calls.length);
      return result?.httpResponse || { ok: true, status: 200, json: async () => result };
    },
  });
  return { api, calls };
}

test('hot listings request real pages and read the current nested rating fields', async () => {
  const { api, calls } = harness(() => paged([subject(21)], 100, 20, 20));
  const result = await api.getHot({ page: 2, limit: 20 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/v0/search/subjects');
  assert.equal(calls[0].url.searchParams.get('limit'), '20');
  assert.equal(calls[0].url.searchParams.get('offset'), '20');
  assert.equal(calls[0].body.sort, 'heat');
  assert.deepEqual(calls[0].body.filter.type, [2]);
  assert.equal(result.items[0].score, 8.5);
  assert.equal(result.items[0].rank, 42);
  assert.equal(result.total, 100);
  assert.equal(result.page, 2);
  assert.equal(result.limit, 20);
  assert.equal(result.hasMore, true);
});

test('page sizes above the live 20 item cap cannot skip anime between pages', async () => {
  const { api, calls } = harness(({ url }) => {
    const offset = Number(url.searchParams.get('offset'));
    // Reproduce the live API: requested values above 20 are silently capped to 20.
    const limit = Math.min(20, Number(url.searchParams.get('limit')));
    const items = Array.from({ length: limit }, (_, i) => subject(offset + i + 1));
    return paged(items, 100, limit, offset);
  });
  for (const load of [
    options => api.getHot(options),
    options => api.search('连续分页', options),
    options => api.searchByCategory({ ...options, sort: 'heat' }),
    options => api.searchByCategory({ ...options, sort: 'date' }),
  ]) {
    const first = await load({ page: 1, limit: 24 });
    const second = await load({ page: 2, limit: 24 });
    assert.equal(first.limit, 20);
    assert.equal(second.limit, 20);
    assert.equal(first.items.at(-1).id, '20');
    assert.equal(second.items[0].id, '21');
    assert.equal(calls.at(-1).url.searchParams.get('limit'), '20');
    assert.equal(calls.at(-1).url.searchParams.get('offset'), '20');
  }
});

test('a successful named search does not serially query aliases or individual words', async () => {
  const { api, calls } = harness(() => paged([subject(1)], 1, 20));
  const result = await api.search('进击的巨人', { page: 1, limit: 20 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.keyword, '进击的巨人');
  assert.deepEqual(calls[0].body.filter.type, [2]);
  assert.equal(result.items.length, 1);
  assert.equal(result.hasMore, false);

  await api.search('Spy x Family', { page: 1, limit: 20 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.keyword, 'Spy x Family');
});

test('the alias that finds results stays consistent on subsequent search pages', async () => {
  const { api, calls } = harness(({ body, url }) => {
    if (body.keyword === '进击的巨人') return paged([], 0, 2);
    const offset = Number(url.searchParams.get('offset'));
    return paged([subject(offset + 1), subject(offset + 2)], 6, 2, offset);
  });
  const first = await api.search('进击的巨人', { page: 1, limit: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(calls.length, 2);
  const successfulKeyword = calls[1].body.keyword;
  const second = await api.search('进击的巨人', { page: 2, limit: 2 });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].body.keyword, successfulKeyword);
  assert.equal(calls[2].url.searchParams.get('offset'), '2');
  assert.notEqual(second.items[0].id, first.items[0].id);
});

test('anime category filters use anime type, platform metadata, and a date interval', async () => {
  const { api, calls } = harness(() => paged([], 0, 20));
  for (const [type, tag] of [['tv', 'TV'], ['movie', '剧场版'], ['ova', 'OVA'], ['web', 'WEB']]) {
    await api.searchByCategory({ year: '2024', type, sort: 'heat', page: 1, limit: 20 });
    const request = calls.at(-1);
    assert.equal(request.url.pathname, '/v0/search/subjects');
    assert.equal(request.body.keyword, '');
    assert.deepEqual(request.body.filter.type, [2]);
    assert.deepEqual(request.body.filter.meta_tags, [tag]);
    assert.deepEqual(request.body.filter.air_date, ['>=2024-01-01', '<2025-01-01']);
  }
  await api.searchByCategory({ sort: 'score', page: 1, limit: 20 });
  assert.equal(calls.at(-1).body.sort, 'score');
  assert.deepEqual(calls.at(-1).body.filter.type, [2]);
  assert.equal(calls.at(-1).body.filter.air_date, undefined);
});

test('newest category listings use the supported browse API and category numbers', async () => {
  const { api, calls } = harness(() => paged([subject(2)], 73, 20, 20));
  await api.searchByCategory({ year: 2024, type: 'movie', sort: 'date', page: 2, limit: 20 });
  const request = calls[0];
  assert.equal(request.url.pathname, '/v0/subjects');
  for (const [key, value] of Object.entries({ type: '2', cat: '3', year: '2024', sort: 'date', limit: '20', offset: '20' })) {
    assert.equal(request.url.searchParams.get(key), value, key);
  }
});

test('concurrent duplicate loads share one request and use the cache until expiry', async () => {
  let finishRequest;
  let currentTime = 1000;
  const { api, calls } = harness(async (_call, count) => {
    if (count === 1) await new Promise(resolve => { finishRequest = resolve; });
    return paged([subject(count)], 1, 20);
  }, { now: () => currentTime, cacheTtlMs: 100 });

  const first = api.getHot({ page: 1, limit: 20 });
  const duplicate = api.getHot({ page: 1, limit: 20 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  finishRequest();
  assert.deepEqual(await first, await duplicate);
  await api.getHot({ page: 1, limit: 20 });
  assert.equal(calls.length, 1);
  currentTime += 101;
  await api.getHot({ page: 1, limit: 20 });
  assert.equal(calls.length, 2);
});

test('an expired catalogue remains immediately usable while a refresh is pending', async () => {
  let currentTime = 1000;
  let finishRefresh;
  const { api, calls } = harness(async (_call, count) => {
    if (count === 2) await new Promise(resolve => { finishRefresh = resolve; });
    return paged([subject(count)], 1, 20);
  }, { now: () => currentTime, cacheTtlMs: 100 });
  const first = await api.getHot({ page: 1, limit: 20 });
  currentTime += 101;
  const cached = await api.getHot({ page: 1, limit: 20 });
  assert.deepEqual(cached, first);
  assert.equal(calls.length, 2);
  finishRefresh();
  await new Promise(resolve => setImmediate(resolve));
  const refreshed = await api.getHot({ page: 1, limit: 20 });
  assert.equal(refreshed.items[0].id, '2');
  assert.equal(calls.length, 2);
});

test('a persisted catalogue loads after restart without another network request', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aniview-api-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^aniview-api-test-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const first = harness(() => paged([subject(123)], 1, 20));
  first.api.initCache(directory);
  const expected = await first.api.getHot({ page: 1, limit: 20 });
  await new Promise(resolve => setTimeout(resolve, 150));
  const second = harness(() => { throw new Error('Network should not be needed'); });
  second.api.initCache(directory);
  const restored = await second.api.getHot({ page: 1, limit: 20 });
  assert.deepEqual(restored, expected);
  assert.equal(second.calls.length, 0);
});

test('upstream errors are reported and can be retried instead of becoming empty cached results', async () => {
  const { api, calls } = harness((_call, count) => count === 1
    ? { httpResponse: { ok: false, status: 503, json: async () => ({ message: 'Unavailable' }) } }
    : paged([subject(1)], 1, 20));
  await assert.rejects(api.search('测试错误', { page: 1, limit: 20 }));
  const recovered = await api.search('测试错误', { page: 1, limit: 20 });
  assert.equal(calls.length, 2);
  assert.equal(recovered.items.length, 1);
});

test('malformed upstream data is rejected without poisoning the next catalogue load', async () => {
  const { api, calls } = harness((_call, count) => count === 1
    ? { error: 'Unexpected gateway response' }
    : paged([subject(1)], 1, 20));
  await assert.rejects(api.getHot({ page: 1, limit: 20 }));
  const recovered = await api.getHot({ page: 1, limit: 20 });
  assert.equal(recovered.items.length, 1);
  assert.equal(calls.length, 2);
});

test('stalled requests are aborted and surfaced as a useful timeout error', async () => {
  const { api, calls } = harness(({ options }) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }), { requestTimeoutMs: 20 });
  await assert.rejects(api.getHot({ page: 1, limit: 20 }), /超时/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.signal.aborted, true);
});

test('long running anime include episodes past the first 200', async () => {
  const { api, calls } = harness(({ url }) => {
    assert.equal(url.pathname, '/v0/episodes');
    assert.equal(url.searchParams.get('subject_id'), '123');
    assert.equal(url.searchParams.get('type'), '0');
    assert.equal(url.searchParams.get('limit'), '200');
    const offset = Number(url.searchParams.get('offset') || 0);
    const count = Math.min(200, 205 - offset);
    return paged(Array.from({ length: count }, (_, i) => ({ id: offset + i + 1, ep: offset + i + 1, sort: offset + i + 1, name: 'Episode' })), 205, 200, offset);
  });
  const episodes = await api.getEpisodes('123');
  assert.equal(calls.length, 2);
  assert.equal(episodes.length, 205);
  assert.equal(episodes.at(-1).ep, 205);
});

test('episode zero keeps its broadcast number and cannot shift the following episode labels', async () => {
  // Real subject 373247 begins with sort 0 / ep 1; sort 1 / ep 2 is episode one.
  const rawEpisodes = [
    { id: 2, name: '失意の魔術師', ep: 2, sort: 1 },
    { id: 1, name: '守護術師フィッツ', ep: 1, sort: 0 },
    { id: 3, name: '真夜中の森', ep: 3, sort: 2 },
  ];
  const { api } = harness(({ url }) => url.pathname.startsWith('/v0/episodes')
    ? paged(rawEpisodes)
    : subject(373247, { total_episodes: 3 }));
  const detail = await api.getDetail('373247');
  const expected = [[0, '守護術師フィッツ'], [1, '失意の魔術師'], [2, '真夜中の森']];
  assert.deepEqual(detail.episodes.map(episode => [episode.ep, episode.name]), expected);
  assert.deepEqual((await api.getEpisodes('373247')).map(episode => [episode.ep, episode.name]), expected);
});

test('broadcast episode numbers preserve fractions and fall back only when sort is unavailable or invalid', async () => {
  const fixtures = [
    { id: 1, sort: 12.5, ep: 13, expected: 12.5 },
    { id: 2, sort: '0', ep: 1, expected: 0 },
    { id: 3, sort: '2.5', ep: 3, expected: 2.5 },
    { id: 4, ep: 4, expected: 4 },
    { id: 5, sort: null, ep: 5, expected: 5 },
    { id: 6, sort: '', ep: '6.5', expected: 6.5 },
    { id: 7, sort: '   ', ep: 7, expected: 7 },
    { id: 8, sort: 'invalid', ep: 8, expected: 8 },
    { id: 9, sort: Infinity, ep: 9, expected: 9 },
    { id: 10, sort: true, ep: 10, expected: 10 },
    { id: 11, sort: NaN, ep: 0, expected: 0 },
    { id: 12, sort: null, ep: null, expected: 0 },
  ];
  const { api } = harness(() => paged(fixtures));
  const episodes = await api.getEpisodes('123');
  const byId = new Map(episodes.map(episode => [episode.id, episode.ep]));
  for (const fixture of fixtures) assert.equal(byId.get(fixture.id), fixture.expected, `episode ${fixture.id}`);
  assert.deepEqual(episodes.map(episode => episode.ep), [0, 0, 0, 2.5, 4, 5, 6.5, 7, 8, 9, 10, 12.5]);
});

test('long anime details load only the first episode page and full episodes reuse that page', async () => {
  const { api, calls } = harness(({ url }) => {
    if (url.pathname === '/v0/subjects/123') return subject(123, { total_episodes: 210 });
    assert.equal(url.pathname, '/v0/episodes');
    const offset = Number(url.searchParams.get('offset') || 0);
    const count = Math.min(200, 205 - offset);
    return paged(Array.from({ length: count }, (_, i) => ({
      id: offset + i + 1, ep: offset + i + 1, sort: offset + i + 1,
    })), 205, 200, offset);
  });

  const detail = await api.getDetail('123');
  assert.equal(detail.episodes.length, 200);
  assert.equal(detail.episodesHasMore, true);
  assert.equal(detail.episodesTotal, 205);
  assert.equal(detail.totalEpisodes, 210);
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(call => call.url.pathname === '/v0/episodes').length, 1);
  assert.equal(calls.find(call => call.url.pathname === '/v0/episodes').url.searchParams.get('offset'), '0');

  const episodes = await api.getEpisodes('123');
  assert.equal(episodes.length, 205);
  assert.equal(episodes.at(-1).ep, 205);
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).url.searchParams.get('offset'), '200');
});

test('details preserve ratings and return available metadata if the episode request fails', async () => {
  const { api } = harness(({ url }) => {
    if (url.pathname.startsWith('/v0/episodes')) throw new Error('Episode network unavailable');
    return subject(123, { total_episodes: 24, summary: 'Detail summary' });
  });
  const detail = await api.getDetail('123');
  assert.equal(detail.score, 8.5);
  assert.equal(detail.rank, 42);
  assert.equal(detail.totalEpisodes, 24);
  assert.deepEqual(detail.episodes, []);
  assert.ok(detail.episodesError);
});

test('legacy callers still receive arrays while paged callers receive pagination metadata', async () => {
  const { api } = harness(() => paged([subject(1)], 1, 20));
  assert.ok(Array.isArray(await api.getHot()));
  assert.ok(Array.isArray(await api.search('Legacy')));
  assert.ok(Array.isArray(await api.searchByCategory({ year: 2024 })));
  assert.ok(Array.isArray((await api.getHot({ page: 1, limit: 20 })).items));
});
