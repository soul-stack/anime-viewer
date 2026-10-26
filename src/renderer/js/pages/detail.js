/* ===== 详情页 v2 ===== */
const EPISODES_PER_PAGE = 50;

const DetailPage = {
  container: null,
  currentAnime: null,
  watchHistory: null,
  episodePage: 1,
  showPlayableOnly: false,
  episodePlayableCache: null,
  loadId: 0,
  sourceRequestId: 0,
  sourceEpisodes: null,
  episodesRequest: null,
  topbarScrollContent: null,
  topbarScrollHandler: null,

  init() {
    this.container = document.getElementById('page-detail');
  },

  async load(animeId) {
    const loadId = ++this.loadId;
    this.sourceRequestId++;
    this.clearTopbarScroll();
    this.container.innerHTML = '<div class="loading-spinner">加载中...</div>';
    this.currentAnime = null;
    this.watchHistory = null;

    try {
      const [anime, history] = await Promise.all([
        window.api.getDetail(animeId),
        window.api.getHistory().catch(() => []),
      ]);

      if (loadId !== this.loadId) return;
      if (!anime || anime.error) {
        this.container.innerHTML = '<div class="empty-state"><div class="empty-icon"> :( </div><p>加载失败</p></div>';
        return;
      }

      this.currentAnime = anime;
      // 查找该番剧的播放历史
      this.watchHistory = (history || []).filter(h => h.animeId === anime.id);
      this.render(anime);
      if (anime.episodesHasMore) this.loadRemainingEpisodes(anime);
    } catch (e) {
      if (loadId !== this.loadId) return;
      this.container.innerHTML = `<div class="empty-state"><div class="empty-icon"> :( </div><p>加载失败: ${e.message}</p></div>`;
    }
  },

  render(anime) {
    const bgImage = anime.coverLarge || anime.cover;

    this.container.innerHTML = `
      <div class="detail-container">
        <!-- 顶部栏始终是内容区的第一个流内元素 -->
        <div class="detail-topbar" id="detail-topbar">
          <button class="detail-back-btn" id="detail-back-btn">← 返回</button>
          <div class="detail-top-actions"></div>
        </div>

        <!-- 沉浸式背景 -->
        <div class="detail-bg" aria-hidden="true">
          <img class="detail-bg-img" src="${bgImage}" alt="" onerror="this.style.display='none'">
          <div class="detail-bg-overlay"></div>
          <div class="detail-bg-gradient"></div>
        </div>

        <!-- 内容区 -->
        <div class="detail-content">
          <div class="detail-info-row">
            <img class="detail-cover" src="${bgImage}" alt="${anime.titleCn || anime.title}"
              onerror="this.style.display='none'">
            <div class="detail-meta">
              <div class="detail-title">${anime.titleCn || anime.title}</div>
              ${anime.titleCn ? `<div class="detail-title-sub">${anime.title}</div>` : ''}

              <div class="detail-stats">
                ${anime.score > 0 ? `
                  <div class="detail-stat-item">
                    <span class="stat-icon">★</span>
                    <span>评分 <span class="stat-value">${anime.score.toFixed(1)}</span></span>
                  </div>
                ` : ''}
                ${anime.rank > 0 ? `
                  <div class="detail-stat-item">
                    <span>排名 <span class="stat-value">#${anime.rank}</span></span>
                  </div>
                ` : ''}
                ${anime.airDate ? `
                  <div class="detail-stat-item">
                    <span>放送 <span class="stat-value">${anime.airDate}</span></span>
                  </div>
                ` : ''}
                <div class="detail-stat-item">
                  <span>剧集 <span class="stat-value">${anime.totalEpisodes}</span></span>
                </div>
              </div>

              ${anime.tags.length > 0 ? `
                <div class="detail-tags">
                  ${anime.tags.map(t => `<span class="detail-tag">${t}</span>`).join('')}
                </div>
              ` : ''}

              <div class="detail-summary" id="detail-summary">${anime.summary || '暂无简介'}</div>
              ${anime.summary && anime.summary.length > 100 ? `
                <button class="detail-summary-toggle" id="summary-toggle">展开更多</button>
              ` : ''}
            </div>
          </div>

          <!-- 上次观看提示 -->
          <div id="detail-resume-container"></div>

          <!-- 操作按钮 -->
          <div class="detail-actions">
            ${anime.episodes.length > 0 ? `
              <button class="btn btn-play" id="btn-continue-play">
                ▶ ${this.watchHistory && this.watchHistory.length > 0 ? '继续播放' : '开始观看'}
              </button>
            ` : ''}
            <button class="btn btn-fav" id="btn-favorite">♡ 收藏</button>
          </div>

          <!-- 剧集列表 -->
          <div class="episodes-section">
            <div class="section-header">
              <div class="section-title">剧集列表 <span class="ep-count">共 ${anime.episodes.length} 集</span></div>
              <div class="section-header-actions">
                <label class="ep-toggle-label" id="playable-toggle-wrap" style="display:none">
                  <span class="ep-toggle-text">只看源站已收录</span>
                  <input type="checkbox" id="toggle-playable-only">
                  <span class="ep-toggle-switch"></span>
                </label>
                <button class="ep-jump-btn" id="btn-refresh-sources" title="刷新播放源">⟳ 刷新源</button>
                <button class="ep-jump-btn" id="btn-jump-latest"${anime.episodes.length <= EPISODES_PER_PAGE ? ' style="display:none"' : ''}>跳到最新</button>
              </div>
            </div>
            <p id="episode-load-status" role="status"></p>
            <p id="source-status" role="status"></p>
            <div class="episodes-grid" id="episodes-grid"></div>
            <div class="ep-pagination" id="ep-pagination"></div>
          </div>
        </div>
      </div>
    `;

    this.updateEpisodeLoadStatus(anime);
    this.episodePage = 1;
    this.episodePlayableCache = null;
    this.sourceEpisodes = null;
    this.showPlayableOnly = false;
    this.bindEvents(anime);
    this.checkFavorite(anime.id);
    this.renderResumeBar(anime);
    this.initTopbarScroll();
    this.renderEpisodePage(anime);
    this.checkEpisodePlayable(anime);
  },

  episodeCountText(anime) {
    const loaded = (anime.episodes || []).length;
    const total = Math.max(loaded, Number(anime.episodesTotal) || loaded);
    return anime.episodesHasMore || anime.episodesError
      ? '已加载 ' + loaded + ' / ' + total + ' 集'
      : '共 ' + loaded + ' 集';
  },

  updateEpisodeLoadStatus(anime, loading = false) {
    const status = document.getElementById('episode-load-status');
    if (status) {
      status.textContent = loading
        ? this.episodeCountText(anime) + '，正在补全剩余剧集...'
        : anime.episodesError ? this.episodeCountText(anime) + '；剩余剧集加载失败：' + anime.episodesError + ' ' : '';
      if (!loading && anime.episodesError) {
        const retry = document.createElement('button');
        retry.className = 'ep-jump-btn';
        retry.textContent = '重试剩余剧集';
        retry.addEventListener('click', () => this.loadRemainingEpisodes(anime));
        status.appendChild(retry);
      }
    }
    const jump = document.getElementById('btn-jump-latest');
    if (jump) {
      jump.style.display = (anime.episodes || []).length > EPISODES_PER_PAGE || Number(anime.episodesTotal) > EPISODES_PER_PAGE ? '' : 'none';
      jump.disabled = loading || !!anime.episodesHasMore || !!anime.episodesError;
      jump.textContent = jump.disabled ? '补全后跳到最新' : '跳到最新';
    }
    const count = document.querySelector('.ep-count');
    if (count && !this.showPlayableOnly) count.textContent = this.episodeCountText(anime);
  },

  loadRemainingEpisodes(anime) {
    const loadId = this.loadId;
    if (this.currentAnime !== anime) return Promise.resolve();
    if (this.episodesRequest?.anime === anime && this.episodesRequest.loadId === loadId) return this.episodesRequest.promise;
    this.updateEpisodeLoadStatus(anime, true);
    const request = { anime, loadId, promise: null };
    this.episodesRequest = request;
    request.promise = Promise.resolve().then(() => window.api.getEpisodes(anime.id)).then(episodes => {
      if (loadId !== this.loadId || this.currentAnime !== anime) return;
      if (!Array.isArray(episodes) || episodes.length < (anime.episodes || []).length) throw new Error('未取得完整剧集列表，请重试');
      anime.episodes = episodes;
      anime.episodesHasMore = false;
      anime.episodesError = '';
      anime.episodesTotal = episodes.length;
      if (this.sourceEpisodes) {
        this.episodePlayableCache = new Map(episodes.map(episode => [Number(episode.ep), this.sourceEpisodes.has(Number(episode.ep))]));
      }
      // Update only the list, preserving pagination, favorite state and the one source lookup.
      this.renderEpisodePage(anime);
      this.updateEpisodeLoadStatus(anime);
      const actions = this.container?.querySelector('.detail-actions');
      if (episodes.length && actions && !document.getElementById('btn-continue-play')) {
        const play = document.createElement('button');
        play.id = 'btn-continue-play';
        play.className = 'btn btn-play';
        play.textContent = '▶ 开始观看';
        play.addEventListener('click', () => this.playEpisode(anime, this.watchHistory?.[0]?.episode ?? anime.episodes[0].ep));
        actions.prepend(play);
      }
    }).catch(error => {
      if (loadId !== this.loadId || this.currentAnime !== anime) return;
      anime.episodesError = error.message || '请求失败';
      this.updateEpisodeLoadStatus(anime);
    }).finally(() => {
      if (this.episodesRequest === request) this.episodesRequest = null;
    });
    return request.promise;
  },

  renderResumeBar(anime) {
    const container = document.getElementById('detail-resume-container');
    if (!this.watchHistory || this.watchHistory.length === 0) {
      container.innerHTML = '';
      return;
    }

    const last = this.watchHistory[0];
    const progressPct = last.duration > 0 ? Math.min(100, Math.round((last.progress / last.duration) * 100)) : 0;
    container.innerHTML = `
      <div class="detail-resume" id="resume-bar">
        <span class="resume-icon">◎</span>
        <span class="resume-text">
          上次看到 <strong>第${last.episode}集</strong>
          ${last.progress ? ` · ${Math.floor(last.progress / 60)}:${String(Math.floor(last.progress % 60)).padStart(2, '0')}` : ''}
        </span>
        <span class="resume-arrow">→ 继续播放</span>
        <div class="resume-progress-bar">
          <div class="resume-progress-fill" style="width:${progressPct}%"></div>
        </div>
      </div>
    `;

    document.getElementById('resume-bar').addEventListener('click', () => {
      this.playEpisode(anime, last.episode, last.episodeName);
    });
  },

  // Fetch the source's catalogue once instead of searching "title + episode" fifty times.
  async checkEpisodePlayable(anime, forceRefresh = false) {
    const requestId = ++this.sourceRequestId;
    const status = document.getElementById('source-status');
    if (status) status.textContent = '正在查询源站剧集目录...';
    try {
      const result = await window.api.getSourceEpisodes(anime.titleCn || anime.title, { forceRefresh });
      if (requestId !== this.sourceRequestId || this.currentAnime !== anime) return false;
      if (result?.error || !Array.isArray(result?.episodes)) {
        if (status) status.textContent = result?.error || '源站目录暂时不可用，可点击剧集重试播放';
        // An unreachable server is unknown, not proof that all episodes are unavailable.
        return false;
      }
      const available = new Set(result.episodes.map(Number));
      this.sourceEpisodes = available;
      this.episodePlayableCache = new Map((anime.episodes || []).map(episode => [Number(episode.ep), available.has(Number(episode.ep))]));
      const toggle = document.getElementById('playable-toggle-wrap');
      if (toggle) toggle.style.display = 'flex';
      if (status) status.textContent = '源站已收录 ' + available.size + ' 集；播放时检查线路是否可用';
      this.renderEpisodePage(anime);
      return true;
    } catch (error) {
      if (requestId !== this.sourceRequestId || this.currentAnime !== anime) return false;
      if (status) status.textContent = '源站目录查询失败：' + error.message;
      return false;
    }
  },

  renderEpisodePage(anime) {
    const grid = document.getElementById('episodes-grid');
    const pagination = document.getElementById('ep-pagination');
    if (!grid) return;

    let episodes = anime.episodes || [];

    // 可播放过滤
    const showFiltered = this.showPlayableOnly && this.episodePlayableCache;
    if (showFiltered) {
      episodes = episodes.filter(ep => this.episodePlayableCache.get(ep.ep) !== false);
    }

    const totalPages = Math.max(1, Math.ceil(episodes.length / EPISODES_PER_PAGE));

    // 调整当前页不超过总页数
    if (this.episodePage > totalPages) this.episodePage = totalPages;

    const start = (this.episodePage - 1) * EPISODES_PER_PAGE;
    const pageItems = episodes.slice(start, start + EPISODES_PER_PAGE);

    if (episodes.length === 0) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:30px"><p>暂无剧集信息</p></div>';
      if (pagination) pagination.innerHTML = '';
      return;
    }

    // 更新集数显示
    const countEl = document.querySelector('.ep-count');
    if (countEl) {
      countEl.textContent = showFiltered ? `共 ${episodes.length} 集（源站已收录）` : this.episodeCountText(anime);
    }

    // 渲染当前页剧集
    grid.innerHTML = pageItems.map(ep => {
      const watched = this.watchHistory ? this.watchHistory.some(w => w.episode === ep.ep) : false;
      const isResume = this.watchHistory && this.watchHistory.length > 0
        && ep.ep === this.watchHistory[0].episode;
      const hasSource = this.episodePlayableCache ? this.episodePlayableCache.get(ep.ep) : undefined;
      return `
        <div class="episode-item${watched ? ' watched' : ''}${isResume ? ' current' : ''}${hasSource === false ? ' no-source' : ''}"
          data-ep="${ep.ep}" data-name="${ep.nameCn || ep.name}">
          <div class="ep-num">${ep.ep}</div>
          <div class="ep-name">${ep.nameCn || ep.name || ''}</div>
          ${hasSource === false ? '<div class="ep-no-source">源站未收录</div>' : ''}
        </div>
      `;
    }).join('');

    // 剧集点击事件
    grid.querySelectorAll('.episode-item').forEach(item => {
      item.addEventListener('click', () => {
        const ep = Number(item.dataset.ep);
        const name = item.dataset.name;
        this.playEpisode(anime, ep, name);
      });
    });

    // 分页导航
    if (pagination && totalPages > 1) {
      let pagHtml = '';
      // 上一页
      pagHtml += `<button class="ep-page-btn" data-page="${this.episodePage - 1}" ${this.episodePage <= 1 ? 'disabled' : ''}>◀</button>`;

      // 页码
      const range = 2; // 当前页前后显示页数
      const startPage = Math.max(1, this.episodePage - range);
      const endPage = Math.min(totalPages, this.episodePage + range);

      if (startPage > 1) {
        pagHtml += `<button class="ep-page-btn" data-page="1">1</button>`;
        if (startPage > 2) pagHtml += `<span class="ep-page-ellipsis">...</span>`;
      }

      for (let p = startPage; p <= endPage; p++) {
        pagHtml += `<button class="ep-page-btn${p === this.episodePage ? ' active' : ''}" data-page="${p}">${p}</button>`;
      }

      if (endPage < totalPages) {
        if (endPage < totalPages - 1) pagHtml += `<span class="ep-page-ellipsis">...</span>`;
        pagHtml += `<button class="ep-page-btn" data-page="${totalPages}">${totalPages}</button>`;
      }

      // 下一页
      pagHtml += `<button class="ep-page-btn" data-page="${this.episodePage + 1}" ${this.episodePage >= totalPages ? 'disabled' : ''}>▶</button>`;

      pagination.innerHTML = pagHtml;

      // 分页点击事件
      pagination.querySelectorAll('.ep-page-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => {
          const page = parseInt(btn.dataset.page);
          if (page >= 1 && page <= totalPages) {
            this.episodePage = page;
            this.renderEpisodePage(anime);
          }
        });
      });
    } else if (pagination) {
      pagination.innerHTML = '';
    }
  },

  clearTopbarScroll() {
    if (this.topbarScrollContent && this.topbarScrollHandler) {
      this.topbarScrollContent.removeEventListener('scroll', this.topbarScrollHandler);
    }
    this.topbarScrollContent = null;
    this.topbarScrollHandler = null;
  },

  initTopbarScroll() {
    this.clearTopbarScroll();
    const topbar = document.getElementById('detail-topbar');
    const content = document.getElementById('content');
    if (!topbar || !content) return;
    const handler = () => {
      topbar.classList.toggle('scrolled', content.scrollTop > 50);
    };
    this.topbarScrollContent = content;
    this.topbarScrollHandler = handler;
    content.addEventListener('scroll', handler, { passive: true });
    handler();
  },

  bindEvents(anime) {
    // 返回
    document.getElementById('detail-back-btn').addEventListener('click', () => {
      Router.navigate('home');
    });

    // 展开简介
    const toggle = document.getElementById('summary-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const summary = document.getElementById('detail-summary');
        summary.classList.toggle('expanded');
        toggle.textContent = summary.classList.contains('expanded') ? '收起' : '展开更多';
      });
    }

    // 继续播放
    const playBtn = document.getElementById('btn-continue-play');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        const resumeEp = this.watchHistory && this.watchHistory.length > 0
          ? this.watchHistory[0].episode : (anime.episodes[0]?.ep ?? 1);
        this.playEpisode(anime, resumeEp);
      });
    }

    // 收藏
    document.getElementById('btn-favorite').addEventListener('click', async () => {
      const btn = document.getElementById('btn-favorite');
      const isFav = await window.api.isFavorite(anime.id);
      if (isFav) {
        await window.api.removeFavorite(anime.id);
        btn.textContent = '♡ 收藏';
        btn.classList.remove('favorited');
        Toast.info('已取消收藏');
      } else {
        await window.api.addFavorite({
          id: anime.id, title: anime.title, titleCn: anime.titleCn,
          cover: anime.cover, score: anime.score,
        });
        btn.textContent = '♥ 已收藏';
        btn.classList.add('favorited');
        Toast.success('已收藏');
      }
    });

    // "只看可播放" 切换
    const toggleCheck = document.getElementById('toggle-playable-only');
    if (toggleCheck) {
      toggleCheck.addEventListener('change', () => {
        this.showPlayableOnly = toggleCheck.checked;
        this.episodePage = 1;
        this.renderEpisodePage(anime);
      });
    }

    // "刷新播放源" 按钮
    const refreshBtn = document.getElementById('btn-refresh-sources');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.textContent = '⟳ 刷新中...';
        refreshBtn.disabled = true;
        this.episodePlayableCache = null;
        const refreshed = await this.checkEpisodePlayable(anime, true);
        if (this.currentAnime !== anime) return;
        this.renderEpisodePage(anime);
        refreshBtn.textContent = '⟳ 刷新源';
        refreshBtn.disabled = false;
        if (refreshed) Toast.success('播放源目录已刷新');
        else Toast.info('源站目录暂不可用，请稍后重试');
      });
    }

    // "跳到最新" 按钮
    const jumpBtn = document.getElementById('btn-jump-latest');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        const totalPages = Math.ceil((anime.episodes || []).length / EPISODES_PER_PAGE);
        this.episodePage = totalPages;
        this.renderEpisodePage(anime);
        // 滚动到剧集区域
        document.querySelector('.episodes-section')?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  },

  playEpisode(anime, episode, episodeName) {
    Router.navigate('player', {
      animeId: anime.id,
      animeTitle: anime.titleCn || anime.title,
      cover: anime.cover,
      episode: episode,
      episodeName: episodeName || '',
    });
  },

  async checkFavorite(id) {
    try {
      const isFav = await window.api.isFavorite(id);
      if (this.currentAnime?.id !== id) return;
      const btn = document.getElementById('btn-favorite');
      if (btn && isFav) {
        btn.textContent = '♥ 已收藏';
        btn.classList.add('favorited');
      }
    } catch (e) { /* ignore */ }
  },
};
