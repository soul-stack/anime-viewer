/* Catalogues show metadata immediately; playback sources are resolved on demand. */
const CatalogView = {
  createState() {
    return { page: 0, limit: 20, total: null, hasMore: false, loading: false, error: false, errorMessage: '', ids: new Set() };
  },

  errorMessage(error, fallback = '加载失败，请检查网络后重试') {
    let message = typeof error === 'string' ? error : error?.message;
    if (typeof message !== 'string') return fallback;
    message = message.trim()
      .replace(/^(?:Error:\s*)?Error invoking remote method\s+(['"]).*?\1\s*:\s*/i, '')
      .replace(/^(?:Error:\s*)+/i, '')
      .split(/[\r\n]/, 1)[0].trim();
    // Backend Chinese guidance is safe to show. Raw transport errors, addresses and
    // local stack paths belong in diagnostics, never in the catalogue message.
    const technical = /(?:https?|socks\d?|file):\/\/|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b|\b[a-z]:[\\/]|\\\\|(?:^|\s)\/[\w./-]+|\[[0-9a-f:]+\]|[\w.-]+:\d{2,5}\b|\s+at\s+|\b(?:E[A-Z_]{3,}|ERR_[A-Z_]+|(?:HTTPS?|ALL|NO)_PROXY|FetchError|TypeError|ReferenceError|SyntaxError)\b/i;
    if (!/[\u3400-\u9fff]/.test(message) || technical.test(message)) return fallback;
    return message.slice(0, 240);
  },

  pageResult(result) {
    if (Array.isArray(result)) return { items: result, total: result.length, hasMore: false };
    if (!result || !Array.isArray(result.items)) throw new Error('目录数据格式异常');
    return result;
  },

  appendCards(grid, items, state, onClick, size) {
    items.forEach(anime => {
      const key = String(anime.id);
      if (state.ids.has(key)) return;
      state.ids.add(key);
      grid.appendChild(createAnimeCard(anime, onClick, size));
    });
  },

  message(container, text, retry) {
    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'empty-state catalog-message';
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    box.appendChild(paragraph);
    if (retry) {
      const button = document.createElement('button');
      button.className = 'btn btn-secondary';
      button.textContent = '重新加载';
      button.addEventListener('click', retry);
      box.appendChild(button);
    }
    container.appendChild(box);
  },

  controls(container, state, next) {
    if (!container) return;
    container.innerHTML = '';
    if (!state.ids.size) return;
    const status = document.createElement('span');
    status.className = 'catalog-count';
    status.textContent = Number.isFinite(state.total)
      ? `已显示 ${state.ids.size} / ${state.total} 部`
      : `已显示 ${state.ids.size} 部`;
    container.appendChild(status);
    if (state.error && state.errorMessage) {
      const error = document.createElement('span');
      error.className = 'catalog-count';
      error.setAttribute('role', 'status');
      error.textContent = state.errorMessage;
      container.appendChild(error);
    }
    if (state.loading || state.hasMore || state.error) {
      const button = document.createElement('button');
      button.className = 'btn btn-secondary';
      button.disabled = state.loading;
      button.textContent = state.loading ? '加载中…' : state.error ? '加载失败，点击重试' : '加载更多';
      button.addEventListener('click', next);
      container.appendChild(button);
    }
  },
};

/* ===== 首页 v2 ===== */
const HomePage = {
  container: null,
  bannerTimer: null,
  bannerIndex: 0,
  bannerData: [],
  sections: {},
  searchState: null,
  historyRequest: 0,

  init() {
    this.container = document.getElementById('page-home');
    this.render();
    this.loadData();
  },

  render() {
    if (this.bannerTimer) clearInterval(this.bannerTimer);
    this.sections = {};
    this.searchState = null;
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'home-container';

    // Banner
    const banner = document.createElement('div');
    banner.className = 'banner-section';
    banner.id = 'home-banner';
    banner.style.display = 'none';
    banner.innerHTML = `
      <div class="banner-slides" id="banner-slides"></div>
      <div class="banner-dots" id="banner-dots"></div>
    `;
    wrapper.appendChild(banner);

    // 搜索栏
    const searchBar = createSearchBar((keyword) => this.doSearch(keyword));
    wrapper.appendChild(searchBar);

    // 搜索结果区
    const searchSection = document.createElement('div');
    searchSection.id = 'home-search-results';
    searchSection.style.display = 'none';
    searchSection.innerHTML = `
      <div class="section-header">
        <div class="section-title">搜索结果</div>
        <div class="section-more" id="search-result-count"></div>
      </div>
      <div class="results-grid" id="search-results-grid"></div>
      <div class="catalog-controls" id="search-controls"></div>
    `;
    wrapper.appendChild(searchSection);

    // 继续观看
    const resumeSection = document.createElement('div');
    resumeSection.className = 'home-section';
    resumeSection.id = 'home-resume';
    resumeSection.style.display = 'none';
    resumeSection.innerHTML = `
      <div class="section-header">
        <div class="section-title">继续观看</div>
      </div>
      <div class="scroll-container" id="resume-scroll"></div>
    `;
    wrapper.appendChild(resumeSection);

    // 每日放送
    const calendarSection = document.createElement('div');
    calendarSection.className = 'home-section';
    calendarSection.id = 'home-calendar';
    calendarSection.innerHTML = `
      <div class="section-header">
        <div class="section-title">每日放送</div>
      </div>
      <div class="skeleton-row" id="calendar-skeleton">
        ${Array(6).fill('<div class="skeleton-card"></div>').join('')}
      </div>
      <div class="scroll-container" id="calendar-scroll" style="display:none"></div>
    `;
    wrapper.appendChild(calendarSection);

    // 热门推荐
    const hotSection = document.createElement('div');
    hotSection.className = 'home-section';
    hotSection.id = 'home-hot';
    hotSection.innerHTML = `
      <div class="section-header">
        <div class="section-title">热门推荐</div>
      </div>
      <div class="skeleton-row" id="hot-skeleton">
        ${Array(6).fill('<div class="skeleton-card"></div>').join('')}
      </div>
      <div class="results-grid" id="hot-grid" style="display:none"></div>
      <div class="catalog-controls" id="hot-controls"></div>
    `;
    wrapper.appendChild(hotSection);

    // 新番推荐
    const newSection = document.createElement('div');
    newSection.className = 'home-section';
    newSection.id = 'home-new';
    newSection.innerHTML = `
      <div class="section-header">
        <div class="section-title">新番推荐</div>
      </div>
      <div class="skeleton-row" id="new-skeleton">
        ${Array(6).fill('<div class="skeleton-card"></div>').join('')}
      </div>
      <div class="results-grid" id="new-grid" style="display:none"></div>
      <div class="catalog-controls" id="new-controls"></div>
    `;
    wrapper.appendChild(newSection);

    // 高分榜
    const topSection = document.createElement('div');
    topSection.className = 'home-section';
    topSection.id = 'home-top';
    topSection.innerHTML = `
      <div class="section-header">
        <div class="section-title">高分榜</div>
      </div>
      <div class="skeleton-row" id="top-skeleton">
        ${Array(6).fill('<div class="skeleton-card"></div>').join('')}
      </div>
      <div class="results-grid" id="top-grid" style="display:none"></div>
      <div class="catalog-controls" id="top-controls"></div>
    `;
    wrapper.appendChild(topSection);

    this.container.appendChild(wrapper);
  },

  loadData() {
    // Every request renders its own section immediately, without waiting for slower requests.
    return Promise.allSettled([
      this.loadHistory(),
      ...['calendar', 'hot', 'new', 'top'].map(id => this.loadSection(id)),
    ]);
  },

  async loadHistory() {
    const request = ++this.historyRequest;
    try {
      const history = await window.api.getHistory();
      if (request !== this.historyRequest) return;
      if (history.length) this.renderResume(history.slice(0, 6));
      else document.getElementById('home-resume').style.display = 'none';
    } catch (error) {
      if (request !== this.historyRequest) return;
      document.getElementById('home-resume').style.display = 'block';
      CatalogView.message(document.getElementById('resume-scroll'), CatalogView.errorMessage(error, '观看记录加载失败，请重试'), () => this.loadHistory());
    }
  },

  async loadSection(id, append = false) {
    let state = this.sections[id];
    if (append && (!state || state.loading || !state.hasMore)) return;
    if (!append) state = this.sections[id] = CatalogView.createState();
    state.loading = true;
    state.error = false;
    state.errorMessage = '';
    const grid = document.getElementById(id === 'calendar' ? 'calendar-scroll' : `${id}-grid`);
    const skeleton = document.getElementById(`${id}-skeleton`);
    const controls = document.getElementById(`${id}-controls`);
    if (!append) {
      grid.innerHTML = '';
      grid.style.display = 'none';
      skeleton.style.display = 'flex';
    }
    CatalogView.controls(controls, state, () => this.loadSection(id, true));
    const page = state.page + 1;
    const options = { page, limit: state.limit };
    try {
      let result;
      if (id === 'calendar') result = await window.api.getCalendar();
      else if (id === 'hot') result = await window.api.getHot(options);
      else result = await window.api.searchCategory({
        ...options,
        ...(id === 'new' ? { year: String(new Date().getFullYear()), sort: 'heat' } : { sort: 'score' }),
      });
      if (this.sections[id] !== state) return;
      const data = CatalogView.pageResult(result);
      CatalogView.appendCards(grid, data.items, state, anime => this.openDetail(anime.id), id === 'calendar' ? 'small' : undefined);
      state.page = page;
      state.total = data.total;
      state.hasMore = Boolean(data.hasMore) && data.items.length > 0;
      if (!state.ids.size) CatalogView.message(grid, '暂无数据', () => this.loadSection(id));
      if (id === 'hot' && !append && data.items.length) this.setupBanner(data.items.slice(0, 5));
    } catch (error) {
      if (this.sections[id] !== state) return;
      state.error = true;
      state.errorMessage = CatalogView.errorMessage(error);
      if (!append) CatalogView.message(grid, state.errorMessage, () => this.loadSection(id));
    } finally {
      if (this.sections[id] === state) {
        state.loading = false;
        skeleton.style.display = 'none';
        grid.style.display = id === 'calendar' ? 'flex' : 'grid';
        CatalogView.controls(controls, state, () => this.loadSection(id, true));
      }
    }
  },

  renderResume(history) {
    const section = document.getElementById('home-resume');
    const scroll = document.getElementById('resume-scroll');
    section.style.display = 'block';
    scroll.innerHTML = '';
    history.forEach(h => {
      const card = createAnimeCard({
        id: h.animeId,
        title: h.title,
        titleCn: h.titleCn,
        cover: h.cover,
        score: 0,
        summary: `上次看到第${h.episode}集`,
      }, () => this.openDetail(h.animeId), 'small');
      scroll.appendChild(card);
    });
  },

  setupBanner(items) {
    this.bannerData = items;
    this.bannerIndex = 0;
    document.getElementById('home-banner').style.display = 'block';
    const slides = document.getElementById('banner-slides');
    const dots = document.getElementById('banner-dots');
    if (!slides || items.length === 0) return;

    slides.innerHTML = items.map((item, i) => `
      <div class="banner-slide${i === 0 ? ' active' : ''}" data-index="${i}">
        <div class="banner-bg" style="background-image:url('${item.cover || ''}')"></div>
        <div class="banner-content">
          <img class="banner-poster" src="${item.cover || ''}" alt="${item.titleCn || item.title}" loading="lazy"
            onerror="this.style.display='none'">
          <div class="banner-info">
            <h2>${item.titleCn || item.title}</h2>
            <div class="banner-sub">${item.airDate || ''} · 评分 ${(item.score || 0).toFixed(1)}</div>
            <div class="banner-desc">${(item.summary || '').slice(0, 120)}</div>
            <button class="banner-btn" data-id="${item.id}">查看详情</button>
          </div>
        </div>
      </div>
    `).join('');

    dots.innerHTML = items.map((_, i) =>
      `<button class="banner-dot${i === 0 ? ' active' : ''}" data-index="${i}"></button>`
    ).join('');

    // 点击事件
    slides.querySelectorAll('.banner-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openDetail(btn.dataset.id);
      });
    });

    slides.querySelectorAll('.banner-slide').forEach(slide => {
      slide.addEventListener('click', () => {
        this.openDetail(items[parseInt(slide.dataset.index)].id);
      });
    });

    dots.querySelectorAll('.banner-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        this.goToBanner(parseInt(dot.dataset.index));
      });
    });

    this.startBannerAutoPlay();
  },

  goToBanner(index) {
    if (index === this.bannerIndex) return;
    const slides = document.querySelectorAll('.banner-slide');
    const dots = document.querySelectorAll('.banner-dot');
    if (!slides[index] || !dots[index]) return;
    slides.forEach(s => s.classList.remove('active'));
    dots.forEach(d => d.classList.remove('active'));
    slides[index].classList.add('active');
    dots[index].classList.add('active');
    this.bannerIndex = index;
  },

  startBannerAutoPlay() {
    if (this.bannerTimer) clearInterval(this.bannerTimer);
    if (this.bannerData.length < 2) return;
    this.bannerTimer = setInterval(() => {
      const next = (this.bannerIndex + 1) % this.bannerData.length;
      this.goToBanner(next);
    }, 5000);
  },

  async doSearch(keyword, append = false) {
    keyword = String(keyword || '').trim();
    if (!keyword) return;
    let state = this.searchState;
    if (append && (!state || state.keyword !== keyword || state.loading || !state.hasMore)) return;
    if (!append) {
      state = this.searchState = { ...CatalogView.createState(), keyword };
      if (this.bannerTimer) clearInterval(this.bannerTimer);
    }
    state.loading = true;
    state.error = false;
    state.errorMessage = '';
    const section = document.getElementById('home-search-results');
    const grid = document.getElementById('search-results-grid');
    const count = document.getElementById('search-result-count');
    const controls = document.getElementById('search-controls');
    section.style.display = 'block';
    if (!append) {
      count.textContent = `搜索: ${keyword}`;
      grid.innerHTML = '<div class="loading-spinner catalog-message">搜索中…</div>';
    }
    CatalogView.controls(controls, state, () => this.doSearch(keyword, true));
    const page = state.page + 1;
    try {
      // The service owns the page-aware cache; legacy cached arrays may be incomplete.
      const result = await window.api.searchAnime(keyword, { page, limit: state.limit });
      if (this.searchState !== state) return;
      const data = CatalogView.pageResult(result);
      if (!append) grid.innerHTML = '';
      CatalogView.appendCards(grid, data.items, state, anime => this.openDetail(anime.id));
      state.page = page;
      state.total = data.total;
      state.hasMore = Boolean(data.hasMore) && data.items.length > 0;
      count.textContent = Number.isFinite(data.total) ? `找到 ${data.total} 个结果` : `已找到 ${state.ids.size} 个结果`;
      if (!state.ids.size) CatalogView.message(grid, '没有找到相关结果，试试其他关键词');
    } catch (error) {
      if (this.searchState !== state) return;
      state.error = true;
      state.errorMessage = CatalogView.errorMessage(error, '搜索失败，请检查网络后重试');
      if (!append) {
        count.textContent = `搜索: ${keyword}`;
        CatalogView.message(grid, state.errorMessage, () => this.doSearch(keyword));
      }
    } finally {
      if (this.searchState === state) {
        state.loading = false;
        CatalogView.controls(controls, state, () => this.doSearch(keyword, true));
      }
    }
  },

  openDetail(id) {
    if (this.bannerTimer) clearInterval(this.bannerTimer);
    Router.navigate('detail', { id });
  },
};
