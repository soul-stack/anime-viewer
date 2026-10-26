/* ===== 播放器 v2 - 自定义控件 ===== */
const PlayerPage = {
  container: null,
  hls: null,
  currentParams: null,
  retryCount: 0,
  maxRetries: 3,
  controlsTimer: null,
  isFullscreen: false,
  playbackSpeed: 1,
  drawerOpen: false,
  episodes: [],
  sessionId: 0,
  requestId: 0,
  mediaId: 0,
  sources: [],
  sourceIndex: 0,
  triedSources: new Set(),
  sourcesResolved: false,
  autoSwitchCount: 0,
  listeners: [],

  init() {
    this.container = document.getElementById('page-player');
  },

  async play(params) {
    this.cleanup();
    document.body.classList.add('player-mode');
    this.currentParams = params;
    this.retryCount = 0;
    this.isFullscreen = false;
    this.drawerOpen = false;
    this.episodes = [];
    this.sources = [];
    this.triedSources = new Set();
    this.sourcesResolved = false;
    this.autoSwitchCount = 0;

    this.container.innerHTML = `
      <div class="player-container controls-visible" id="player-container">
        <div class="player-main">
          <div class="player-video-wrap show-cursor" id="player-video-wrap">
            <video id="video-player" preload="metadata"></video>

            <div class="player-loading" id="player-loading">
              <div class="spinner"></div>
              <span>正在加载...</span>
            </div>

            <div class="player-center-play" id="player-center-play"></div>

            <div class="player-error" id="player-error" style="display:none">
              <div class="error-icon">:(</div>
              <div class="error-msg"></div>
              <div class="error-actions">
                <button class="retry-btn">重试</button>
                <button class="switch-btn" id="btn-switch-source" style="display:none">切换线路</button>
              </div>
            </div>

            <!-- 顶部叠加 -->
            <div class="player-top-overlay" id="player-top-overlay">
              <button class="player-back-btn" id="player-back-btn">← 返回</button>
              <span class="player-title-top">${params.animeTitle} - 第${params.episode}集${params.episodeName ? ' ' + params.episodeName : ''}</span>
            </div>

            <!-- 控制栏 -->
            <div class="player-controls" id="player-controls">
              <!-- 进度条 -->
              <div class="player-progress-wrap" id="progress-wrap">
                <div class="player-progress-track" id="progress-track">
                  <div class="player-progress-buffered" id="progress-buffered"></div>
                  <div class="player-progress-played" id="progress-played"></div>
                  <div class="player-progress-thumb" id="progress-thumb"></div>
                </div>
              </div>

              <!-- 控制按钮 -->
              <div class="player-controls-row">
                <button class="player-btn player-btn-play" id="btn-play">▶</button>

                <div class="player-time-display">
                  <span class="player-time" id="time-current">0:00</span>
                  <span class="player-time-sep">/</span>
                  <span class="player-time" id="time-total">0:00</span>
                </div>

                <div class="player-volume-wrap">
                  <button class="player-btn" id="btn-mute">♪</button>
                  <div class="player-volume-slider">
                    <input type="range" id="volume-slider" min="0" max="100" value="100">
                  </div>
                </div>

                <button class="player-btn player-speed-btn" id="btn-speed">1x</button>
                <div class="player-speed-menu" id="speed-menu">
                  ${[0.5, 0.75, 1, 1.25, 1.5, 2].map(s =>
                    `<div class="player-speed-option${s === 1 ? ' active' : ''}" data-speed="${s}">${s}x</div>`
                  ).join('')}
                </div>

                <div class="player-controls-right">
                  <button class="player-btn" id="btn-ep-prev">◀</button>
                  <button class="player-btn" id="btn-ep-next">▶</button>
                  <button class="player-btn player-btn-fullscreen" id="btn-fullscreen">⛶</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 中间暂停按钮 -->
          <button class="player-drawer-toggle" id="drawer-toggle">◀</button>
        </div>

        <!-- 选集抽屉 -->
        <div class="player-drawer" id="player-drawer">
          <div class="player-drawer-header">
            <span>选集</span>
            <button class="player-drawer-close" id="drawer-close">✕</button>
          </div>
          <div class="player-drawer-list" id="drawer-list"></div>
        </div>
      </div>
    `;

    this.bindControls();
    this.loadEpisodes(params.animeId, params.episode);
    await this.resolveAndPlay(params);
  },

  bindControls() {
    const wrap = document.getElementById('player-video-wrap');
    const container = document.getElementById('player-container');
    const video = document.getElementById('video-player');

    // 显示/隐藏控制栏
    const sessionId = this.sessionId;

    const showControls = () => {
      container.classList.add('controls-visible');
      wrap.classList.add('show-cursor');
      clearTimeout(this.controlsTimer);
      if (!video.paused) {
        this.controlsTimer = setTimeout(() => {
          container.classList.remove('controls-visible');
          wrap.classList.remove('show-cursor');
        }, 3000);
      }
    };

    const keepControls = () => {
      container.classList.add('controls-visible');
      wrap.classList.add('show-cursor');
      clearTimeout(this.controlsTimer);
    };

    wrap.addEventListener('mousemove', showControls);
    wrap.addEventListener('mouseleave', () => {
      if (!video.paused) {
        this.controlsTimer = setTimeout(() => {
          container.classList.remove('controls-visible');
          wrap.classList.remove('show-cursor');
        }, 2000);
      }
    });

    // 进度条点击
    const progressWrap = document.getElementById('progress-wrap');
    const progressTrack = document.getElementById('progress-track');

    const seekVideo = (e) => {
      if (!video.duration) return;
      const rect = progressTrack.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      video.currentTime = ratio * video.duration;
    };

    progressWrap.addEventListener('mousedown', (e) => {
      seekVideo(e);
      const onMove = (ev) => seekVideo(ev);
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      this.listen(document, 'mousemove', onMove);
      this.listen(document, 'mouseup', onUp);
    });

    // 播放/暂停
    const btnPlay = document.getElementById('btn-play');
    const centerPlay = document.getElementById('player-center-play');

    const togglePlay = () => {
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    };

    btnPlay.addEventListener('click', togglePlay);
    centerPlay.addEventListener('click', togglePlay);
    this.listen(video, 'click', togglePlay);

    this.listen(video, 'play', () => {
      btnPlay.textContent = '⏸';
      centerPlay.classList.remove('show');
      showControls();
    });

    this.listen(video, 'pause', () => {
      btnPlay.textContent = '▶';
      centerPlay.classList.add('show');
      container.classList.add('controls-visible');
      wrap.classList.add('show-cursor');
      clearTimeout(this.controlsTimer);
    });

    // 时间更新
    this.listen(video, 'timeupdate', () => {
      this.updateProgress(video);
    });

    this.listen(video, 'loadedmetadata', () => {
      if (sessionId === this.sessionId) document.getElementById('time-total').textContent = this.formatTime(video.duration);
    });

    // 音量
    const volumeSlider = document.getElementById('volume-slider');
    const btnMute = document.getElementById('btn-mute');

    volumeSlider.addEventListener('input', () => {
      video.volume = volumeSlider.value / 100;
      video.muted = video.volume === 0;
      btnMute.textContent = video.muted ? '✕' : video.volume < 0.5 ? '♩' : '♪';
    });

    btnMute.addEventListener('click', () => {
      video.muted = !video.muted;
      if (video.muted) {
        volumeSlider.value = 0;
        btnMute.textContent = '✕';
      } else {
        volumeSlider.value = (video.volume || 1) * 100;
        btnMute.textContent = '♪';
      }
    });

    // 倍速
    const btnSpeed = document.getElementById('btn-speed');
    const speedMenu = document.getElementById('speed-menu');

    btnSpeed.addEventListener('click', (e) => {
      e.stopPropagation();
      speedMenu.classList.toggle('open');
    });

    speedMenu.querySelectorAll('.player-speed-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const speed = parseFloat(opt.dataset.speed);
        video.playbackRate = speed;
        this.playbackSpeed = speed;
        btnSpeed.textContent = speed + 'x';
        speedMenu.querySelectorAll('.player-speed-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        speedMenu.classList.remove('open');
      });
    });

    // 关闭倍速菜单
    this.listen(document, 'click', () => {
      speedMenu.classList.remove('open');
    });

    // 导航按钮
    document.getElementById('player-back-btn').addEventListener('click', () => {
      Router.navigate('detail', { id: this.currentParams.animeId });
    });

    document.getElementById('btn-ep-prev').addEventListener('click', () => {
      this.changeEpisode(-1);
    });

    document.getElementById('btn-ep-next').addEventListener('click', () => {
      this.changeEpisode(1);
    });

    // 全屏
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) {
        container.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    });

    this.listen(document, 'fullscreenchange', () => {
      this.isFullscreen = !!document.fullscreenElement;
      const button = document.getElementById('btn-fullscreen');
      if (button) button.textContent = '⛶';
    });

    // 选集抽屉
    const drawerToggle = document.getElementById('drawer-toggle');
    const drawer = document.getElementById('player-drawer');

    drawerToggle.addEventListener('click', () => {
      this.drawerOpen = !this.drawerOpen;
      drawer.classList.toggle('open', this.drawerOpen);
      drawerToggle.textContent = this.drawerOpen ? '▶' : '◀';
    });

    document.getElementById('drawer-close').addEventListener('click', () => {
      this.drawerOpen = false;
      drawer.classList.remove('open');
      drawerToggle.textContent = '◀';
    });

    // 键盘快捷键
    const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
    this.listen(document, 'keydown', (e) => {
      if (document.getElementById('page-player').classList.contains('active')) {
        switch (e.key) {
          case ' ': case 'k': e.preventDefault(); togglePlay(); break;
          case 'f': document.getElementById('btn-fullscreen').click(); break;
          case 'm': btnMute.click(); break;
          case 'n':
          case 'N':
            document.getElementById('btn-ep-next')?.click();
            break;
          case 'p':
          case 'P':
            document.getElementById('btn-ep-prev')?.click();
            break;
          case '>':
          case '.':
            e.preventDefault();
            const nextIdx = SPEED_OPTIONS.indexOf(this.playbackSpeed) + 1;
            if (nextIdx < SPEED_OPTIONS.length) {
              video.playbackRate = SPEED_OPTIONS[nextIdx];
              this.playbackSpeed = SPEED_OPTIONS[nextIdx];
              btnSpeed.textContent = SPEED_OPTIONS[nextIdx] + 'x';
              document.querySelectorAll('.player-speed-option').forEach(o =>
                o.classList.toggle('active', parseFloat(o.dataset.speed) === SPEED_OPTIONS[nextIdx])
              );
            }
            break;
          case '<':
          case ',':
            e.preventDefault();
            const prevIdx = SPEED_OPTIONS.indexOf(this.playbackSpeed) - 1;
            if (prevIdx >= 0) {
              video.playbackRate = SPEED_OPTIONS[prevIdx];
              this.playbackSpeed = SPEED_OPTIONS[prevIdx];
              btnSpeed.textContent = SPEED_OPTIONS[prevIdx] + 'x';
              document.querySelectorAll('.player-speed-option').forEach(o =>
                o.classList.toggle('active', parseFloat(o.dataset.speed) === SPEED_OPTIONS[prevIdx])
              );
            }
            break;
          case 'ArrowLeft':
            e.preventDefault();
            video.currentTime = Math.max(0, video.currentTime - (e.repeat ? 30 : 10));
            break;
          case 'ArrowRight':
            e.preventDefault();
            video.currentTime = Math.min(video.duration || 0, video.currentTime + (e.repeat ? 30 : 10));
            break;
          case 'ArrowUp': e.preventDefault(); volumeSlider.value = Math.min(100, parseInt(volumeSlider.value) + 10); video.volume = volumeSlider.value / 100; break;
          case 'ArrowDown': e.preventDefault(); volumeSlider.value = Math.max(0, parseInt(volumeSlider.value) - 10); video.volume = volumeSlider.value / 100; break;
        }
      }
    });

    // 错误重试
    document.querySelector('#player-error .retry-btn')?.addEventListener('click', () => {
      this.hideError();
      document.getElementById('btn-switch-source').style.display = 'none';
      this.retryCount = 0;
      this.autoSwitchCount = 0;
      this.triedSources = new Set();
      this.sourcesResolved = false;
      this.resolveAndPlay(this.currentParams, { forceRefresh: true });
    });

    // 切换线路
    document.getElementById('btn-switch-source')?.addEventListener('click', () => {
      this.hideError();
      document.getElementById('btn-switch-source').style.display = 'none';
      this.retryCount = 0;
      this.switchSource();
    });

    // 进度保存
    const historyParams = { ...this.currentParams };
    this.listen(video, 'timeupdate', () => {
      if (this.historyTimer) return;
      this.historyTimer = setTimeout(() => {
        this.historyTimer = null;
        if (video.duration && historyParams) {
          window.api.addHistory({
            animeId: historyParams.animeId,
            title: historyParams.animeTitle,
            titleCn: historyParams.animeTitle,
            cover: historyParams.cover || '',
            episode: historyParams.episode,
            episodeName: historyParams.episodeName || '',
            progress: Math.floor(video.currentTime),
            duration: Math.floor(video.duration),
          }).catch(() => {});
        }
      }, 5000);
    });
  },

  updateProgress(video) {
    if (!video.duration) return;
    const played = (video.currentTime / video.duration) * 100;
    document.getElementById('progress-played').style.width = played + '%';
    document.getElementById('progress-thumb').style.left = played + '%';

    // 缓冲进度
    if (video.buffered.length > 0) {
      const buffered = (video.buffered.end(video.buffered.length - 1) / video.duration) * 100;
      document.getElementById('progress-buffered').style.width = buffered + '%';
    }

    document.getElementById('time-current').textContent = this.formatTime(video.currentTime);
  },

  formatTime(seconds) {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  changeEpisode(direction) {
    const index = this.episodes.findIndex(episode => Number(episode.ep) === Number(this.currentParams.episode));
    const next = index >= 0 ? this.episodes[index + direction] : null;
    if (next) this.play({ ...this.currentParams, episode: Number(next.ep), episodeName: next.nameCn || next.name || '' });
  },

  async loadEpisodes(animeId, currentEp) {
    const sessionId = this.sessionId;
    try {
      const episodes = await window.api.getEpisodes(animeId);
      if (sessionId !== this.sessionId || !Array.isArray(episodes) || episodes.length === 0) return;
      this.episodes = episodes;
      const index = episodes.findIndex(episode => Number(episode.ep) === Number(currentEp));
      document.getElementById('btn-ep-prev').disabled = index <= 0;
      document.getElementById('btn-ep-next').disabled = index < 0 || index >= episodes.length - 1;

      const drawerList = document.getElementById('drawer-list');
      drawerList.innerHTML = episodes.map(ep => `
        <div class="player-drawer-item${ep.ep === currentEp ? ' active' : ''}" data-ep="${ep.ep}" data-name="${ep.nameCn || ep.name}">
          <span class="ep-drawer-num">${ep.ep}</span>
          <span class="ep-drawer-name">${ep.nameCn || ep.name || `第${ep.ep}集`}</span>
          ${ep.ep === currentEp ? '<span class="ep-drawer-check">▶</span>' : ''}
        </div>
      `).join('');

      drawerList.querySelectorAll('.player-drawer-item').forEach(item => {
        item.addEventListener('click', () => {
          const ep = Number(item.dataset.ep);
          if (ep !== this.currentParams?.episode) {
            this.play({ ...this.currentParams, episode: ep, episodeName: item.dataset.name });
          }
        });
      });
    } catch (e) {
      console.error('加载剧集列表失败:', e);
    }
  },

  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.listeners.push(() => target.removeEventListener(type, handler, options));
  },

  async resolveAndPlay(params, options = {}) {
    const requestId = ++this.requestId;
    this.clearPlayingTimeout();
    this.cleanupHls();
    const loading = document.getElementById('player-loading');
    if (loading) {
      loading.style.display = 'flex';
      loading.querySelector('span').textContent = '正在查找播放线路...';
    }
    this.hideError();
    const title = document.getElementById('player-top-overlay')?.querySelector('.player-title-top');
    if (title) title.textContent = params.animeTitle + ' - 第' + params.episode + '集' + (params.episodeName ? ' ' + params.episodeName : '');
    // Resolution and media startup have separate budgets. Expired IPC results cannot restart playback.
    this.playingTimeout = setTimeout(() => {
      if (requestId !== this.requestId) return;
      this.requestId++;
      this.showError('播放源查询超时，请重试');
    }, 18000);
    try {
      const result = await window.api.getPlayUrl(params.animeTitle, params.episode, options);
      if (requestId !== this.requestId) return;
      this.clearPlayingTimeout();
      if (!result?.url || result.error) return this.showError(result?.error || '未找到播放源');
      this.sources = (result.allSources || [result]).filter(item => item.url);
      if (!this.sources.some(item => item.url === result.url)) this.sources.unshift(result);
      this.sourceIndex = this.sources.findIndex(item => item.url === result.url);
      this.startSource();
    } catch (error) {
      if (requestId === this.requestId) this.showError('解析失败: ' + error.message);
    }
  },

  startSource() {
    const source = this.sources[this.sourceIndex];
    if (!source?.url) return this.showError('没有可切换的播放线路');
    this.clearPlayingTimeout();
    this.cleanupHls();
    this.hideError();
    this.retryCount = 0;
    this.triedSources.add(source.url);
    const loading = document.getElementById('player-loading');
    if (loading) {
      loading.style.display = 'flex';
      loading.querySelector('span').textContent = '正在加载视频（' + (source.name || source.source || '播放源') + ' · 线路 ' + source.sid + '）...';
    }
    const switchButton = document.getElementById('btn-switch-source');
    if (switchButton) switchButton.style.display = 'inline-block';
    const video = document.getElementById('video-player');
    this.playHls(video, source.url);
  },

  async switchSource(automatic = false) {
    const requestId = ++this.requestId;
    this.clearPlayingTimeout();
    this.cleanupHls();
    this.hideError();
    const loading = document.getElementById('player-loading');
    if (loading) {
      loading.style.display = 'flex';
      loading.querySelector('span').textContent = '正在查找其他线路...';
    }
    this.playingTimeout = setTimeout(() => {
      if (requestId !== this.requestId) return;
      this.requestId++;
      this.showError('切换线路超时，请重试');
    }, 18000);
    let next = this.sources.findIndex(source => !this.triedSources.has(source.url));
    if (next < 0 && !this.sourcesResolved) {
      try {
        const result = await window.api.getAllSources(this.currentParams.animeTitle, this.currentParams.episode);
        if (requestId !== this.requestId) return;
        this.sourcesResolved = true;
        for (const source of result?.sources || []) {
          if (!this.sources.some(item => item.url === source.url)) this.sources.push(source);
        }
        next = this.sources.findIndex(source => !this.triedSources.has(source.url));
      } catch (error) {
        if (requestId !== this.requestId) return;
        this.showError('切换线路失败: ' + error.message);
        return;
      }
    }
    if (requestId !== this.requestId) return;
    this.clearPlayingTimeout();
    if (next < 0 && !automatic && this.sources.length > 1) next = (this.sourceIndex + 1) % this.sources.length;
    if (next < 0) return this.showError('当前可用线路无法播放，请稍后重试（源站网络或跨域限制）');
    this.sourceIndex = next;
    this.startSource();
  },

  failPlayback(message) {
    this.clearPlayingTimeout();
    if (this.autoSwitchCount < 2) {
      this.autoSwitchCount++;
      this.switchSource(true);
    } else {
      this.cleanupHls();
      this.showError(message);
    }
  },

  clearPlayingTimeout() {
    clearTimeout(this.playingTimeout);
    this.playingTimeout = null;
  },

  cleanupHls() {
    this.mediaId++;
    this.mediaEvents?.abort();
    this.mediaEvents = null;
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    const video = document.getElementById('video-player');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  },

  playHls(video, url) {
    const mediaId = this.mediaId;
    this.mediaEvents = new AbortController();
    const options = { signal: this.mediaEvents.signal };
    const current = () => mediaId === this.mediaId;
    const armTimeout = () => {
      this.clearPlayingTimeout();
      this.playingTimeout = setTimeout(() => {
        if (current()) this.failPlayback('视频加载超时，请重试或切换线路');
      }, 18000);
    };
    const beginPlayback = () => {
      if (!current()) return;
      video.playbackRate = this.playbackSpeed;
      video.play().catch(error => {
        if (!current()) return;
        if (error.name === 'NotAllowedError') {
          this.clearPlayingTimeout();
          this.hideLoading();
          document.getElementById('player-center-play')?.classList.add('show');
        } else if (error.name !== 'AbortError') this.failPlayback('视频无法开始播放: ' + error.message);
      });
    };
    video.addEventListener('playing', () => {
      if (!current()) return;
      this.clearPlayingTimeout();
      this.hideLoading();
      this.hideError();
    }, options);
    video.addEventListener('waiting', () => { if (current()) armTimeout(); }, options);
    armTimeout();
    if (/\.m3u8(?:$|\?)/i.test(url) && typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({
        startLevel: -1,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 20,
        manifestLoadingTimeOut: 8000,
        levelLoadingTimeOut: 8000,
        fragLoadingTimeOut: 12000,
        manifestLoadingMaxRetry: 1,
        levelLoadingMaxRetry: 1,
        fragLoadingMaxRetry: 1,
        lowLatencyMode: false,
      });
      this.hls = hls;
      // Referer is a browser-controlled header; setting it in xhrSetup is forbidden.
      hls.on(Hls.Events.MANIFEST_PARSED, beginPlayback);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!current() || this.hls !== hls || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.retryCount < 1) {
          this.retryCount++;
          hls.recoverMediaError();
          armTimeout();
        } else {
          this.failPlayback(data.type === Hls.ErrorTypes.NETWORK_ERROR ? '视频网络请求失败，请切换线路' : '视频解码失败，请切换线路');
        }
      });
      hls.attachMedia(video);
      hls.loadSource(url);
    } else {
      video.addEventListener('loadedmetadata', beginPlayback, { ...options, once: true });
      video.addEventListener('error', () => { if (current()) this.failPlayback('视频地址不可用或格式不受支持'); }, options);
      video.src = url;
      video.load();
    }
  },

  hideLoading() {
    const loading = document.getElementById('player-loading');
    if (loading) loading.style.display = 'none';
  },

  showError(message) {
    this.clearPlayingTimeout();
    this.hideLoading();
    const errorEl = document.getElementById('player-error');
    if (!errorEl) return;

    const msgEl = errorEl.querySelector('.error-msg');
    if (msgEl) msgEl.textContent = message;
    errorEl.style.display = 'block';
  },

  hideError() {
    const errorEl = document.getElementById('player-error');
    if (errorEl) errorEl.style.display = 'none';
  },

  cleanup() {
    if (document.fullscreenElement && this.container?.contains(document.fullscreenElement)) {
      document.exitFullscreen().catch(() => {});
    }
    this.sessionId++;
    this.requestId++;
    clearTimeout(this.controlsTimer);
    clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.listeners.splice(0).forEach(remove => remove());
    document.body.classList.remove('player-mode');
    this.clearPlayingTimeout();
    this.cleanupHls();
    this.drawerOpen = false;
  },
};
