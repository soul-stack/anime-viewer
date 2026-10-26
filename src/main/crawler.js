const cheerio = require('cheerio');
const { networkFetch, networkErrorMessage } = require('./network');
const { matchTitle, searchTerms } = require('./title-matcher');

const ORIGIN = 'https://missjun.com';
const SOURCE = 'missjun';
const normalizeTitle = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu, '');

function parseSearch(html, keyword) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const results = [];
  $('a[href]').each((_, element) => {
    const anchor = $(element);
    let url;
    try { url = new URL(anchor.attr('href'), ORIGIN); } catch { return; }
    if (url.origin !== ORIGIN || !/^\/missjundy\/\d+\/?$/.test(url.pathname)) return;
    const title = (anchor.attr('title') || anchor.text()).trim();
    // Compare season/part/edition before accepting provider spelling or subtitle variants.
    if (!title || !matchTitle(title, keyword) || seen.has(url.href)) return;
    seen.add(url.href);
    results.push({ title, url: url.href });
  });
  return results;
}

function parseEpisodes(html, detailUrl) {
  const $ = cheerio.load(html);
  const id = new URL(detailUrl).pathname.match(/\/missjundy\/(\d+)/)?.[1];
  const entries = [];
  const seen = new Set();
  $('a[href]').each((_, element) => {
    const anchor = $(element);
    let url;
    try { url = new URL(anchor.attr('href'), ORIGIN); } catch { return; }
    const match = url.pathname.match(/^\/missjunpy\/(\d+)-(\d+)-(\d+)\/?$/);
    if (url.origin !== ORIGIN || !match || match[1] !== id || seen.has(url.href)) return;
    const label = anchor.text().trim();
    const number = label.match(/^(?:第\s*)?(\d+(?:\.\d+)?)\s*(?:集|话|話|期)?$/);
    const film = /^(?:HD|BD|正片|高清|超清|蓝光)/i.test(label);
    if (!number && !film) return; // Ignore the generic "play now"/"updated to" links.
    seen.add(url.href);
    entries.push({ episode: number ? Number(number[1]) : Number(match[3]), pageUrl: url.href, sid: Number(match[2]), source: SOURCE });
  });
  return entries;
}

// Find the JSON object's real end; a script may have no semicolon and nested objects.
function parsePlayer(html) {
  const match = /\b(?:var\s+)?player_[\w]+\s*=\s*\{/.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  let depth = 0, quote = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quote = false;
      continue;
    }
    if (char === '"') quote = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        const data = JSON.parse(html.slice(start, i + 1));
        let value = String(data.url || '');
        if (Number(data.encrypt) === 2) value = Buffer.from(value, 'base64').toString('utf8');
        if (Number(data.encrypt) === 1 || Number(data.encrypt) === 2) {
          value = value.replace(/%u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
          try { value = decodeURIComponent(value); } catch { return null; }
        }
        const url = new URL(value, ORIGIN);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        if (!/\.(m3u8|mp4)(?:$|\/)/i.test(url.pathname)) return null;
        return url.href;
      } catch { return null; }
    }
  }
  return null;
}

function createCrawler({ fetchImpl = networkFetch, requestTimeout = 4500, totalTimeout = 14000, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  const PAGE_TTL = 5 * 60 * 1000;
  const PLAY_TTL = 60 * 1000;

  function memo(key, ttl, work, force = false) {
    if (pending.has(key)) return pending.get(key);
    const item = cache.get(key);
    if (!force && item && item.expires > now()) return Promise.resolve(item.value);
    const task = Promise.resolve().then(work).then(value => {
      cache.set(key, { value, expires: now() + (value?.error ? 5000 : ttl) });
      if (cache.size > 300) cache.delete(cache.keys().next().value);
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  async function request(url, media = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        size: media ? 1024 * 1024 : 3 * 1024 * 1024,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
          'Accept': media ? '*/*' : 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': ORIGIN + '/',
          ...(media && /\.mp4(?:$|\?)/i.test(url) ? { Range: 'bytes=0-1023' } : {}),
        },
      });
      if (!response.ok) {
        response.body?.destroy?.();
        throw new Error('播放源站返回 HTTP ' + response.status);
      }
      if (media && /\.mp4(?:$|\?)/i.test(url)) {
        const type = response.headers.get('content-type') || '';
        response.body?.destroy?.();
        if (!/video|octet-stream/i.test(type)) throw new Error('播放源未返回视频');
        return true;
      }
      const buffer = await response.buffer();
      const charset = (response.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1] || 'utf-8';
      let text;
      try { text = new TextDecoder(charset).decode(buffer); } catch { text = buffer.toString('utf8'); }
      if (media && !text.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) throw new Error('播放源未返回有效视频清单');
      return media ? true : text;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('播放源站请求超时，请稍后重试');
      if (/^播放/.test(error.message)) throw error;
      throw new Error(networkErrorMessage(error));
    } finally { clearTimeout(timer); }
  }

  function page(url, force = false) { return memo('page:' + url, PAGE_TTL, () => request(url), force); }

  function catalog(title, force = false) {
    return memo('catalog:' + normalizeTitle(title), PAGE_TTL, async () => {
      let matches = [];
      for (const term of searchTerms(title)) {
        const html = await page(ORIGIN + '/tag/?wd=' + encodeURIComponent(term), force);
        matches = parseSearch(html, title);
        if (matches.length) break;
      }
      if (!matches.length) return { error: '当前播放源未找到同名动漫，请检查作品名称（不会自动播放其他季或解说）' };
      // Several catalogue records can have the same title. Merge their real playlists.
      const results = await Promise.allSettled(matches.slice(0, 3).map(async match => parseEpisodes(await page(match.url, force), match.url)));
      const entries = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      if (!entries.length) return { error: results.find(result => result.status === 'rejected')?.reason?.message || '当前播放源没有可识别的剧集目录' };
      return { title, entries };
    }, force);
  }

  async function resolveEntry(entry, force) {
    const url = parsePlayer(await page(entry.pageUrl, force));
    if (!url) throw new Error('播放页没有直接视频地址，当前客户端不支持此线路');
    // Some CDNs reject HEAD but serve GET. Validate a small manifest with the real method.
    await memo('media:' + url, PLAY_TTL, () => request(url, true), force);
    return { url, sid: entry.sid, source: SOURCE, pageUrl: entry.pageUrl };
  }

  async function resolve(title, episode, all, options = {}) {
    title = String(title || '').trim();
    episode = Number(episode);
    if (!title || !Number.isFinite(episode) || episode < 0) return { error: '动漫名称或集数无效' };
    const force = options.forceRefresh === true;
    return memo((all ? 'all:' : 'play:') + normalizeTitle(title) + ':' + episode, PLAY_TTL, () => new Promise(resolveResult => {
      let settled = false, stopped = false, active = 0, next = 0, entries = [];
      const sources = [], errors = [];
      const finish = value => {
        if (settled) return;
        settled = true;
        stopped = true;
        clearTimeout(timer);
        resolveResult(value);
      };
      const success = () => ({ url: sources[0].url, source: SOURCE, sid: sources[0].sid, allSources: sources.slice() });
      const timer = setTimeout(() => finish(sources.length ? success() : { error: '播放源加载超时，请重试或稍后再试' }), totalTimeout);
      const pump = () => {
        if (stopped) return;
        if (next >= entries.length && active === 0) {
          finish(sources.length ? success() : { error: '当前线路暂不可用：' + (errors[0] || '未找到直接视频地址') });
          return;
        }
        while (!stopped && active < 3 && next < entries.length) {
          const entry = entries[next++];
          active++;
          resolveEntry(entry, force).then(source => {
            if (stopped) return;
            if (!sources.some(item => item.url === source.url)) sources.push(source);
            if (!all) finish(success());
          }).catch(error => errors.push(error.message)).finally(() => { active--; pump(); });
        }
      };
      catalog(title, force).then(result => {
        if (stopped) return;
        if (result.error) return finish(result);
        entries = result.entries.filter(entry => entry.episode === episode).slice(0, 24);
        if (!entries.length) return finish({ error: '当前播放源尚未收录第' + episode + '集' });
        pump();
      }).catch(error => finish({ error: error.message }));
    }), force);
  }

  return {
    getPlayUrl: (title, episode = 1, options) => resolve(title, episode, false, options),
    async getAllPlayUrls(title, episode = 1, options) {
      const result = await resolve(title, episode, true, options);
      return result.error ? result : { primary: result.url, sources: result.allSources };
    },
    async getSourceEpisodes(title, options = {}) {
      try {
        const result = await catalog(String(title || '').trim(), options.forceRefresh === true);
        return result.error ? result : { episodes: [...new Set(result.entries.map(entry => entry.episode))].sort((a, b) => a - b), source: SOURCE };
      } catch (error) { return { error: error.message }; }
    },
    async checkPlayable(title) {
      const result = await this.getSourceEpisodes(title);
      return { playable: !result.error && result.episodes.length > 0, source: SOURCE, error: result.error };
    },
  };
}

module.exports = { ...createCrawler(), _createCrawler: createCrawler, _parseSearch: parseSearch, _parseEpisodes: parseEpisodes, _parsePlayer: parsePlayer };
