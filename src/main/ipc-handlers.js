const { app, ipcMain } = require('electron');
const api = require('./api');
const crawler = require('./sources');
const store = require('./store');

function registerIpcHandlers() {
  // 初始化存储
  try {
    store.initStore();
    api.initCache(app.getPath('userData'));
  } catch (err) {
    console.error('存储初始化失败:', err);
  }

  // Bangumi API
  ipcMain.handle('api:search', async (_event, keyword, options) => {
    return await api.search(keyword, options);
  });

  ipcMain.handle('api:search-category', async (_event, filters) => {
    return await api.searchByCategory(filters);
  });

  ipcMain.handle('api:detail', async (_event, id) => {
    return await api.getDetail(id);
  });

  ipcMain.handle('api:calendar', async () => {
    return await api.getCalendar();
  });

  ipcMain.handle('api:hot', async (_event, options) => {
    return await api.getHot(options);
  });

  ipcMain.handle('api:episodes', async (_event, subjectId) => {
    return await api.getEpisodes(subjectId);
  });

  // 爬虫
  ipcMain.handle('crawler:playUrl', async (_event, animeTitle, episode, options) => {
    return await crawler.getPlayUrl(animeTitle, episode, options);
  });

  ipcMain.handle('crawler:check-playable', async (_event, animeTitle) => {
    return await crawler.checkPlayable(animeTitle);
  });

  ipcMain.handle('crawler:all-sources', async (_event, animeTitle, episode, options) => {
    return await crawler.getAllPlayUrls(animeTitle, episode, options);
  });

  ipcMain.handle('crawler:source-episodes', async (_event, animeTitle, options) => {
    return await crawler.getSourceEpisodes(animeTitle, options);
  });

  // 收藏
  ipcMain.handle('store:getFavorites', async () => {
    return store.getFavorites();
  });

  ipcMain.handle('store:addFavorite', async (_event, anime) => {
    return await store.addFavorite(anime);
  });

  ipcMain.handle('store:removeFavorite', async (_event, id) => {
    return await store.removeFavorite(id);
  });

  ipcMain.handle('store:isFavorite', async (_event, id) => {
    return store.isFavorite(id);
  });

  // 搜索缓存
  ipcMain.handle('store:get-search-cache', async (_event, keyword) => {
    return store.getSearchCache(keyword);
  });

  ipcMain.handle('store:set-search-cache', async (_event, keyword, results) => {
    store.setSearchCache(keyword, results);
    return true;
  });

  // 历史
  ipcMain.handle('store:getHistory', async () => {
    return store.getHistory();
  });

  ipcMain.handle('store:addHistory', async (_event, record) => {
    return await store.addHistory(record);
  });

  ipcMain.handle('store:clearHistory', async () => {
    return await store.clearHistory();
  });
}

module.exports = { registerIpcHandlers };
