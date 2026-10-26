const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SEARCH_CACHE_TTL = 30 * 60 * 1000; // 30 分钟

const defaultData = {
  favorites: [],
  history: [],
  searchCache: [],
  settings: {
    lastPlayed: null,
    volume: 1.0,
  },
};

let dbPath;
let data;

function initStore() {
  const userDataPath = app.getPath('userData');
  dbPath = path.join(userDataPath, 'aniview-data.json');

  try {
    if (fs.existsSync(dbPath)) {
      data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
    } else {
      data = { ...defaultData };
    }
  } catch {
    data = { ...defaultData };
  }

  // 确保字段存在
  data.favorites = data.favorites || [];
  data.history = data.history || [];
  data.searchCache = data.searchCache || [];
  data.settings = { ...defaultData.settings, ...(data.settings || {}) };

  save();
  console.log('[Store] 数据库初始化完成:', dbPath);
}

function save() {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Store] 保存失败:', e.message);
  }
}

// ===== 收藏 =====

function getFavorites() {
  return data.favorites;
}

function addFavorite(anime) {
  const exists = data.favorites.some(f => f.id === anime.id);
  if (!exists) {
    data.favorites.unshift({
      id: anime.id,
      title: anime.title,
      titleCn: anime.titleCn || '',
      cover: anime.cover || '',
      score: anime.score || 0,
      addedAt: Date.now(),
    });
    save();
  }
  return !exists;
}

function removeFavorite(id) {
  const before = data.favorites.length;
  data.favorites = data.favorites.filter(f => f.id !== id);
  if (data.favorites.length < before) {
    save();
    return true;
  }
  return false;
}

function isFavorite(id) {
  return data.favorites.some(f => f.id === id);
}

// ===== 历史 =====

function getHistory() {
  return data.history;
}

function addHistory(record) {
  data.history = data.history.filter(
    h => !(h.animeId === record.animeId && h.episode === record.episode)
  );
  data.history.unshift({
    animeId: record.animeId,
    title: record.title,
    titleCn: record.titleCn || '',
    cover: record.cover || '',
    episode: record.episode,
    episodeName: record.episodeName || '',
    progress: record.progress || 0,
    duration: record.duration || 0,
    watchedAt: Date.now(),
  });
  if (data.history.length > 100) {
    data.history = data.history.slice(0, 100);
  }
  save();
}

function clearHistory() {
  data.history = [];
  save();
}

// ===== 设置 =====

function getSettings() {
  return data.settings;
}

function updateSettings(partial) {
  Object.assign(data.settings, partial);
  save();
}

// ===== 搜索缓存 =====

function getSearchCache(keyword) {
  const now = Date.now();
  const entry = (data.searchCache || []).find(c => c.keyword === keyword);
  if (entry && (now - entry.cachedAt) < SEARCH_CACHE_TTL) {
    return entry.results;
  }
  return null;
}

function setSearchCache(keyword, results) {
  data.searchCache = (data.searchCache || []).filter(c => c.keyword !== keyword);
  data.searchCache.push({ keyword, results, cachedAt: Date.now() });
  // 最多保留 50 条缓存
  if (data.searchCache.length > 50) {
    data.searchCache = data.searchCache.slice(-50);
  }
  save();
}

module.exports = {
  initStore,
  getFavorites, addFavorite, removeFavorite, isFavorite,
  getHistory, addHistory, clearHistory,
  getSettings, updateSettings,
  getSearchCache, setSearchCache,
};
