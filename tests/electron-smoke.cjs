// Opt-in live integration test: uses isolated data and never changes the user's favourites/history.
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const project = path.resolve(__dirname, '..');
const root = process.env.ANIVIEW_SMOKE_APP_PATH ? path.resolve(process.env.ANIVIEW_SMOKE_APP_PATH) : project;
const output = path.join(project, '.repair-verification');
fs.mkdirSync(output, { recursive: true });
const fresh = process.env.ANIVIEW_SMOKE_FRESH === '1';
const userData = fresh ? fs.mkdtempSync(path.join(output, 'system-network-')) : path.join(output, 'user-data');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const report = { appPath: root, freshProfile: fresh, inheritedProxyVariables: Object.keys(process.env).filter(key => /proxy$/i.test(key)), rendererErrors: [] };
let win;

async function evaluate(code) { return win.webContents.executeJavaScript(code, true); }
async function until(code, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evaluate(code);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for: ' + code);
}

app.whenReady().then(async () => {
  report.systemProxyActive = (await session.defaultSession.resolveProxy('https://api.bgm.tv')) !== 'DIRECT';
  require(path.join(root, 'src/main/ipc-handlers')).registerIpcHandlers();
  win = new BrowserWindow({ show: false, width: 1280, height: 900,
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3 && !message.includes('net::')) report.rendererErrors.push(message.slice(0, 500));
  });
  const started = Date.now();
  await win.loadFile(path.join(root, 'src/renderer/index.html'));
  await until("document.querySelectorAll('#hot-grid .anime-card').length >= 20");
  report.firstHotMs = Date.now() - started;
  await until("['calendar','hot','new','top'].every(id => HomePage.sections[id] && !HomePage.sections[id].loading)");
  report.home = await evaluate("Object.fromEntries(['calendar','hot','new','top'].map(id => [id, {count: HomePage.sections[id].ids.size, error: HomePage.sections[id].error}]))");
  assert.equal(report.home.hot.count, 20);
  assert.equal(report.home.hot.error, false);
  await evaluate("HomePage.loadSection('hot', true)");
  report.hotAfterMore = await evaluate("document.querySelectorAll('#hot-grid .anime-card').length");
  assert.equal(report.hotAfterMore, 40);
  fs.writeFileSync(path.join(output, fresh ? 'system-network-home.png' : 'home.png'), (await win.webContents.capturePage()).toPNG());
  const cachedAt = Date.now();
  await evaluate('HomePage.loadData()');
  report.cachedHomeMs = Date.now() - cachedAt;

  await evaluate("Router.navigate('category')");
  await until('CategoryPage.state && !CategoryPage.state.loading').catch(async () => {
    await until("document.querySelectorAll('#category-grid .anime-card').length > 0");
  });
  await evaluate("CategoryPage.filters = {year:'2024',type:'movie',sort:'score'}; CategoryPage.doSearch()");
  report.category = await evaluate("({count:document.querySelectorAll('#category-grid .anime-card').length, text:document.querySelector('#category-grid').textContent.slice(0,180)})");
  assert.equal(report.category.count, 20);

  await evaluate("Router.navigate('home'); HomePage.doSearch('葬送的芙莉莲')");
  const selected = await evaluate("[...document.querySelectorAll('#search-results-grid .anime-card')].find(card => card.querySelector('.card-title').textContent === '葬送的芙莉莲')?.dataset.id");
  assert.ok(selected, 'Exact search result is visible');
  await evaluate(`Router.navigate('detail', {id:${JSON.stringify(selected)}})`);
  await until("DetailPage.currentAnime && document.querySelectorAll('#episodes-grid .episode-item').length > 0");
  report.detail = await evaluate("({title:DetailPage.currentAnime.titleCn, episodes:DetailPage.currentAnime.episodes.length, score:DetailPage.currentAnime.score})");
  const playbackStarted = Date.now();
  await evaluate("DetailPage.playEpisode(DetailPage.currentAnime,1,'')");
  try {
    await until("document.querySelector('#video-player')?.currentTime > 1", 60000);
    report.playback = await evaluate("({currentTime:document.querySelector('#video-player').currentTime, videoWidth:document.querySelector('#video-player').videoWidth, duration:document.querySelector('#video-player').duration, sid:PlayerPage.sources[PlayerPage.sourceIndex]?.sid})");
    report.playback.ms = Date.now() - playbackStarted;
  } catch (error) {
    report.playback = await evaluate("({error:document.querySelector('#player-error .error-msg')?.textContent, loading:document.querySelector('#player-loading')?.textContent, readyState:document.querySelector('#video-player')?.readyState, hls:!!PlayerPage.hls})");
    throw error;
  }
  await evaluate("Router.navigate('home')");
  assert.equal(await evaluate("PlayerPage.hls === null && document.querySelector('#video-player').paused"), true);
  const longStarted = Date.now();
  await evaluate("Router.navigate('detail', {id:'975'})");
  await until("DetailPage.currentAnime?.id === '975' && document.querySelectorAll('#episodes-grid .episode-item').length > 0");
  report.longDetail = await evaluate("({loaded:DetailPage.currentAnime.episodes.length,total:DetailPage.currentAnime.episodesTotal,hasMore:DetailPage.currentAnime.episodesHasMore})");
  report.longDetail.firstRenderMs = Date.now() - longStarted;
  await until("DetailPage.currentAnime?.id === '975' && (!DetailPage.currentAnime.episodesHasMore || !!DetailPage.currentAnime.episodesError)", 45000);
  const backgroundError = await evaluate('DetailPage.currentAnime.episodesError');
  if (backgroundError) {
    report.longDetail.retriedAfter = backgroundError;
    assert.ok(await evaluate("document.querySelectorAll('#episodes-grid .episode-item').length > 0"), 'A slow page must preserve visible episodes');
    await evaluate('DetailPage.loadRemainingEpisodes(DetailPage.currentAnime)');
  }
  await until("DetailPage.currentAnime?.id === '975' && !DetailPage.currentAnime.episodesHasMore && DetailPage.currentAnime.episodes.length > 200", 15000);
  report.longDetail.completedEpisodes = await evaluate('DetailPage.currentAnime.episodes.length');
  assert.equal(report.longDetail.completedEpisodes, report.longDetail.total);
  report.passed = true;
}).catch(error => {
  report.passed = false;
  report.failure = error.stack;
}).finally(() => {
  const reportName = (fresh ? 'system-network-' : '') + (process.env.ANIVIEW_SMOKE_APP_PATH ? 'packaged-smoke.json' : 'live-smoke.json');
  fs.writeFileSync(path.join(output, reportName), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  win?.destroy();
  app.exit(report.passed ? 0 : 1);
});
