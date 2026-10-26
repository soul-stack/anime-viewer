const Router = {
  currentPage: 'home',
  pages: {},

  register(id, handler) {
    this.pages[id] = handler;
  },

  navigate(pageId, params = {}) {
    if (this.currentPage === 'player' && pageId !== 'player') {
      this.pages.player?.cleanup();
    }
    // 隐藏所有页面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    // 显示目标页面
    const page = document.getElementById(`page-${pageId}`);
    if (page) page.classList.add('active');

    // Pages share one scroll container; a previous page's offset must not crop the next view.
    const content = document.getElementById('content');
    if (content) content.scrollTop = 0;

    // 更新侧边栏
    updateSidebarActive(pageId);

    // 页面切换逻辑
    const handler = this.pages[pageId];
    if (handler && handler.load) {
      handler.load(params.id || params);
    }

    // 特殊处理播放器页面
    if (pageId === 'player' && this.pages.player) {
      this.pages.player.play(params);
    }

    if (content) content.scrollTop = 0;

    this.currentPage = pageId;
  },
};
