// Real Chromium layout checks with local fixtures: no network or personal data required.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const project = path.resolve(__dirname, '..');
const root = process.env.ANIVIEW_LAYOUT_APP_PATH || project;
const output = path.join(project, '.repair-verification', 'layout');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" fill="#33256d"/><circle cx="150" cy="160" r="90" fill="#6954ba"/><text x="150" y="315" text-anchor="middle" fill="white" font-size="30">AniView</text></svg>');
const episodes = Array.from({ length: 300 }, (_, index) => ({ id: index + 1, ep: index + 1, name: 'Episode ' + (index + 1), nameCn: '测试剧集 ' + (index + 1) }));
const anime = { id: '1', title: 'Layout verification', titleCn: '布局验证', cover, coverLarge: cover,
  score: 8.5, rank: 8, airDate: '2026-01-01', summary: '这是用于验证页面布局、固定返回栏和播放器适应窗口尺寸的本地测试内容。'.repeat(12),
  tags: ['TV', '布局验证'], totalEpisodes: episodes.length, episodesTotal: episodes.length, episodes };
const list = Array.from({ length: 40 }, (_, index) => ({ ...anime, id: String(index + 1) }));
const report = { appPath: root, cases: [], errors: [] };
let win;
const evaluate = code => win.webContents.executeJavaScript(code, true);
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 420));
  // Hidden-window Chromium can defer animation frames; inspect the settled layout.
  await evaluate('document.getAnimations().filter(a => Number.isFinite(a.effect.getTiming().iterations)).forEach(a => a.finish()); void 0;');
};

function registerFixtures() {
  const handlers = {
    'api:hot': () => ({ items: list, total: 40, hasMore: false }),
    'api:calendar': () => list,
    'api:search-category': () => ({ items: list, total: 40, hasMore: false }),
    'api:search': () => ({ items: list, total: 40, hasMore: false }),
    'api:detail': () => anime, 'api:episodes': () => episodes,
    'crawler:source-episodes': () => ({ episodes: episodes.map(ep => ep.ep), source: 'fixture' }),
    'store:getHistory': () => [], 'store:getFavorites': () => [], 'store:isFavorite': () => false,
    'store:addHistory': () => {}, 'store:addFavorite': () => true, 'store:removeFavorite': () => true,
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
}

const geometry = `(() => {
  const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}; };
  const content = document.querySelector('#content');
  return {viewport:{width:innerWidth,height:innerHeight},content:rect('#content'),titlebar:rect('#titlebar'),
    page:rect('#page-player'),video:rect('#video-player'),controls:rect('#player-controls'),progress:rect('#progress-wrap'),
    scrollTop:content.scrollTop,scrollHeight:content.scrollHeight,clientHeight:content.clientHeight,
    drawer:rect('#player-drawer'),drawerList:rect('#drawer-list'),
    videoWidth:document.querySelector('#video-player').videoWidth,fit:getComputedStyle(document.querySelector('#video-player')).objectFit};
})()`;

function checkPlayer(value, label, fullscreen = false) {
  const minY = fullscreen ? 0 : value.titlebar.bottom;
  assert.ok(value.controls.top >= minY - 1, label + ': controls top is visible');
  assert.ok(value.controls.bottom <= value.viewport.height + 1, label + ': controls bottom is visible');
  assert.ok(value.progress.height >= 12, label + ': progress track remains usable');
  assert.ok(value.video.top >= minY - 1 && value.video.bottom <= value.viewport.height + 1, label + ': video fits available height');
  assert.ok(value.video.left >= -1 && value.video.right <= value.viewport.width + 1, label + ': video fits available width');
  assert.equal(value.fit, 'contain');
  assert.ok(value.videoWidth > 0, label + ': actual video dimensions are available');
  if (!fullscreen) {
    assert.ok(value.scrollHeight <= value.clientHeight + 1, label + ': outer page cannot scroll');
    assert.equal(value.scrollTop, 0, label + ': previous scroll offset was reset');
  }
}

app.whenReady().then(async () => {
  registerFixtures();
  win = new BrowserWindow({ show: false, width: 1280, height: 800,
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  await win.loadFile(path.join(root, 'src/renderer/index.html'));
  await settle();
  await evaluate(`PlayerPage.resolveAndPlay = async function() {
    this.hideLoading();
    const video = document.getElementById('video-player');
    const canvas = document.createElement('canvas');
    canvas.width = 1920; canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0,0,1920,1080);
    gradient.addColorStop(0,'#33215f'); gradient.addColorStop(1,'#116377');
    ctx.fillStyle = gradient; ctx.fillRect(0,0,1920,1080);
    ctx.fillStyle = 'white'; ctx.font = '64px sans-serif';
    ctx.fillText('AniView · 16:9',120,180);
    ctx.font = '38px sans-serif'; ctx.fillText('播放器布局验证',120,260);
    ctx.strokeStyle = 'rgba(255,255,255,.4)';ctx.lineWidth=8;ctx.strokeRect(10,10,1900,1060);
    video.srcObject = canvas.captureStream(2);
    video.muted = true;
    await video.play();
    video.pause();
  }; void 0;`);

  for (const [width, height, zoom] of [[1280,800,1],[1000,650,1],[1536,864,1],[1920,1080,1],[1000,650,1.25]]) {
    win.setContentSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await settle();
    await evaluate("Router.navigate('home'); document.getElementById('content').scrollTop = 500;");
    assert.ok(await evaluate("document.getElementById('content').scrollTop > 0"));
    await evaluate("Router.navigate('detail',{id:'1'})");
    await settle();
    const detail = await evaluate(`(() => { const bar=document.getElementById('detail-topbar').getBoundingClientRect(); const cover=document.querySelector('.detail-cover').getBoundingClientRect(); return {barTop:bar.top,barBottom:bar.bottom,coverTop:cover.top,contentTop:document.getElementById('content').getBoundingClientRect().top,scrollTop:document.getElementById('content').scrollTop}; })()`);
    assert.equal(detail.scrollTop, 0, 'new detail starts at the top');
    report.currentDetail = detail;
    assert.ok(Math.abs(detail.barTop - detail.contentTop) <= 1, 'return bar begins at page top');
    assert.ok(detail.coverTop >= detail.barBottom - 1, 'return bar does not cross the cover at first paint');
    await evaluate("document.getElementById('content').scrollTop = 400;");
    await settle();
    const sticky = await evaluate("document.getElementById('detail-topbar').getBoundingClientRect().top");
    assert.ok(Math.abs(sticky - detail.contentTop) <= 1, 'return bar stays at top when scrolling');
    await evaluate("document.getElementById('content').scrollTop = 0;");
    await settle();
    if (width === 1280) fs.writeFileSync(path.join(output, 'detail-top.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate("document.getElementById('content').scrollTop = 450; DetailPage.playEpisode(DetailPage.currentAnime,1,'测试剧集')");
    await settle();
    const player = await evaluate(geometry);
    checkPlayer(player, `${width}x${height}@${zoom}`);
    await evaluate("document.getElementById('drawer-toggle').click()");
    await settle();
    const drawer = await evaluate(geometry);
    checkPlayer(drawer, `drawer ${width}x${height}@${zoom}`);
    assert.ok(drawer.drawerList.bottom <= drawer.viewport.height + 1, 'episode list stays in viewport');
    if (width === 1280) fs.writeFileSync(path.join(output, 'player-fit.png'), (await win.webContents.capturePage()).toPNG());
    if (width === 1000 && zoom === 1.25) fs.writeFileSync(path.join(output, 'player-small-zoom.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate("document.getElementById('drawer-close').click(); document.getElementById('player-back-btn').click()");
    await settle();
    assert.equal(await evaluate("document.getElementById('content').scrollTop"), 0, 'returning from player opens top of detail');
    report.cases.push({ width, height, zoom, detail, player, drawer });
  }
  win.webContents.setZoomFactor(1);
  win.setContentSize(1280,800);
  await evaluate("DetailPage.playEpisode(DetailPage.currentAnime,1,'测试剧集')");
  await settle();
  await evaluate("document.getElementById('player-container').requestFullscreen()");
  await settle();
  report.fullscreen = await evaluate(geometry);
  checkPlayer(report.fullscreen, 'fullscreen', true);
  await evaluate('document.exitFullscreen()');
  await settle();
  checkPlayer(await evaluate(geometry), 'after fullscreen');
  await evaluate("document.getElementById('player-container').requestFullscreen()");
  await settle();
  await evaluate("document.getElementById('player-back-btn').click()");
  await settle();
  assert.equal(await evaluate('document.fullscreenElement === null'), true, 'back from fullscreen leaves the player top layer');
  assert.equal(await evaluate('Router.currentPage'), 'detail');
  await evaluate(`DetailPage.currentAnime.episodes.unshift({id:0,ep:0,nameCn:'第零集'});
    DetailPage.render(DetailPage.currentAnime);
    document.getElementById('btn-continue-play').click(); void 0;`);
  await settle();
  assert.equal(await evaluate('PlayerPage.currentParams.episode'), 0, 'start watching must preserve episode zero');
  assert.deepEqual(report.errors, []);
  report.passed = true;
}).catch(error => { report.passed = false; report.failure = error.stack; }).finally(() => {
  fs.writeFileSync(path.join(output, process.env.ANIVIEW_LAYOUT_APP_PATH ? 'packaged-layout.json' : 'source-layout.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify({appPath:root,passed:report.passed,cases:report.cases.length,errors:report.errors,failure:report.failure},null,2));
  win?.destroy();
  app.exit(report.passed ? 0 : 1);
});
