/* ===== 收藏页 v2 ===== */
const FavoritesPage = {
  container: null,

  init() {
    this.container = document.getElementById('page-favorites');
  },

  async load() {
    this.container.innerHTML = '<div class="loading-spinner">加载中...</div>';

    try {
      const favorites = await window.api.getFavorites();
      this.render(favorites);
    } catch (e) {
      this.container.innerHTML = '<div class="empty-state"><div class="empty-icon"> :( </div><p>加载失败</p></div>';
    }
  },

  render(favorites) {
    this.container.innerHTML = `
      <div class="home-container">
        <div class="section-header" style="margin-bottom:20px">
          <div class="section-title">我的收藏</div>
          ${favorites.length > 0 ? `<span class="section-more">共 ${favorites.length} 部</span>` : ''}
        </div>
        ${favorites.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">♡</div>
            <p>还没有收藏任何动漫</p>
            <div class="empty-hint">在详情页点击收藏按钮添加</div>
          </div>
        ` : `
          <div class="results-grid" id="fav-grid">
            ${favorites.map(fav => `
              <div class="anime-card" data-id="${fav.id}" style="cursor:pointer">
                <div class="card-cover-wrap">
                  <img class="card-cover" src="${fav.cover || ''}" alt="${fav.titleCn || fav.title}" loading="lazy"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                  <div class="card-placeholder" style="display:none">🎬</div>
                  ${fav.score > 0 ? `<div class="card-score">${fav.score.toFixed(1)}</div>` : ''}
                  <div class="card-overlay"><div class="card-play-btn"></div></div>
                  <div class="card-info">
                    <div class="card-title">${fav.titleCn || fav.title}</div>
                    <div class="card-sub">${new Date(fav.addedAt).toLocaleDateString()}</div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;

    this.container.querySelectorAll('.anime-card').forEach(card => {
      card.addEventListener('click', () => {
        Router.navigate('detail', { id: card.dataset.id });
      });
    });
  },
};
