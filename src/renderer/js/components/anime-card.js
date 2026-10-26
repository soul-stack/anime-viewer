/* ===== 现代化动漫卡片 v2 ===== */
(function() {
  const styleId = 'anime-card-styles-v2';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .anime-card {
      position: relative;
      border-radius: var(--radius);
      overflow: hidden;
      cursor: pointer;
      background: var(--bg-card);
      transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1),
                  box-shadow 0.3s ease;
      width: 100%;
      aspect-ratio: 3/4;
    }

    .anime-card:hover {
      transform: translateY(-6px) scale(1.02);
      box-shadow: 0 12px 40px rgba(0,0,0,0.5), 0 0 30px var(--accent-glow);
      z-index: 2;
    }

    .anime-card .card-cover-wrap {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    .anime-card .card-cover {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.5s ease;
    }

    .anime-card:hover .card-cover {
      transform: scale(1.08);
    }

    .anime-card .card-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg-card);
      color: var(--text-muted);
      font-size: 32px;
    }

    .anime-card .card-score {
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(6px);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      font-size: 12px;
      font-weight: 700;
      color: var(--warning);
      display: flex;
      align-items: center;
      gap: 3px;
      z-index: 2;
    }

    .anime-card .card-score::before {
      content: '\\2605';
      font-size: 11px;
    }

    .anime-card .card-ep-badge {
      position: absolute;
      top: 8px;
      left: 8px;
      background: var(--accent);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: 600;
      color: #fff;
      z-index: 2;
    }

    .anime-card .card-info {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 40px 12px 12px;
      background: linear-gradient(transparent, rgba(0,0,0,0.85));
      z-index: 1;
    }

    .anime-card .card-title {
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .anime-card .card-sub {
      font-size: 11px;
      color: rgba(255,255,255,0.6);
      margin-top: 2px;
    }

    .anime-card .card-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.3s ease;
      z-index: 3;
    }

    .anime-card:hover .card-overlay {
      opacity: 1;
    }

    .anime-card .card-play-btn {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: rgba(124,92,252,0.9);
      border: 2px solid rgba(255,255,255,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      color: #fff;
      transform: scale(0.8);
      transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1),
                  background 0.2s ease;
      box-shadow: 0 0 30px rgba(124,92,252,0.4);
    }

    .anime-card:hover .card-play-btn {
      transform: scale(1);
    }

    .anime-card .card-play-btn:hover {
      background: var(--accent-hover);
    }

    .anime-card .card-play-btn::after {
      content: '\\25B6';
      margin-left: 3px;
    }

    .anime-card .card-desc {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 48px 12px 12px;
      background: linear-gradient(transparent, rgba(0,0,0,0.9));
      z-index: 4;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.3s ease;
      pointer-events: none;
    }

    .anime-card:hover .card-desc {
      opacity: 1;
      transform: translateY(0);
    }

    .anime-card .card-desc-text {
      font-size: 11px;
      color: rgba(255,255,255,0.7);
      line-height: 1.5;
      max-height: 50px;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
    }

    .results-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 20px;
    }

    .scroll-container {
      display: flex;
      gap: 16px;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      padding: 4px 0 8px;
      scrollbar-width: none;
    }

    .scroll-container::-webkit-scrollbar { display: none; }

    .scroll-container .anime-card {
      min-width: 160px;
      max-width: 160px;
      scroll-snap-align: start;
    }

    .anime-card.large { aspect-ratio: 16/9; }
    .anime-card.small { aspect-ratio: 3/4; min-width: 130px; max-width: 130px; }
    .anime-card.wide  { aspect-ratio: 16/10; }
  `;

  document.head.appendChild(style);
})();

function createAnimeCard(anime, onClick, sizeClass) {
  const card = document.createElement('div');
  card.className = 'anime-card' + (sizeClass ? ' ' + sizeClass : '');
  card.dataset.id = anime.id;

  const score = anime.score || 0;
  const title = anime.titleCn || anime.title || '未知';
  const sub = anime.airDate || anime.airWeekday || '';

  card.innerHTML = `
    <div class="card-cover-wrap">
      <img class="card-cover" src="${anime.cover || ''}" alt="${title}" loading="lazy"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="card-placeholder" style="display:none">🎬</div>
      ${score > 0 ? `<div class="card-score">${score.toFixed(1)}</div>` : ''}
      ${anime.epCount ? `<div class="card-ep-badge">${anime.epCount}集</div>` : ''}
      <div class="card-overlay">
        <div class="card-play-btn"></div>
      </div>
      ${anime.summary ? `<div class="card-desc"><div class="card-desc-text">${anime.summary}</div></div>` : ''}
      <div class="card-info">
        <div class="card-title">${title}</div>
        ${sub ? `<div class="card-sub">${sub}</div>` : ''}
      </div>
    </div>
  `;

  const img = card.querySelector('.card-cover');
  const placeholder = card.querySelector('.card-placeholder');
  img.addEventListener('error', () => {
    img.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
  });

  card.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onClick) onClick(anime);
  });

  return card;
}
