// Opt-in live playback check. Run with node; the launcher clears injected proxy
// variables and starts Electron with an independent profile and the real UI/IPC.
const fs = require('node:fs');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const output = path.join(project, '.repair-verification', 'sources');
fs.mkdirSync(output, { recursive: true });

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(https?|all|no)_proxy$/i.test(key)) delete env[key];
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const timer = setTimeout(() => child.kill(), 150000);
  child.on('close', code => { clearTimeout(timer); process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow, session } = require('electron');
  const assert = require('node:assert/strict');
  const root = process.env.ANIVIEW_SOURCE_APP_PATH ? path.resolve(process.env.ANIVIEW_SOURCE_APP_PATH) : project;
  const profile = fs.mkdtempSync(path.join(output, 'profile-'));
  const suffix = process.env.ANIVIEW_SOURCE_APP_PATH ? 'packaged' : 'live';
  const reportPath = path.join(output, `renderer-${suffix}.json`);
  const report = { at: new Date().toISOString(), root, profile, freshProfile: true,
    proxyEnvironment: Object.keys(process.env).filter(key => /^(https?|all|no)_proxy$/i.test(key)), samples: [], rendererErrors: [] };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let win;
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.disableHardwareAcceleration();

  const evaluate = expression => win.webContents.executeJavaScript(expression, true);
  async function until(expression, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = await evaluate(expression);
      if (value) return value;
      await delay(200);
    }
    throw new Error('Timed out: ' + expression);
  }

  app.whenReady().then(async () => {
    report.isolatedUserData = app.getPath('userData') === profile;
    assert.equal(report.isolatedUserData, true);
    assert.equal(report.proxyEnvironment.length, 0);
    report.systemProxyActive = (await session.defaultSession.resolveProxy('https://api.bgm.tv')) !== 'DIRECT';
    require(path.join(root, 'src/main/ipc-handlers')).registerIpcHandlers();
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
      preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true,
    } });
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3 && !message.includes('net::')) report.rendererErrors.push(message.slice(0, 400));
    });
    await win.loadFile(path.join(root, 'src/renderer/index.html'));
    await until("typeof DetailPage !== 'undefined' && DetailPage.container && typeof PlayerPage !== 'undefined'");
    const samples = [{ id: '501963', title: '无职转生 第三季 ～到了异世界就拿出真本事～', episode: 1, label: 'third-season' }];
    if (process.env.ANIVIEW_SOURCE_INCLUDE_SECOND === '1') samples.push({
      id: '373247', title: '无职转生 第二季 ～到了异世界就拿出真本事～', episode: 1, label: 'second-season',
    });
    for (const sample of samples) {
      const result = { ...sample };
      report.samples.push(result);
      console.log('[source-smoke] Opening actual detail and player:', sample.title);
      await evaluate(`Router.navigate('detail', {id:${JSON.stringify(sample.id)}})`);
      await until(`DetailPage.currentAnime?.id === ${JSON.stringify(sample.id)} && DetailPage.currentAnime?.episodes?.length > 0`);
      result.metadata = await evaluate(`({ title:DetailPage.currentAnime.titleCn,
        firstEpisodes:DetailPage.currentAnime.episodes.slice(0,3),
        selected:DetailPage.currentAnime.episodes.find(ep => ep.ep === ${sample.episode}) })`);
      assert.equal(result.metadata.title, sample.title);
      assert.ok(result.metadata.selected, 'Requested episode exists in the real catalogue');
      result.expectedEpisodeName = result.metadata.selected.nameCn || result.metadata.selected.name;
      const started = Date.now();
      await evaluate(`DetailPage.playEpisode(DetailPage.currentAnime, ${sample.episode}, ${JSON.stringify(result.expectedEpisodeName)})`);
      try {
        await until("(() => { const v=document.querySelector('#video-player'); return v && v.videoWidth > 0 && v.currentTime > 0.5 && !v.paused; })()", 70000);
        result.firstDecodedMs = Date.now() - started;
        const firstTime = await evaluate("document.querySelector('#video-player').currentTime");
        await delay(700);
        result.video = await evaluate(`(() => {
          const v=document.querySelector('#video-player');
          const source=PlayerPage.sources[PlayerPage.sourceIndex];
          return { currentTime:v.currentTime, videoWidth:v.videoWidth, videoHeight:v.videoHeight,
            duration:v.duration, readyState:v.readyState, paused:v.paused,
            title:document.querySelector('.player-title-top')?.textContent,
            source:source ? {source:source.source,name:source.name,sid:source.sid,pageUrl:source.pageUrl,recordId:source.recordId,matchedTitle:source.title,episode:source.episode,
              providerName:source.providerName,label:source.label,mediaHost:new URL(source.url).hostname} : null,
            chosenIndex:PlayerPage.sourceIndex, sourceCount:PlayerPage.sources.length };
        })()`);
        assert.ok(result.video.currentTime > firstTime + 0.25, 'Decoded playback time must advance');
        assert.ok(result.video.videoWidth > 0);
        await evaluate("document.querySelector('#video-player').pause(); PlayerPage.hls?.stopLoad()");
        await evaluate("for (const animation of document.getAnimations()) { if (Number.isFinite(animation.effect?.getTiming().iterations)) animation.finish(); }");
        await delay(250);
        result.screenshot = path.join(output, `${sample.label}-${suffix}.png`);
        fs.writeFileSync(result.screenshot, (await win.webContents.capturePage()).toPNG());
        result.passed = true;
        console.log('[source-smoke] Decoded:', JSON.stringify(result.video));
        const selectedProvider = [result.video.source?.source, result.video.source?.name, result.video.source?.providerName].join(' ');
        if (!/魔都|\bmodu\b|\bmodou\b/i.test(selectedProvider)) {
          console.log('[source-smoke] Checking the independent Modu provider in the actual player');
          const selected = await evaluate(`(async () => {
            const all=await window.api.getAllSources(${JSON.stringify(sample.title)}, ${sample.episode});
            const source=(all.sources || []).find(item => /魔都|\\bmodu\\b|\\bmodou\\b/i.test([item.source,item.name,item.providerName].join(' ')));
            if (!source) return {error:all.error || 'The new Modu provider did not return a playable source',available:(all.sources||[]).map(s=>({source:s.source,name:s.name}))};
            // Keep automatic failover from masking a failure of the new provider.
            PlayerPage.requestId++;
            PlayerPage.sources=[source]; PlayerPage.sourceIndex=0;
            PlayerPage.sourcesResolved=true; PlayerPage.autoSwitchCount=2;
            PlayerPage.triedSources=new Set();
            PlayerPage.startSource();
            return {source:source.source,name:source.name,sid:source.sid,pageUrl:source.pageUrl,recordId:source.recordId,matchedTitle:source.title,episode:source.episode,mediaHost:new URL(source.url).hostname};
          })()`);
          result.additionalProvider = selected;
          assert.equal(selected.error, undefined, JSON.stringify(selected));
          const providerStarted = Date.now();
          await until("(() => { const v=document.querySelector('#video-player'); return v && v.videoWidth > 0 && v.currentTime > 0.5 && !v.paused; })()", 45000);
          const providerTime = await evaluate("document.querySelector('#video-player').currentTime");
          await delay(700);
          result.additionalProvider.video = await evaluate("(() => { const v=document.querySelector('#video-player'); return {currentTime:v.currentTime,videoWidth:v.videoWidth,videoHeight:v.videoHeight,duration:v.duration,paused:v.paused}; })()");
          assert.ok(result.additionalProvider.video.currentTime > providerTime + 0.25);
          result.additionalProvider.firstDecodedMs = Date.now() - providerStarted;
          result.additionalProvider.passed = true;
          await evaluate("document.querySelector('#video-player').pause(); PlayerPage.hls?.stopLoad()");
          await delay(250);
          result.additionalProvider.screenshot = path.join(output, `${sample.label}-modu-${suffix}.png`);
          fs.writeFileSync(result.additionalProvider.screenshot, (await win.webContents.capturePage()).toPNG());
          console.log('[source-smoke] Independent provider decoded:', JSON.stringify(result.additionalProvider));
        } else result.newProviderDecoded = true;
      } catch (error) {
        result.failure = error.message;
        result.state = await evaluate(`({ error:document.querySelector('#player-error .error-msg')?.textContent,
          loading:document.querySelector('#player-loading')?.textContent,
          currentTime:document.querySelector('#video-player')?.currentTime,
          readyState:document.querySelector('#video-player')?.readyState,
          currentSource:PlayerPage.sources[PlayerPage.sourceIndex],
          sourceCount:PlayerPage.sources.length })`);
        result.screenshot = path.join(output, `${sample.label}-${suffix}-failure.png`);
        fs.writeFileSync(result.screenshot, (await win.webContents.capturePage()).toPNG());
        throw error;
      } finally {
        await evaluate("Router.navigate('home')");
      }
    }
    report.passed = true;
  }).catch(error => { report.passed = false; report.failure = error.stack; }).finally(() => {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log('[source-smoke] Report:', reportPath);
    win?.destroy();
    app.exit(report.passed ? 0 : 1);
  });
}
