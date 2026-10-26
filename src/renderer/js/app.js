// 应用入口
document.addEventListener('DOMContentLoaded', () => {
  // 初始化侧边栏
  initSidebar();

  // 注册页面
  Router.register('home', HomePage);
  Router.register('detail', DetailPage);
  Router.register('player', PlayerPage);
  Router.register('favorites', FavoritesPage);
  Router.register('history', HistoryPage);
  Router.register('category', CategoryPage);

  // 初始化各页面
  HomePage.init();
  DetailPage.init();
  PlayerPage.init();
  FavoritesPage.init();
  HistoryPage.init();
  CategoryPage.init();

  // 默认显示首页
  Router.navigate('home');
});
