const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceService } = require('../src/main/sources');
const source = (name, methods = {}) => ({
  getPlayUrl: async () => ({ error: name + ' unavailable' }),
  getAllPlayUrls: async () => ({ error: name + ' unavailable' }),
  getSourceEpisodes: async () => ({ error: name + ' unavailable' }),
  ...methods,
});

test('first usable source wins without waiting for a hung provider', async () => {
  const service = createSourceService([
    source('hung', { getPlayUrl: () => new Promise(() => {}) }),
    source('missing'),
    source('alternate', { getPlayUrl: async () => ({ url: 'https://alternate/1.m3u8', source: 'alternate', sid: '1' }) }),
  ], { timeout: 30 });
  const result = await service.getPlayUrl('作品', 1);
  assert.equal(result.source, 'alternate');
  assert.equal(result.allSources[0].url, result.url);
});

test('alternate sources interleave independent providers and remove duplicate URLs', async () => {
  const service = createSourceService([
    source('a', { getAllPlayUrls: async () => ({ sources: [{url:'a1'},{url:'a2'},{url:'a3'}] }) }),
    source('b', { getAllPlayUrls: async () => ({ sources: [{url:'b1'},{url:'a1'}] }) }),
    source('c', { getAllPlayUrls: async () => { throw new Error('offline'); } }),
  ]);
  const result = await service.getAllPlayUrls('作品', 1);
  assert.deepEqual(result.sources.map(item => item.url), ['a1', 'b1', 'a2', 'a3']);
});

test('partial source directories retain available episodes even when another source fails', async () => {
  const service = createSourceService([
    source('a', { getSourceEpisodes: async () => ({episodes:[0,1,2],source:'a'}) }),
    source('b', { getSourceEpisodes: async () => ({episodes:[2,3],source:'b'}) }),
    source('c'),
  ]);
  assert.deepEqual(await service.getSourceEpisodes('作品'), {episodes:[0,1,2,3],source:'a、b',partial:true});
  assert.equal((await service.checkPlayable('作品')).playable, true);
});

test('every unavailable source yields a bounded error and refresh reaches every provider', async () => {
  const calls = [];
  const service = createSourceService([
    source('a', { getPlayUrl: async (...args) => { calls.push(args); throw new Error('offline'); } }),
    source('b', { getPlayUrl: async (...args) => { calls.push(args); return {error:'missing'}; } }),
  ]);
  const result = await service.getPlayUrl('作品 第三季', 2, {forceRefresh:true});
  assert.match(result.error, /多个播放来源/);
  assert.equal(result.url, undefined);
  assert.deepEqual(calls, [ ['作品 第三季',2,{forceRefresh:true}], ['作品 第三季',2,{forceRefresh:true}] ]);
});
