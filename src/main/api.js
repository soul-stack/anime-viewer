const { networkFetch, networkErrorMessage } = require('./network');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://api.bgm.tv';
const ALIAS_MAP = {
  '药屋少女': ['药屋少女的呢喃', '薬屋のひとりごと'],
  '海贼王': ['航海王', 'ONE PIECE'],
  '死神': ['BLEACH'],
  '进击的巨人': ['進撃の巨人'],
  '鬼灭之刃': ['鬼滅の刃'],
  '间谍过家家': ['SPY×FAMILY'],
  '葬送的芙莉莲': ['葬送のフリーレン'],
  '命运石之门': ['STEINS;GATE'],
};

function createApi({ fetchImpl = networkFetch, requestTimeoutMs = 10000,
  requestIntervalMs = 250, cacheTtlMs = 30 * 60 * 1000, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  const searchTerms = new Map();
  const maxStaleMs = 7 * 24 * 60 * 60 * 1000;
  let nextRequestAt = 0;
  let cachePath;
  let saveTimer;

  function initCache(directory) {
    cachePath = path.join(directory, 'catalog-cache-v2.json');
    try {
      const saved = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      for (const entry of saved.entries || []) {
        if (typeof entry.key === 'string' && entry.data &&
            Number.isFinite(entry.at) && now() - entry.at < maxStaleMs) {
          cache.set(entry.key, { data: entry.data, at: entry.at });
        }
      }
    } catch { /* A missing or corrupt cache never prevents startup. */ }
  }

  function scheduleSave() {
    if (!cachePath || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const entries = [...cache].slice(-150).map(([key, value]) => ({ key, ...value }));
      try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath + '.tmp', JSON.stringify({ entries }), 'utf8');
        fs.renameSync(cachePath + '.tmp', cachePath);
      } catch (error) { console.warn('[API] 缓存保存失败:', error.message); }
    }, 100);
    saveTimer.unref?.();
  }

  async function fetchJson(endpoint, body) {
    // Reserve a start time before yielding so parallel requests stay spaced apart.
    const waitMs = Math.max(0, nextRequestAt - now());
    nextRequestAt = now() + waitMs + requestIntervalMs;
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(BASE_URL + endpoint, {
        method: body ? 'POST' : 'GET',
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal, timeout: requestTimeoutMs,
        headers: {
          'User-Agent': 'AniView/1.0.1 (Windows desktop; https://github.com/bangumi/api)',
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
      if (!response.ok) {
        response.body?.destroy?.();
        const reason = response.status === 429 ? '请求过于频繁，请稍后重试' : `HTTP ${response.status}`;
        throw new Error(`动漫数据服务返回 ${reason}`);
      }
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted || error.type === 'request-timeout') {
        throw new Error('动漫数据请求超时，请检查网络或代理后重试');
      }
      if (/^动漫数据/.test(error.message)) throw error;
      throw new Error(networkErrorMessage(error));
    } finally { clearTimeout(timer); }
  }

  function refresh(key, endpoint, body, validate) {
    if (pending.has(key)) return pending.get(key);
    const task = fetchJson(endpoint, body).then(data => {
      if (!validate(data)) throw new Error('动漫数据服务返回了无效数据，请重试');
      cache.delete(key);
      cache.set(key, { data, at: now() });
      while (cache.size > 150) cache.delete(cache.keys().next().value);
      scheduleSave();
      return data;
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  function request(endpoint, body, validate = data => data && typeof data === 'object') {
    const key = endpoint + (body ? JSON.stringify(body) : '');
    const entry = cache.get(key);
    if (entry && now() - entry.at < maxStaleMs && validate(entry.data)) {
      if (now() - entry.at >= cacheTtlMs) {
        // Render a previous successful catalogue immediately; refresh in the background.
        refresh(key, endpoint, body, validate).catch(error => console.warn('[API]', error.message));
      }
      return Promise.resolve(entry.data);
    }
    return refresh(key, endpoint, body, validate);
  }

  function pagination(options = {}) {
    const page = Math.max(1, Math.floor(Number(options.page) || 1));
    // The live search service clamps limit to 20; matching its limit avoids skipped offsets.
    const limit = Math.max(1, Math.min(20, Math.floor(Number(options.limit) || 20)));
    return { page, limit, offset: (page - 1) * limit };
  }

  async function searchPage(keyword, filter, sort, options) {
    const { page, limit, offset } = pagination(options);
    const data = await request(`/v0/search/subjects?limit=${limit}&offset=${offset}`, {
      keyword, sort, filter,
    }, result => Array.isArray(result?.data));
    return toPage(data, page, limit, offset);
  }

  function toPage(data, page, limit, offset) {
    const items = data.data.filter(item => item && item.id && (!item.type || item.type === 2)).map(parseItem);
    const total = Number.isFinite(data.total) ? data.total : offset + data.data.length;
    return { items, total, page, limit,
      hasMore: Number.isFinite(data.total) ? offset + data.data.length < total : data.data.length === limit };
  }

  async function search(keyword, options) {
    keyword = String(keyword || '').trim();
    const paged = options && typeof options === 'object';
    const config = paged ? options : { page: Number(options) || 1 };
    if (!keyword) {
      const { page, limit } = pagination(config);
      return paged ? { items: [], total: 0, hasMore: false, page, limit } : [];
    }
    let effective = searchTerms.get(keyword) || keyword;
    let result = await searchPage(effective, { type: [2] }, 'match', config);
    // Only search aliases after an empty first page; never split an anime title into words.
    if (!result.items.length && result.page === 1 && effective === keyword) {
      for (const alias of ALIAS_MAP[keyword] || []) {
        result = await searchPage(alias, { type: [2] }, 'match', config);
        if (result.items.length) { effective = alias; break; }
      }
    }
    if (result.items.length) searchTerms.set(keyword, effective);
    return paged ? result : result.items;
  }

  async function searchByCategory(options = {}) {
    const filter = { type: [2] };
    const platform = { tv: 'TV', movie: '剧场版', ova: 'OVA', web: 'WEB' }[options.type];
    if (platform) filter.meta_tags = [platform];
    const year = Number(options.year);
    if (year >= 1900 && year <= 2200 && Number.isInteger(year)) {
      filter.air_date = [`>=${year}-01-01`, `<${year + 1}-01-01`];
    }
    let result;
    if (options.sort === 'date') {
      const { page, limit, offset } = pagination(options);
      const params = new URLSearchParams({ type: '2', sort: 'date', limit, offset });
      const cat = { tv: 1, ova: 2, movie: 3, web: 5 }[options.type];
      if (cat) params.set('cat', cat);
      if (year >= 1900 && year <= 2200 && Number.isInteger(year)) params.set('year', year);
      const data = await request(`/v0/subjects?${params}`, undefined, data => Array.isArray(data?.data));
      result = toPage(data, page, limit, offset);
    } else {
      const sort = ['heat', 'rank', 'score', 'match'].includes(options.sort) ? options.sort : 'heat';
      result = await searchPage('', filter, sort, options);
    }
    return options.page !== undefined || options.limit !== undefined ? result : result.items;
  }

  async function getHot(options) {
    const result = await searchPage('', { type: [2] }, 'heat', options || {});
    return options && typeof options === 'object' ? result : result.items;
  }

  async function getCalendar() {
    const data = await request('/calendar', undefined, Array.isArray);
    const seen = new Set();
    return data.flatMap(day => (day.items || []).filter(item => {
      if (!item.id || seen.has(item.id) || (item.type && item.type !== 2)) return false;
      seen.add(item.id);
      return true;
    }).map(item => ({ ...parseItem(item), airWeekday: day.weekday?.cn || '',
      doingCount: item.collection?.doing || 0 })));
  }

  function subjectId(id) {
    const value = String(id);
    if (!/^\d+$/.test(value)) throw new Error('无效的动漫编号');
    return value;
  }

  async function episodePage(id, offset) {
    return request(`/v0/episodes?subject_id=${id}&type=0&limit=200&offset=${offset}`,
      undefined, data => Array.isArray(data?.data));
  }

  async function getEpisodes(id) {
    id = subjectId(id);
    const first = await episodePage(id, 0);
    const raw = [...first.data];
    const total = Math.max(raw.length, Number(first.total) || raw.length);
    // Fetch all episodes of long-running series, with at most three pages in parallel.
    for (let offset = 200; offset < total; offset += 600) {
      const offsets = [offset, offset + 200, offset + 400].filter(value => value < total);
      const pages = await Promise.all(offsets.map(value => episodePage(id, value)));
      pages.forEach(page => raw.push(...page.data));
    }
    return parseEpisodes(raw);
  }

  async function getDetail(id) {
    id = subjectId(id);
    const [subject, episodeResult] = await Promise.allSettled([
      request(`/v0/subjects/${id}`, undefined, item => item && item.id && item.type === 2),
      episodePage(id, 0),
    ]);
    if (subject.status === 'rejected') throw subject.reason;
    const item = subject.value;
    const episodeData = episodeResult.status === 'fulfilled' ? episodeResult.value : null;
    const episodes = episodeData ? parseEpisodes(episodeData.data) : [];
    const episodesTotal = Number(episodeData?.total) || episodes.length;
    return { ...parseItem(item),
      coverLarge: item.images?.large || item.images?.common || '',
      summary: item.summary || '', platform: item.platform || '',
      tags: (item.tags || []).slice(0, 8).map(tag => tag.name),
      totalEpisodes: item.total_episodes || item.eps || episodes.length,
      episodesTotal,
      episodesHasMore: episodesTotal > episodes.length,
      episodesError: episodeResult.status === 'rejected' ? episodeResult.reason.message : '',
      episodes,
    };
  }

  return { initCache, search, getHot, searchByCategory, getCalendar, getDetail, getEpisodes };
}

function parseEpisodes(raw) {
  const seen = new Set();
  return raw.filter(ep => {
    if (seen.has(ep.id)) return false;
    seen.add(ep.id);
    return true;
  }).map(ep => ({ id: ep.id, name: ep.name || '', nameCn: ep.name_cn || '',
    ep: episodeNumber(ep), airdate: ep.airdate || '' })).sort((a, b) => a.ep - b.ep);
}

function episodeNumber(episode) {
  // Bangumi's sort is the broadcast number; ep may instead be an ordinal that
  // shifts every episode when a series starts at episode 0 or has fractional specials.
  for (const value of [episode.sort, episode.ep]) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function parseItem(item) {
  const images = item.images || {};
  return {
    id: String(item.id), title: item.name || '', titleCn: item.name_cn || '',
    cover: images.common || images.medium || images.small || '',
    score: Number(item.rating?.score ?? item.score) || 0,
    rank: Number(item.rating?.rank ?? item.rank) || 0,
    summary: (item.summary || '').slice(0, 120),
    airDate: item.date || item.air_date || '', platform: item.platform || '',
  };
}

module.exports = { ...createApi(), createApi };
