/* ===== 历史页 v2 ===== */
const HistoryPage = {
  container: null,

  init() {
    this.container = document.getElementById('page-history');
  },

  async load() {
    this.container.innerHTML = '<div class="loading-spinner">加载中...</div>';

    try {
      const history = await window.api.getHistory();
      this.render(history);
    } catch (e) {
      this.container.innerHTML = '<div class="empty-state"><div class="empty-icon"> :( </div><p>加载失败</p></div>';
    }
  },

  render(history) {
    this.container.innerHTML = `
      <div class="home-container">
        <div class="section-header" style="margin-bottom:20px">
          <div class="section-title">观看历史</div>
          ${history.length > 0 ? '<button class="section-more" id="clear-history-btn" style="background:none;border:none;font-family:inherit;cursor:pointer">清空历史</button>' : ''}
        </div>
        ${history.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">◎</div>
            <p>还没有观看记录</p>
            <div class="empty-hint">开始播放视频后自动记录</div>
          </div>
        ` : `
          <div class="results-grid" id="history-grid">
            ${history.map(h => `
              <div class="anime-card" data-id="${h.animeId}" style="cursor:pointer">
                <div class="card-cover-wrap">
                  <img class="card-cover" src="${h.cover || ''}" alt="${h.titleCn || h.title}" loading="lazy"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                  <div class="card-placeholder" style="display:none">🎬</div>
                  <div class="card-overlay"><div class="card-play-btn"></div></div>
                  <div class="card-info">
                    <div class="card-title">${h.titleCn || h.title}</div>
                    <div class="card-sub">第${h.episode}集 · ${new Date(h.watchedAt).toLocaleDateString()}</div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;

    // 清空历史
    const clearBtn = document.getElementById('clear-history-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        await window.api.clearHistory();
        this.render([]);
        Toast.info('历史已清空');
      });
    }

    // 点击卡片
    this.container.querySelectorAll('.anime-card').forEach(card => {
      card.addEventListener('click', () => {
        Router.navigate('detail', { id: card.dataset.id });
      });
    });
  },
};
