const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 窗口控制
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Bangumi API
  searchAnime: (keyword, options) => ipcRenderer.invoke('api:search', keyword, options),
  searchCategory: (filters) => ipcRenderer.invoke('api:search-category', filters),
  getDetail: (id) => ipcRenderer.invoke('api:detail', id),
  getCalendar: () => ipcRenderer.invoke('api:calendar'),
  getHot: (options) => ipcRenderer.invoke('api:hot', options),
  getEpisodes: (subjectId) => ipcRenderer.invoke('api:episodes', subjectId),

  // 爬虫
  getPlayUrl: (animeTitle, episode, options) => ipcRenderer.invoke('crawler:playUrl', animeTitle, episode, options),
  checkPlayable: (animeTitle) => ipcRenderer.invoke('crawler:check-playable', animeTitle),
  getAllSources: (animeTitle, episode, options) => ipcRenderer.invoke('crawler:all-sources', animeTitle, episode, options),
  getSourceEpisodes: (animeTitle, options) => ipcRenderer.invoke('crawler:source-episodes', animeTitle, options),

  // 收藏
  getFavorites: () => ipcRenderer.invoke('store:getFavorites'),
  addFavorite: (anime) => ipcRenderer.invoke('store:addFavorite', anime),
  removeFavorite: (id) => ipcRenderer.invoke('store:removeFavorite', id),
  isFavorite: (id) => ipcRenderer.invoke('store:isFavorite', id),

  // 搜索缓存
  getSearchCache: (keyword) => ipcRenderer.invoke('store:get-search-cache', keyword),
  setSearchCache: (keyword, results) => ipcRenderer.invoke('store:set-search-cache', keyword, results),

  // 历史
  getHistory: () => ipcRenderer.invoke('store:getHistory'),
  addHistory: (record) => ipcRenderer.invoke('store:addHistory', record),
  clearHistory: () => ipcRenderer.invoke('store:clearHistory'),
});
