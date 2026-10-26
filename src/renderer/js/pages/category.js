/* ===== 分类浏览页 ===== */
const YEARS = Array.from({ length: new Date().getFullYear() - 1899 }, (_, i) => String(new Date().getFullYear() - i));
const TYPES = [
  { id: '', label: '全部' },
  { id: 'tv', label: 'TV' },
  { id: 'movie', label: '剧场版' },
  { id: 'ova', label: 'OVA' },
];
const SORTS = [
  { id: 'heat', label: '热门' },
  { id: 'score', label: '评分' },
];

const CategoryPage = {
  container: null,
  filters: { year: '', type: '', sort: 'heat' },
  state: null,

  init() {
    this.container = document.getElementById('page-category');
  },

  async load() {
    this.render();
    await this.doSearch();
  },

  render() {
    this.container.innerHTML = `
      <div class="home-container">
        <div class="section-header" style="margin-bottom:20px">
          <div class="section-title">分类浏览</div>
        </div>
        <div class="category-filters">
          <div class="filter-group">
            <label class="filter-label" for="filter-year">年份</label>
            <select class="filter-year-select" id="filter-year">
              <option value=""${!this.filters.year ? ' selected' : ''}>全部年份</option>
              ${YEARS.map(year => `<option value="${year}"${year === this.filters.year ? ' selected' : ''}>${year}</option>`).join('')}
            </select>
          </div>
          <div class="filter-group">
            <span class="filter-label">类型</span>
            <div class="filter-options" id="filter-type">
              ${TYPES.map(type => `<button class="filter-chip${type.id === this.filters.type ? ' active' : ''}" data-value="${type.id}">${type.label}</button>`).join('')}
            </div>
          </div>
          <div class="filter-group">
            <span class="filter-label">排序</span>
            <div class="filter-options" id="filter-sort">
              ${SORTS.map(sort => `<button class="filter-chip${sort.id === this.filters.sort ? ' active' : ''}" data-value="${sort.id}">${sort.label}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="results-grid" id="category-grid"></div>
        <div class="catalog-controls" id="category-controls" aria-live="polite"></div>
      </div>`;

    document.getElementById('filter-year').addEventListener('change', event => {
      this.filters.year = event.target.value;
      this.doSearch();
    });
    ['type', 'sort'].forEach(key => {
      document.getElementById(`filter-${key}`).querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          if (this.filters[key] === chip.dataset.value) return;
          document.getElementById(`filter-${key}`).querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          this.filters[key] = chip.dataset.value;
          this.doSearch();
        });
      });
    });
  },

  async doSearch(append = false) {
    let state = this.state;
    if (append && (!state || state.loading || !state.hasMore)) return;
    if (!append) state = this.state = { ...CatalogView.createState(), filters: { ...this.filters } };
    state.loading = true;
    state.error = false;
    state.errorMessage = '';
    const grid = document.getElementById('category-grid');
    const controls = document.getElementById('category-controls');
    if (!append) grid.innerHTML = Array(6).fill('<div class="skeleton skeleton-card"></div>').join('');
    CatalogView.controls(controls, state, () => this.doSearch(true));
    const page = state.page + 1;
    try {
      const result = await window.api.searchCategory({ ...state.filters, page, limit: state.limit });
      if (this.state !== state) return;
      const data = CatalogView.pageResult(result);
      if (!append) grid.innerHTML = '';
      CatalogView.appendCards(grid, data.items, state, anime => this.openDetail(anime.id));
      state.page = page;
      state.total = data.total;
      state.hasMore = Boolean(data.hasMore) && data.items.length > 0;
      if (!state.ids.size) CatalogView.message(grid, '该分类暂无数据，请尝试其他筛选条件');
    } catch (error) {
      if (this.state !== state) return;
      state.error = true;
      state.errorMessage = CatalogView.errorMessage(error);
      if (!append) CatalogView.message(grid, state.errorMessage, () => this.doSearch());
    } finally {
      if (this.state === state) {
        state.loading = false;
        CatalogView.controls(controls, state, () => this.doSearch(true));
      }
    }
  },

  openDetail(id) {
    Router.navigate('detail', { id });
  },
};
