// Query independent providers together: a failed or slow site must not block another site.
function createSourceService(providers, { timeout = 15000 } = {}) {
  function call(provider, method, args) {
    return new Promise(resolve => {
      let done = false;
      const finish = result => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(result || { error: '播放源没有返回结果' });
      };
      const timer = setTimeout(() => finish({ error: '播放源查询超时' }), timeout);
      Promise.resolve().then(() => provider[method](...args)).then(finish, error => finish({ error: error.message }));
    });
  }

  function uniqueSources(groups) {
    // Interleave providers so automatic failover tries an independent site promptly.
    const sources = [], seen = new Set();
    const length = Math.max(0, ...groups.map(group => group.length));
    for (let index = 0; index < length; index++) {
      for (const group of groups) {
        const source = group[index];
        if (!source?.url || seen.has(source.url)) continue;
        seen.add(source.url);
        sources.push(source);
      }
    }
    return sources;
  }

  function failure(results) {
    const errors = [...new Set(results.map(result => result?.error).filter(Boolean))];
    return { error: '已查询多个播放来源，暂未找到该作品本集的可用线路。' + (errors[0] || '请稍后重试或刷新播放源。') };
  }

  return {
    async getPlayUrl(title, episode = 1, options = {}) {
      if (!providers.length) return failure([]);
      return new Promise(resolve => {
        const results = [];
        for (const provider of providers) {
          call(provider, 'getPlayUrl', [title, episode, options]).then(result => {
            results.push(result);
            if (result.url && !result.error) {
              resolve({ ...result, allSources: uniqueSources(results.filter(item => !item.error).map(item => item.allSources || [item])) });
            } else if (results.length === providers.length) resolve(failure(results));
          });
        }
      });
    },

    async getAllPlayUrls(title, episode = 1, options = {}) {
      const results = await Promise.all(providers.map(provider => call(provider, 'getAllPlayUrls', [title, episode, options])));
      const sources = uniqueSources(results.map(result => result.error ? [] : result.sources || []));
      return sources.length ? { primary: sources[0].url, sources } : failure(results);
    },

    async getSourceEpisodes(title, options = {}) {
      const results = await Promise.all(providers.map(provider => call(provider, 'getSourceEpisodes', [title, options])));
      const good = results.filter(result => !result.error && Array.isArray(result.episodes) && result.episodes.length);
      if (!good.length) return failure(results);
      return {
        episodes: [...new Set(good.flatMap(result => result.episodes))].sort((a, b) => a - b),
        source: good.map(result => result.source).filter(Boolean).join('、'),
        partial: good.length < providers.length,
      };
    },

    async checkPlayable(title) {
      const result = await this.getSourceEpisodes(title);
      return { playable: !result.error && result.episodes.length > 0, source: result.source, error: result.error };
    },
  };
}

let defaultService;
function getDefaultService() {
  if (!defaultService) {
    const crawler = require('./crawler');
    const { createJsonSources } = require('./json-sources');
    defaultService = createSourceService([crawler, ...createJsonSources()]);
  }
  return defaultService;
}

module.exports = { createSourceService };
for (const method of ['getPlayUrl', 'getAllPlayUrls', 'getSourceEpisodes', 'checkPlayable']) {
  module.exports[method] = (...args) => getDefaultService()[method](...args);
}
