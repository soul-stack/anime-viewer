/* ===== 搜索栏 v2 ===== */
(function() {
  const styleId = 'search-bar-styles-v2';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .search-section {
      margin-bottom: 28px;
    }

    .search-bar {
      display: flex;
      gap: 10px;
      max-width: 600px;
      margin: 0 auto;
    }

    .search-input-wrap {
      flex: 1;
      position: relative;
    }

    .search-input {
      width: 100%;
      height: 48px;
      padding: 0 20px 0 46px;
      background: var(--bg-elevated);
      border: 1.5px solid var(--border);
      border-radius: var(--radius-lg);
      color: var(--text-primary);
      font-size: 15px;
      font-family: inherit;
      outline: none;
      transition: all var(--transition);
    }

    .search-input::placeholder {
      color: var(--text-muted);
    }

    .search-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-dim);
      background: var(--bg-card);
    }

    .search-input-icon {
      position: absolute;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      font-size: 18px;
      pointer-events: none;
    }

    .search-input-clear {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 18px;
      cursor: pointer;
      padding: 4px;
      display: none;
      border-radius: 50%;
      transition: all var(--transition-fast);
    }

    .search-input-clear:hover {
      color: var(--text-primary);
      background: var(--bg-glass);
    }

    .search-input:not(:placeholder-shown) ~ .search-input-clear {
      display: block;
    }

    .search-btn {
      height: 48px;
      padding: 0 28px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--gradient-main);
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: all var(--transition-fast);
      white-space: nowrap;
    }

    .search-btn:hover {
      box-shadow: 0 4px 16px var(--accent-glow);
      transform: translateY(-1px);
    }

    .search-btn:active {
      transform: scale(0.97);
    }

    .quick-tags {
      display: flex;
      gap: 8px;
      justify-content: center;
      flex-wrap: wrap;
      margin-top: 14px;
    }

    .tag-btn {
      padding: 6px 16px;
      border-radius: var(--radius-full);
      background: var(--bg-glass);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .tag-btn:hover {
      color: var(--accent);
      border-color: var(--accent);
      background: var(--accent-dim);
    }
  `;

  document.head.appendChild(style);
})();

function createSearchBar(onSearch) {
  const container = document.createElement('div');
  container.className = 'search-section';

  const quickTags = ['进击的巨人', '鬼灭之刃', '咒术回战', '间谍过家家', '葬送的芙莉莲', '药屋少女'];

  container.innerHTML = `
    <div class="search-bar">
      <div class="search-input-wrap">
        <span class="search-input-icon">⌕</span>
        <input type="text" class="search-input" placeholder="搜索动漫（中文/日文/英文）..." />
        <button class="search-input-clear" tabindex="-1">✕</button>
      </div>
      <button class="search-btn">搜索</button>
    </div>
    <div class="quick-tags">
      ${quickTags.map(t => `<button class="tag-btn" data-tag="${t}">${t}</button>`).join('')}
    </div>
  `;

  const input = container.querySelector('.search-input');
  const btn = container.querySelector('.search-btn');
  const clearBtn = container.querySelector('.search-input-clear');

  const doSearch = () => {
    const keyword = input.value.trim();
    if (keyword) onSearch(keyword);
  };

  btn.addEventListener('click', doSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    input.focus();
    clearBtn.style.display = 'none';
  });

  input.addEventListener('input', () => {
    clearBtn.style.display = input.value ? 'block' : 'none';
  });

  container.querySelectorAll('.tag-btn').forEach(tagBtn => {
    tagBtn.addEventListener('click', () => {
      input.value = tagBtn.dataset.tag;
      doSearch();
    });
  });

  return container;
}
