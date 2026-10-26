const { networkFetch, networkErrorMessage } = require('./network');
const { matchTitle, searchTerms } = require('./title-matcher');

// Public collection interfaces documented by the providers. Creating an adapter performs no I/O.
const SOURCE_CONFIGS = Object.freeze([
  Object.freeze({ id: 'modu', name: '魔都动漫', apiUrl: 'https://www.mdzyapi.com/api.php/provide/vod/', siteUrl: 'https://mdzyapi.com/', enabled: true }),
  // Its catalogue is reachable, but both live acceptance examples returned media HTTP 404.
  Object.freeze({ id: 'baofeng', name: '暴风资源', apiUrl: 'https://bfzyapi.com/api.php/provide/vod/', siteUrl: 'https://bfzy.tv/', enabled: false }),
]);

function mediaUrl(value, base) {
  try {
    let text = String(value || '').trim().replace(/&amp;/g, '&');
    if (/^https?%3a/i.test(text)) text = decodeURIComponent(text);
    const url = new URL(text, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function episodeNumber(label, single) {
  const text = String(label || '').normalize('NFKC').trim();
  if (/^(?:第\s*|EP?\s*)?\d+(?:\.\d+)?\s*[-~～至]\s*\d/i.test(text)) return null;
  // Use the displayed number, never an array index: specials and fractional episodes shift indexes.
  const match = text.match(/^(?:第\s*|EP?\s*)?(\d+(?:\.\d+)?)\s*(?:集|话|話|期)?(?:\s*[-:：]\s*.+)?$/i);
  if (match) return Number(match[1]);
  if (single && /^(?:正片|高清|超清|蓝光|HD|BD)(?:\s*[0-9]+[pP]?)?$/i.test(text)) return 1;
  return null;
}

function parsePlaylists(record, config) {
  const lines = String(record.vod_play_from || '').split('$$$');
  const groups = String(record.vod_play_url || '').split('$$$');
  const entries = [], seen = new Set();
  groups.forEach((group, index) => {
    const items = group.split('#').filter(Boolean);
    for (const item of items) {
      const separator = item.indexOf('$');
      if (separator < 0) continue;
      const label = item.slice(0, separator).trim();
      const episode = episodeNumber(label, items.length === 1);
      const url = mediaUrl(item.slice(separator + 1), config.apiUrl);
      if (episode === null || !url || !/\.(?:m3u8|mp4)(?:$|\/)/i.test(new URL(url).pathname)) continue;
      const key = episode + ':' + url;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ episode, label, url, sid: index + 1, source: config.id,
        name: config.name + (lines[index] ? ' · ' + lines[index] : ''),
        title: String(record.vod_name || ''), recordId: String(record.vod_id || '') });
    }
  });
  return entries;
}

function createJsonSource(config, { fetchImpl = networkFetch, requestTimeout = 4500, totalTimeout = 12000,
  catalogTimeout = 8500, concurrency = 2, now = Date.now } = {}) {
  if (!config?.id || !config.name || !mediaUrl(config.apiUrl)) throw new Error('播放来源配置无效');
  const cache = new Map(), pending = new Map(), queue = [];
  const limit = Math.max(1, Math.min(3, Number(concurrency) || 2));
  let active = 0;
  const abortError = () => Object.assign(new Error(config.name + '请求超时，请稍后重试'), { name: 'AbortError' });
  const message = error => error.name === 'AbortError' || /^来源|^播放/.test(error.message) ? error.message : networkErrorMessage(error);

  function memo(key, ttl, work, force = false) {
    if (pending.has(key)) return pending.get(key);
    const item = cache.get(key);
    if (!force && item && item.until > now()) return Promise.resolve(item.value);
    const task = Promise.resolve().then(work).then(value => {
      cache.set(key, { value, until: now() + (value?.error ? 5000 : ttl) });
      if (cache.size > 150) cache.delete(cache.keys().next().value);
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  function bounded(work, timeout) {
    const controller = new AbortController();
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(abortError()); }, timeout);
    });
    return Promise.race([Promise.resolve().then(() => work(controller.signal)), expired])
      .finally(() => { clearTimeout(timer); controller.abort(); });
  }

  function drain() {
    while (active < limit && queue.length) {
      const job = queue.shift();
      job.signal?.removeEventListener('abort', job.onAbort);
      if (job.signal?.aborted) { job.reject(abortError()); continue; }
      active++;
      Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => { active--; drain(); });
    }
  }

  function scheduled(signal, work) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const job = { signal, work, resolve, reject };
      job.onAbort = () => {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        reject(abortError());
      };
      signal?.addEventListener('abort', job.onAbort, { once: true });
      queue.push(job);
      drain();
    });
  }

  function request(url, kind, signal) {
    return scheduled(signal, () => bounded(async requestSignal => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      requestSignal.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted || requestSignal.aborted) controller.abort();
      try {
        const response = await fetchImpl(url, { signal: controller.signal, size: kind === 'json' ? 4 * 1024 * 1024 : 1024 * 1024,
          headers: { 'User-Agent': 'AniView/1.0', Accept: kind === 'json' ? 'application/json' : '*/*',
            ...(config.siteUrl ? { Referer: config.siteUrl } : {}), ...(kind === 'mp4' ? { Range: 'bytes=0-1023' } : {}) } });
        if (!response.ok) { response.body?.destroy?.(); throw new Error('来源 ' + config.name + ' 返回 HTTP ' + response.status); }
        if (kind === 'mp4') {
          const type = response.headers.get('content-type') || '';
          response.body?.destroy?.();
          if (!/video|octet-stream/i.test(type)) throw new Error('播放来源未返回视频');
          return true;
        }
        const data = kind === 'json' ? await response.json() : await response.text();
        if (kind === 'json' && (!Array.isArray(data?.list) || (data.code !== undefined && Number(data.code) !== 1))) {
          throw new Error('来源 ' + config.name + ' 返回了无效目录');
        }
        if (kind !== 'json' && !data.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) throw new Error('播放来源未返回有效视频清单');
        return data;
      } finally {
        signal?.removeEventListener('abort', cancel);
        requestSignal.removeEventListener('abort', cancel);
      }
    }, requestTimeout));
  }

  function api(params, signal, force) {
    const url = new URL(config.apiUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return memo('api:' + url.href, 5 * 60 * 1000, () => request(url.href, 'json', signal), force);
  }

  function catalog(title, force = false) {
    return memo('catalog:' + title, 5 * 60 * 1000, () => bounded(async signal => {
      let records = [];
      for (const term of searchTerms(title).slice(0, 3)) {
        if (signal.aborted) throw abortError();
        // Search responses normally include playlists with ac=detail; avoid one request per episode.
        for (let page = 1; page <= 2; page++) {
          const result = await api({ ac: 'detail', wd: term, pg: page }, signal, force);
          records.push(...result.list.filter(record => matchTitle(record.vod_name, title)));
          if (records.length || page >= (Number(result.pagecount) || 1)) break;
        }
        if (records.length) break;
      }
      records = [...new Map(records.map(record => [String(record.vod_id), record])).values()].slice(0, 4);
      if (!records.length) return { error: config.name + '未找到同季同名作品', source: config.id };
      const incomplete = records.filter(record => !record.vod_play_url && /^\d+$/.test(String(record.vod_id)));
      if (incomplete.length) {
        const details = await api({ ac: 'detail', ids: incomplete.map(record => record.vod_id).join(',') }, signal, force);
        const byId = new Map(details.list.filter(record => matchTitle(record.vod_name, title)).map(record => [String(record.vod_id), record]));
        records = records.map(record => record.vod_play_url ? record : byId.get(String(record.vod_id))).filter(Boolean);
      }
      const entries = records.flatMap(record => parsePlaylists(record, config));
      return entries.length ? { entries } : { error: config.name + '没有可识别的剧集播放地址', source: config.id };
    }, catalogTimeout).catch(error => ({ error: message(error), source: config.id })), force);
  }

  function verify(entry, signal, force) {
    return memo('verify:' + entry.url, 60000, async () => {
      if (/\.mp4(?:$|\?)/i.test(entry.url)) return request(entry.url, 'mp4', signal);
      const manifest = await request(entry.url, 'manifest', signal);
      if (/^#EXT-X-STREAM-INF:/m.test(manifest)) {
        const lines = manifest.split(/\r?\n/).map(line => line.trim());
        const index = lines.findIndex(line => line.startsWith('#EXT-X-STREAM-INF:'));
        const child = lines.slice(index + 1).find(line => line && !line.startsWith('#'));
        const childUrl = mediaUrl(child, entry.url);
        if (!child || !childUrl) throw new Error('播放来源的主清单没有有效线路');
        await request(childUrl, 'manifest', signal);
      }
      return true;
    }, force);
  }

  async function resolve(title, episode, all, options = {}) {
    if (typeof title !== 'string' || !title.trim() || !Number.isFinite(Number(episode)) || Number(episode) < 0) return { error: '动漫名称或集数无效', source: config.id };
    title = title.trim(); episode = Number(episode);
    const force = options.forceRefresh === true;
    const completed = [];
    return memo((all ? 'all:' : 'play:') + title + ':' + episode, 60000, () => bounded(async signal => {
      const found = await catalog(title, force);
      if (found.error) return found;
      if (signal.aborted) throw abortError();
      const entries = [...new Map(found.entries.filter(entry => entry.episode === episode).map(entry => [entry.url, entry])).values()].slice(0, 6);
      if (!entries.length) return { error: config.name + '尚未收录第' + episode + '集', source: config.id };
      return new Promise(resolveResult => {
        const sources = completed, errors = [];
        let next = 0, running = 0, done = false;
        const finish = () => {
          if (done) return;
          done = true;
          signal.removeEventListener('abort', aborted);
          resolveResult(sources.length ? { ...sources[0], allSources: sources } : { error: errors[0] || config.name + '暂无可用播放线路', source: config.id });
        };
        const aborted = () => { errors.push(config.name + '请求超时，请稍后重试'); finish(); };
        signal.addEventListener('abort', aborted, { once: true });
        const pump = () => {
          if (done || signal.aborted) return;
          if (next >= entries.length && !running) return finish();
          while (running < limit && next < entries.length && !done) {
            const entry = entries[next++]; running++;
            verify(entry, signal, force).then(() => {
              if (done || signal.aborted) return;
              sources.push(entry);
              if (!all) finish();
            }).catch(error => errors.push(message(error))).finally(() => { running--; pump(); });
          }
        };
        pump();
      });
    }, totalTimeout).catch(error => completed.length ? { ...completed[0], allSources: completed } : ({ error: message(error), source: config.id })), force);
  }

  return {
    id: config.id, name: config.name,
    getPlayUrl: (title, episode = 1, options) => resolve(title, episode, false, options),
    async getAllPlayUrls(title, episode = 1, options) {
      const result = await resolve(title, episode, true, options);
      return result.error ? result : { primary: result.url, sources: result.allSources };
    },
    async getSourceEpisodes(title, options = {}) {
      if (typeof title !== 'string' || !title.trim()) return { error: '动漫名称无效', source: config.id };
      const result = await catalog(title.trim(), options.forceRefresh === true);
      return result.error ? result : { episodes: [...new Set(result.entries.map(entry => entry.episode))].sort((a, b) => a - b), source: config.id, name: config.name };
    },
  };
}

function createJsonSources(options = {}) {
  return SOURCE_CONFIGS.filter(config => config.enabled).map(config => createJsonSource(config, options));
}

module.exports = { SOURCE_CONFIGS, createJsonSource, createJsonSources, _parsePlaylists: parsePlaylists };
