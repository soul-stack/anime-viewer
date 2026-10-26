function initSidebar() {
  const sidebar = document.getElementById('sidebar');

  const navItems = [
    { id: 'home',      icon: '▦', label: '首页' },
    { id: 'category',  icon: '☰', label: '分类' },
    { id: 'favorites', icon: '♡', label: '收藏' },
    { id: 'history',   icon: '◎', label: '历史' },
  ];

  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <h1>AniView</h1>
      <div class="logo-sub">Bangumi 番组计划</div>
    </div>
    <div class="sidebar-nav">
      ${navItems.map(item => `
        <div class="nav-item${item.id === 'home' ? ' active' : ''}" data-page="${item.id}">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
        </div>
      `).join('')}
    </div>
    <div class="sidebar-footer">
      Bangumi API · <span class="version">v1.0</span>
    </div>
  `;

  sidebar.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      if (page === 'home') {
        Router.navigate('home');
      } else if (page === 'category') {
        Router.navigate('category');
      } else if (page === 'favorites') {
        Router.navigate('favorites');
      } else if (page === 'history') {
        Router.navigate('history');
      }
    });
  });

  // 标题栏按钮
  document.getElementById('btn-minimize').addEventListener('click', () => window.api.minimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.api.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.api.close());
}

function updateSidebarActive(pageId) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === pageId);
  });
}
