const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A small DOM adapter lets these regressions run without Electron or a network.
function harness(api = {}) {
  const elements = new Map();
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag;
      this.children = [];
      this.style = {};
      this.events = {};
      this.dataset = {};
      this.classList = { add() {}, remove() {} };
    }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    set innerHTML(value) {
      this.markup = value;
      this.children = [];
      for (const match of value.matchAll(/id="([^"]+)"/g)) {
        const element = new Element();
        element.id = match[1];
      }
    }
    get innerHTML() { return this.markup || ''; }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(name, callback) { this.events[name] = callback; }
    setAttribute(name, value) { this[name] = value; }
    querySelectorAll() { return []; }
  }
  for (const id of ['page-home', 'page-category']) {
    const element = new Element();
    element.id = id;
  }
  let forbiddenCalls = 0;
  const forbidden = () => { forbiddenCalls++; throw new Error('Rendering must not request playback sources or legacy search caches'); };
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), createElement: tag => new Element(tag), querySelectorAll: () => [] },
    window: { api: { getCalendar: async () => [], getHot: async () => [], getHistory: async () => [], searchCategory: async () => [], checkPlayable: forbidden, getSearchCache: forbidden, setSearchCache: forbidden, ...api } },
    createSearchBar: () => new Element(),
    createAnimeCard: anime => Object.assign(new Element(), { anime }),
    Router: { navigate() {} },
    setInterval: () => 1,
    clearInterval() {},
  });
  for (const filename of ['home.js', 'category.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/js/pages', filename), 'utf8'), context, { filename });
  }
  const home = vm.runInContext('HomePage', context);
  const category = vm.runInContext('CategoryPage', context);
  home.container = elements.get('page-home');
  home.render();
  home.setupBanner = items => { home.bannerData = items; };
  category.init();
  category.render();
  return { home, category, elements, context, forbiddenCalls: () => forbiddenCalls };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const result = (ids, hasMore = false, total = ids.length) => ({ items: ids.map(id => ({ id, title: `Anime ${id}` })), hasMore, total });
const cardIds = (elements, id) => elements.get(id).children.filter(child => child.anime).map(child => child.anime.id);
const tick = () => new Promise(resolve => setImmediate(resolve));

test('home renders ready sections while slow sections remain pending, without availability checks', async () => {
  const hot = deferred();
  const top = deferred();
  const categories = [];
  const { home, elements, forbiddenCalls } = harness({
    getCalendar: async () => result([1, 2]).items,
    getHot: () => hot.promise,
    searchCategory: filters => {
      categories.push(filters);
      return filters.sort === 'score' ? top.promise : Promise.resolve(result([3]));
    },
  });
  const loading = home.loadData();
  await tick();
  assert.deepEqual(cardIds(elements, 'calendar-scroll'), [1, 2]);
  assert.deepEqual(cardIds(elements, 'new-grid'), [3]);
  assert.equal(elements.get('hot-skeleton').style.display, 'flex');
  assert.equal(categories.find(filters => filters.sort === 'heat').year, String(new Date().getFullYear()));
  hot.resolve(result(Array.from({ length: 20 }, (_, i) => i + 10), true, 100));
  top.resolve(result([5]));
  await loading;
  assert.equal(cardIds(elements, 'hot-grid').length, 20);
  assert.deepEqual(cardIds(elements, 'top-grid'), [5]);
  assert.equal(home.sections.hot.hasMore, true);
  assert.equal(forbiddenCalls(), 0);
});

test('search immediately renders catalogue order and appends pages without duplicates', async () => {
  const requests = [];
  const { home, elements, forbiddenCalls } = harness({ searchAnime: async (keyword, options) => {
    requests.push({ keyword, ...options });
    return options.page === 1 ? result([1, 2], true, 3) : result([2, 3], false, 3);
  } });
  await home.doSearch('test');
  assert.deepEqual(cardIds(elements, 'search-results-grid'), [1, 2]);
  await home.doSearch('test', true);
  assert.deepEqual(cardIds(elements, 'search-results-grid'), [1, 2, 3]);
  assert.deepEqual(requests, [{ keyword: 'test', page: 1, limit: 20 }, { keyword: 'test', page: 2, limit: 20 }]);
  assert.equal(home.searchState.hasMore, false);
  assert.equal(forbiddenCalls(), 0);
});

test('failed next search page preserves cards and retries the same page', async () => {
  let attempts = 0;
  const pages = [];
  const { home, elements } = harness({ searchAnime: async (_, options) => {
    pages.push(options.page);
    if (options.page === 1) return result([1], true, 2);
    if (++attempts === 1) throw new Error('timeout');
    return result([2], false, 2);
  } });
  await home.doSearch('test');
  await home.doSearch('test', true);
  assert.deepEqual(cardIds(elements, 'search-results-grid'), [1]);
  assert.equal(home.searchState.error, true);
  await elements.get('search-controls').children.find(child => child.tagName === 'button').events.click();
  assert.deepEqual(cardIds(elements, 'search-results-grid'), [1, 2]);
  assert.deepEqual(pages, [1, 2, 2]);
});

test('late search results and failures cannot overwrite a newer keyword', async () => {
  const old = deferred();
  const older = deferred();
  const { home, elements } = harness({ searchAnime: keyword => keyword === 'old' ? old.promise : keyword === 'older' ? older.promise : Promise.resolve(result([9])) });
  const first = home.doSearch('old');
  const second = home.doSearch('older');
  await home.doSearch('current');
  old.resolve(result([1]));
  older.reject(new Error('late timeout'));
  await Promise.all([first, second]);
  assert.deepEqual(cardIds(elements, 'search-results-grid'), [9]);
  assert.equal(home.searchState.keyword, 'current');
  assert.equal(home.searchState.error, false);
  assert.equal(home.searchState.errorMessage, '');
});

test('home error exposes retry and does not hide other catalogues', async () => {
  let attempts = 0;
  const { home, elements } = harness({ getHot: async () => {
    if (++attempts === 1) throw new Error('timeout');
    return result([7]);
  } });
  await home.loadData();
  assert.equal(elements.get('hot-skeleton').style.display, 'none');
  const message = elements.get('hot-grid').children[0];
  const button = message.children.find(child => child.tagName === 'button');
  assert.ok(button);
  await button.events.click();
  assert.deepEqual(cardIds(elements, 'hot-grid'), [7]);
});

test('category changes invalidate an in-flight previous filter and reset pagination', async () => {
  const old = deferred();
  const requests = [];
  const { category, elements } = harness({ searchCategory: filters => {
    requests.push({ ...filters });
    if (filters.year === '2020') return old.promise;
    return Promise.resolve(filters.page === 1 ? result([4], true, 2) : result([5], false, 2));
  } });
  category.filters.year = '2020';
  const first = category.doSearch();
  category.filters.year = '2026';
  category.filters.sort = 'score';
  await category.doSearch();
  await category.doSearch(true);
  old.resolve(result([1]));
  await first;
  assert.deepEqual(cardIds(elements, 'category-grid'), [4, 5]);
  assert.deepEqual(requests.map(request => [request.year, request.page]), [['2020', 1], ['2026', 1], ['2026', 2]]);
  assert.equal(requests[1].sort, 'score');
  assert.equal(category.state.hasMore, false);
});

test('year filter is dynamic, includes older years, and retains selected filters on revisit', () => {
  const { category, elements, context } = harness();
  const years = vm.runInContext('YEARS', context);
  assert.equal(years[0], String(new Date().getFullYear()));
  assert.ok(years.includes('1995'));
  assert.equal(category.filters.year, '');
  assert.equal(category.filters.type, '');
  category.filters = { year: '1995', type: 'movie', sort: 'score' };
  category.render();
  const markup = elements.get('page-category').innerHTML;
  assert.match(markup, /value="1995" selected/);
  assert.match(markup, /filter-chip active" data-value="movie"/);
  assert.match(markup, /filter-chip active" data-value="score"/);
});

test('catalogue error messages retain backend guidance but strip IPC wrappers and technical details', () => {
  const { context } = harness();
  const view = vm.runInContext('CatalogView', context);
  const guidance = '无法连接动漫目录，请确认网络或系统代理正常后重试';
  assert.equal(view.errorMessage(new Error(`Error invoking remote method 'api:search': Error: ${guidance}`)), guidance);
  assert.equal(view.errorMessage(new Error(`Error: ${guidance}\n    at request (D:\\app\\network.js:10:2)`)), guidance);
  for (const message of [
    'connect ECONNREFUSED 127.0.0.1:7897',
    '连接失败：127.0.0.1:7897',
    '连接失败：http://proxy.example:7897',
    '连接失败：proxy.example:7897',
    '连接失败：[::1]:7897',
    '连接失败：HTTP_PROXY=localhost:7897',
    '读取失败 D:\\app\\settings',
    '读取失败 /tmp/settings',
    '请求失败 at request (unknown)',
  ]) assert.equal(view.errorMessage(new Error(message), '请重试'), '请重试');
  assert.equal(view.errorMessage(null, '请重试'), '请重试');
});

test('initial home, search and category errors show concrete backend guidance as text', async () => {
  const guidance = '目录服务暂时不可用，请稍后重试 <b>提示</b>';
  const reject = async () => { throw new Error(`Error invoking remote method 'catalog': Error: ${guidance}`); };
  const { home, category, elements } = harness({ getHot: reject, searchAnime: reject, searchCategory: reject });
  await home.loadSection('hot');
  await home.doSearch('test');
  await category.doSearch();
  for (const id of ['hot-grid', 'search-results-grid', 'category-grid']) {
    const paragraph = elements.get(id).children[0].children[0];
    assert.equal(paragraph.textContent, guidance);
    assert.equal(paragraph.innerHTML, '');
  }
});

for (const kind of ['home', 'search', 'category']) {
  test(`${kind} pagination retains the specific failure and clears it when retry begins`, async () => {
    const retry = deferred();
    const guidance = '请求超时，请确认网络或系统代理正常后重试';
    let attempts = 0;
    const fetch = async options => {
      if (options.page === 1) return result([1], true, 2);
      if (++attempts === 1) throw new Error(`Error invoking remote method 'catalog': Error: ${guidance}`);
      return retry.promise;
    };
    const { home, category, elements } = harness({
      getHot: fetch,
      searchAnime: (_, options) => fetch(options),
      searchCategory: fetch,
    });
    const load = append => kind === 'home' ? home.loadSection('hot', append) : kind === 'search' ? home.doSearch('test', append) : category.doSearch(append);
    const state = () => kind === 'home' ? home.sections.hot : kind === 'search' ? home.searchState : category.state;
    const controlsId = kind === 'home' ? 'hot-controls' : `${kind}-controls`;
    const gridId = kind === 'home' ? 'hot-grid' : kind === 'search' ? 'search-results-grid' : 'category-grid';
    await load(false);
    await load(true);
    assert.equal(state().errorMessage, guidance);
    assert.ok(elements.get(controlsId).children.some(child => child.textContent === guidance));
    assert.deepEqual(cardIds(elements, gridId), [1]);
    const pending = load(true);
    assert.equal(state().errorMessage, '');
    assert.equal(elements.get(controlsId).children.some(child => child.textContent === guidance), false);
    retry.resolve(result([2], false, 2));
    await pending;
    assert.deepEqual(cardIds(elements, gridId), [1, 2]);
    assert.equal(state().error, false);
    assert.equal(state().errorMessage, '');
  });
}
