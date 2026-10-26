// Manual end-to-end check of the published executable; never reuses the real user profile.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const verification = path.join(root, '.repair-verification');
const executable = path.join(root, 'dist', 'AniView', 'AniView.exe');
const archive = path.join(root, 'dist', 'AniView', 'resources', 'app.asar');
const profile = path.join(verification, `final-exe-profile-${Date.now()}-${process.pid}`);
const appData = path.join(profile, 'AppData', 'Roaming');
const localAppData = path.join(profile, 'AppData', 'Local');
const userData = path.join(profile, 'user-data');
const reportPath = path.join(verification, 'final-exe-layout-sources-smoke.json');
const screenshotPath = path.join(verification, 'final-exe-layout-sources-home.png');
const detailScreenshotPath = path.join(verification, 'final-exe-layout-sources-detail.png');
const playerScreenshotPath = path.join(verification, 'final-exe-layout-sources-player.png');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const proxyNames = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
const report = { at: new Date().toISOString(), executable, profile, userData, screenshotPath,
  detailScreenshotPath, playerScreenshotPath, animeId: '501963', episode: 1, archiveSha256: hash(archive) };

function safeLog(value) {
  return String(value).replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    socket.addEventListener('error', () => reject(new Error('CDP websocket connection failed')), { once: true });
    socket.addEventListener('message', event => {
      const result = JSON.parse(event.data);
      if (!pending.has(result.id)) return;
      const task = pending.get(result.id);
      pending.delete(result.id);
      clearTimeout(task.timer);
      if (result.error) task.reject(new Error(JSON.stringify(result.error)));
      else task.resolve(result.result);
    });
    socket.addEventListener('open', () => resolve({
      call(method, params = {}) {
        return new Promise((resolveCall, rejectCall) => {
          const callId = ++id;
          const timer = setTimeout(() => { pending.delete(callId); rejectCall(new Error(`CDP timed out: ${method}`)); }, 10000);
          pending.set(callId, { resolve: resolveCall, reject: rejectCall, timer });
          socket.send(JSON.stringify({ id: callId, method, params }));
        });
      },
      close() { socket.close(); },
    }), { once: true });
  });
}

const snapshotExpression = `(() => ({
  url: location.href,
  ready: document.readyState,
  calendar: document.querySelectorAll('#calendar-scroll .anime-card').length,
  hot: document.querySelectorAll('#hot-grid .anime-card').length,
  newest: document.querySelectorAll('#new-grid .anime-card').length,
  top: document.querySelectorAll('#top-grid .anime-card').length,
  errors: [...document.querySelectorAll('.catalog-message')].map(x => x.textContent),
  hotStatus: document.querySelector('#hot-controls')?.textContent,
  titles: [...document.querySelectorAll('#hot-grid .anime-card')].slice(0,3).map(x => x.innerText)
}))()`;

const playerExpression = `(() => {
  const rect = selector => { const r = document.querySelector(selector)?.getBoundingClientRect();
    return r ? {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height} : null; };
  const video = document.querySelector('#video-player');
  const content = document.querySelector('#content');
  const source = PlayerPage.sources[PlayerPage.sourceIndex];
  return {currentTime:video?.currentTime,videoWidth:video?.videoWidth,videoHeight:video?.videoHeight,
    duration:video?.duration,readyState:video?.readyState,paused:video?.paused,
    title:document.querySelector('.player-title-top')?.textContent,
    error:document.querySelector('#player-error .error-msg')?.textContent,
    source:source ? {source:source.source,name:source.name,sid:source.sid,providerName:source.providerName,
      label:source.label,recordId:source.recordId,matchedTitle:source.title,episode:source.episode,
      mediaHost:new URL(source.url).hostname} : null,
    sourceCount:PlayerPage.sources.length,selectedSourceIndex:PlayerPage.sourceIndex,
    viewport:{width:innerWidth,height:innerHeight},content:rect('#content'),titlebar:rect('#titlebar'),
    controls:rect('#player-controls'),progress:rect('#progress-wrap'),video:rect('#video-player'),
    scrollTop:content.scrollTop,scrollHeight:content.scrollHeight,clientHeight:content.clientHeight,
    fit:video ? getComputedStyle(video).objectFit : null};
})()`;

async function main() {
  for (const directory of [verification, appData, localAppData, userData]) fs.mkdirSync(directory, { recursive: true });
  const env = { ...process.env, APPDATA: appData, LOCALAPPDATA: localAppData };
  for (const name of proxyNames) delete env[name];
  delete env.ELECTRON_RUN_AS_NODE;
  report.proxyEnvironmentPresent = proxyNames.some(name => !!env[name]);
  const started = Date.now();
  const child = spawn(executable, [`--user-data-dir=${userData}`, '--remote-debugging-port=0'], {
    cwd: path.dirname(executable), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  report.pid = child.pid;
  let stdout = '', stderr = '', exited = false, cdp, evaluate;
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  child.on('exit', (code, signal) => { exited = true; report.exit = { code, signal }; });
  child.on('error', error => { report.spawnError = safeLog(error.message); });
  try {
    const portFiles = [path.join(userData, 'DevToolsActivePort'), path.join(appData, 'aniview', 'DevToolsActivePort')];
    let portFile;
    for (let i = 0; i < 100 && !exited; i++) {
      portFile = portFiles.find(file => fs.existsSync(file));
      if (portFile) break;
      await delay(200);
    }
    if (!portFile) throw new Error('Published executable did not open the isolated debugging port');
    report.devToolsActivePort = portFile;
    const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
    let target;
    for (let i = 0; i < 60 && !exited; i++) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) })).json();
      target = targets.find(item => item.type === 'page' && item.url.startsWith('file:') && item.url.includes('/src/renderer/index.html'));
      if (target) break;
      await delay(200);
    }
    if (!target) throw new Error('No published app renderer target appeared');
    cdp = await connect(target.webSocketDebuggerUrl);
    evaluate = async expression => {
      const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (expression, timeoutMs = 30000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (exited) throw new Error('Published executable exited during the check');
        if (await evaluate(expression)) return;
        await delay(200);
      }
      throw new Error('Timed out waiting for actual executable: ' + expression);
    };
    try {
      const windowInfo = await cdp.call('Browser.getWindowForTarget', { targetId: target.id });
      await cdp.call('Browser.setWindowBounds', { windowId: windowInfo.windowId, bounds: { windowState: 'normal' } });
      await cdp.call('Browser.setWindowBounds', { windowId: windowInfo.windowId, bounds: { width: 1000, height: 650 } });
      await cdp.call('Browser.setWindowBounds', { windowId: windowInfo.windowId, bounds: { windowState: 'minimized' } });
      report.windowMinimized = true;
    } catch { report.windowMinimized = false; }
    for (let i = 0; i < 100; i++) {
      report.home = await evaluate(snapshotExpression);
      if (report.home.calendar > 0 && report.home.hot > 0 && report.home.newest > 0 && report.home.top > 0) break;
      if (exited) throw new Error('Published executable closed before the catalogue loaded');
      await delay(200);
    }
    report.firstCompleteHomeMs = Date.now() - started;
    const storeMatch = stdout.match(/\[Store\][^\r\n]*?(?<file>[A-Za-z]:[^\r\n]*aniview-data\.json)/);
    report.storePath = storeMatch?.groups?.file;
    report.isolatedStore = Boolean(report.storePath && path.resolve(report.storePath).toLowerCase().startsWith(path.resolve(profile).toLowerCase() + path.sep));
    if (!report.isolatedStore) throw new Error('Could not verify the executable used its independent profile');
    if (!(report.home.calendar > 0 && report.home.hot > 0)) throw new Error('Daily or hot anime failed to render in the actual executable');
    const firstCount = report.home.hot;
    await evaluate(`document.querySelector('#hot-controls button')?.click()`);
    for (let i = 0; i < 60; i++) {
      report.afterLoadMore = await evaluate(snapshotExpression);
      if (report.afterLoadMore.hot > firstCount) break;
      await delay(200);
    }
    if (report.afterLoadMore.hot <= firstCount) throw new Error('The actual executable did not append a second hot page');
    const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    // Use the real detail UI and its episode click handler, then prove decoded video advances.
    const detailStarted = Date.now();
    await evaluate(`Router.navigate('detail', {id:${JSON.stringify(report.animeId)}})`);
    await until(`DetailPage.currentAnime?.id === ${JSON.stringify(report.animeId)} && !!document.querySelector('.episode-item[data-ep="1"]')`);
    await evaluate('for (const animation of document.getAnimations()) { if (Number.isFinite(animation.effect?.getTiming().iterations)) animation.finish(); }');
    report.detailMs = Date.now() - detailStarted;
    report.detail = await evaluate(`(() => {
      const rect = selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {top:r.top,bottom:r.bottom}; };
      return {title:DetailPage.currentAnime.titleCn,selected:DetailPage.currentAnime.episodes.find(ep=>ep.ep===1),
        content:rect('#content'),topbar:rect('#detail-topbar'),poster:rect('.detail-cover'),
        titlePosition:rect('.detail-title'),scrollTop:document.querySelector('#content').scrollTop};
    })()`);
    assert.equal(report.detail.title, '无职转生 第三季 ～到了异世界就拿出真本事～');
    assert.ok(report.detail.selected, 'Episode one must exist in the real catalogue');
    assert.equal(report.detail.scrollTop, 0, 'Opening detail resets the shared scroll container');
    assert.ok(Math.abs(report.detail.topbar.top - report.detail.content.top) <= 1, 'Detail return bar starts at the content top');
    assert.ok(report.detail.poster.top >= report.detail.topbar.bottom, 'Poster must not overlap the return bar');
    assert.ok(report.detail.titlePosition.top >= report.detail.topbar.bottom, 'Title must not overlap the return bar');
    fs.writeFileSync(detailScreenshotPath, Buffer.from((await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
    const playbackStarted = Date.now();
    await evaluate(`document.querySelector('.episode-item[data-ep="1"]').click()`);
    await until(`(() => { const v=document.querySelector('#video-player'); return v && v.videoWidth > 0 && v.currentTime > 0.5 && !v.paused; })()`, 70000);
    report.firstDecodedMs = Date.now() - playbackStarted;
    const firstTime = await evaluate(`document.querySelector('#video-player').currentTime`);
    await until(`document.querySelector('#video-player').currentTime > ${firstTime + 0.5}`, 10000);
    report.playback = await evaluate(playerExpression);
    const playback = report.playback;
    assert.ok(playback.videoWidth > 0 && playback.currentTime > firstTime + 0.25, 'Actual decoded playback time must advance');
    assert.equal(playback.paused, false);
    assert.ok(playback.source && (playback.source.name || playback.source.source || playback.source.providerName), 'Record the actual chosen source label');
    assert.ok(playback.controls.top >= playback.titlebar.bottom - 1, 'Controls start inside the video viewport');
    assert.ok(playback.controls.bottom <= playback.viewport.height + 1, 'Controls bottom stays inside the viewport');
    assert.ok(playback.progress.height >= 12, 'Progress control remains usable');
    assert.ok(playback.video.top >= playback.titlebar.bottom - 1 && playback.video.bottom <= playback.viewport.height + 1, 'Video fits the available height');
    assert.ok(playback.video.left >= -1 && playback.video.right <= playback.viewport.width + 1, 'Video fits the available width');
    assert.equal(playback.fit, 'contain');
    assert.equal(playback.scrollTop, 0, 'Playback begins without inherited page scrolling');
    assert.ok(playback.scrollHeight <= playback.clientHeight + 1, 'The outer playback page does not scroll');
    // Capture a representative decoded frame, rather than the episode's black opening fade.
    const screenshotTime = Math.min(45, Math.max(0, playback.duration / 2));
    await evaluate(`document.querySelector('#video-player').currentTime = ${screenshotTime}`);
    await until(`(() => { const v=document.querySelector('#video-player'); return v.readyState >= 3 && v.currentTime > ${screenshotTime + 0.25} && !v.paused; })()`, 30000);
    report.screenshotPlaybackTime = await evaluate(`document.querySelector('#video-player').currentTime`);
    await evaluate(`document.querySelector('#video-player').pause(); PlayerPage.hls?.stopLoad(); document.querySelector('#player-container').classList.add('controls-visible')`);
    await delay(250);
    fs.writeFileSync(playerScreenshotPath, Buffer.from((await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = safeLog(error.stack);
    if (evaluate) {
      try { report.failedPlayback = await evaluate(playerExpression); } catch { /* The renderer may not have reached the player. */ }
    }
    process.exitCode = 1;
  } finally {
    if (cdp && !exited) {
      try { await cdp.call('Runtime.evaluate', { expression: 'window.api.close()' }); } catch { /* Closing the renderer can close its CDP connection first. */ }
    }
    for (let i = 0; i < 15 && !exited; i++) await delay(100);
    if (!exited) { child.kill(); report.stoppedOwnPid = child.pid; await delay(200); }
    cdp?.close();
    report.stdout = safeLog(stdout);
    report.stderr = safeLog(stderr).slice(0, 5000);
    report.archiveUnchanged = hash(archive) === report.archiveSha256;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, stdout: undefined, stderr: undefined }, null, 2));
    console.log('Report: ' + reportPath);
  }
}

main().catch(error => { console.error(safeLog(error.stack)); process.exitCode = 1; });
