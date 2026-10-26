const test = require('node:test');
const assert = require('node:assert/strict');
const { matchTitle, searchTerms } = require('../src/main/title-matcher');
const { _parseSearch: parseSearch, _createCrawler: createCrawler } = require('../src/main/crawler');

const TARGET = '无职转生 第二季 ～到了异世界就拿出真本事～';

test('season-two title matches provider Roman and abbreviated season names', () => {
  for (const candidate of [
    '无职转生Ⅱ～到了异世界就拿出真本事～',
    '无职转生II到了异世界就拿出真本事',
    '无职转生第２季～到了异世界就拿出真本事～',
    '无职转生到了异世界就拿出真本事第二季',
    '无职转生第二季',
    '无职转生Ⅱ',
  ]) assert.equal(matchTitle(candidate, TARGET), true, candidate);
});

test('the reported third season matches III but cannot select season two or its Part2', () => {
  const target = '无职转生 第三季 ～到了异世界就拿出真本事～';
  for (const title of ['无职转生Ⅲ 到了异世界就拿出真本事', '无职转生到了异世界就拿出真本事第三季', '无职转生第三季']) {
    assert.equal(matchTitle(title, target), true, title);
  }
  for (const title of [TARGET, '无职转生Ⅱ～到了异世界就拿出真本事～', '无职转生Ⅱ到了异世界就拿出真本事Part2']) {
    assert.equal(matchTitle(title, target), false, title);
  }
});

test('different seasons and independently numbered second cours cannot match', () => {
  for (const candidate of [
    '无职转生',
    '无职转生第一季 ～到了异世界就拿出真本事～',
    '无职转生Ⅲ 到了异世界就拿出真本事',
    '无职转生到了异世界就拿出真本事第三季',
    '无职转生Ⅱ到了异世界就拿出真本事Part2',
    '无职转生 第二季 下半季',
    '无职转生 第二季 第2部分',
  ]) assert.equal(matchTitle(candidate, TARGET), false, candidate);
  assert.equal(matchTitle('无职转生Ⅱ到了异世界就拿出真本事Part2', TARGET + ' Part 2'), true);
});

test('the screenshot season-three title accepts observed season-three spellings only', () => {
  const third = '无职转生 第三季 ～到了异世界就拿出真本事～';
  for (const candidate of [
    '无职转生Ⅲ 到了异世界就拿出真本事',
    '无职转生Ⅲ到了异世界就拿出真本事',
    '无职转生Ⅲ～到了异世界就拿出真本事',
    '无职转生到了异世界就拿出真本事第三季',
    '无职转生Ⅲ 到了异世界就拿出真本事 第三季',
    '无职转生：到了异世界就拿出真本事 第三季',
  ]) assert.equal(matchTitle(candidate, third), true, candidate);
  assert.equal(matchTitle('无职转生Ⅱ～到了异世界就拿出真本事～', third), false);
  assert.equal(matchTitle('无职转生Ⅱ到了异世界就拿出真本事Part2', third), false);
});

test('films, OVAs, specials, recaps, commentary and trailers stay distinct from the series', () => {
  for (const suffix of ['剧场版', 'OVA', 'OAD', '特别篇', '总集篇', '[电影解说]', '预告', 'PV']) {
    assert.equal(matchTitle(TARGET + ' ' + suffix, TARGET), false, suffix);
    assert.equal(matchTitle(TARGET, TARGET + ' ' + suffix), false, suffix);
  }
});

test('subtitle relaxation keeps named story arcs and unnumbered adaptations distinct', () => {
  assert.equal(matchTitle('测试动漫 第二季 ～篇章甲～', '测试动漫 第二季 ～篇章乙～'), false);
  assert.equal(matchTitle('Fate/stay night', 'Fate/stay night: Unlimited Blade Works'), false);
  assert.equal(matchTitle('Re', 'Re:从零开始的异世界生活'), false);
  assert.equal(matchTitle('测试动漫续作', '测试动漫'), false);
  assert.equal(matchTitle('另一部动漫 第二季', TARGET), false);
  assert.equal(matchTitle('测试动漫 第二季 第三季', '测试动漫 第二季'), false);
});

test('English seasons and parts normalize independently without changing ordinary title words', () => {
  assert.equal(matchTitle('Attack on Titan II', 'Attack on Titan Season 2'), true);
  assert.equal(matchTitle('Attack on Titan 2nd Season', 'Attack on Titan S2'), true);
  assert.equal(matchTitle('Attack on Titan Season 2 Part 2', 'Attack on Titan Season 2'), false);
  assert.equal(matchTitle('VIVID STRIKE!', 'Vivid Strike'), true);
  assert.equal(matchTitle('KILL la KILL', 'kill la kill'), true);
});

test('search terms retain the original title and add one useful franchise query', () => {
  assert.deepEqual(searchTerms(TARGET), [TARGET, '无职转生']);
  assert.deepEqual(searchTerms('无职转生Ⅱ～到了异世界就拿出真本事～'), ['无职转生Ⅱ～到了异世界就拿出真本事～', '无职转生']);
  assert.deepEqual(searchTerms('孤独摇滚！'), ['孤独摇滚！']);
  assert.deepEqual(searchTerms(''), []);
});

test('broad search accepts the real season-two record while rejecting its part-two and season-three siblings', () => {
  const html = [
    ['559383', '无职转生Ⅲ 到了异世界就拿出真本事'],
    ['127993', '无职转生Ⅱ到了异世界就拿出真本事Part2'],
    ['89090', '无职转生Ⅱ～到了异世界就拿出真本事～'],
  ].map(([id, title]) => `<a href="/missjundy/${id}/" title="${title}">${title}</a>`).join('');
  assert.deepEqual(parseSearch(html, TARGET), [{ title: '无职转生Ⅱ～到了异世界就拿出真本事～', url: 'https://missjun.com/missjundy/89090/' }]);
});

test('the crawler falls back to a franchise query and resolves only the matched season episode', async () => {
  const calls = [];
  const crawler = createCrawler({ fetchImpl: async url => {
    calls.push(url);
    const parsed = new URL(url);
    let body;
    if (parsed.pathname === '/tag/') {
      body = parsed.searchParams.get('wd') === TARGET ? '<p>No records</p>' :
        '<a href="/missjundy/127993/" title="无职转生Ⅱ到了异世界就拿出真本事Part2"></a>' +
        '<a href="/missjundy/89090/" title="无职转生Ⅱ～到了异世界就拿出真本事～"></a>';
    } else if (parsed.pathname === '/missjundy/89090/') {
      body = '<a href="/missjunpy/89090-6-1/">第01集</a>';
    } else if (parsed.pathname === '/missjunpy/89090-6-1/') {
      body = 'var player_test = {"url":"https://media.example.test/correct-season.m3u8"}';
    } else if (parsed.hostname === 'media.example.test') body = '#EXTM3U\n#EXT-X-ENDLIST';
    else throw new Error('Wrong season or unnecessary URL requested: ' + url);
    return { ok: true, status: 200, headers: new Headers(), buffer: async () => Buffer.from(body) };
  } });
  const result = await crawler.getPlayUrl(TARGET, 1);
  assert.equal(result.url, 'https://media.example.test/correct-season.m3u8');
  assert.equal(result.sid, 6);
  assert.equal(calls.filter(url => url.includes('/tag/')).length, 2);
  assert.equal(calls.some(url => url.includes('/127993/')), false);
});
