/* ===== Toast 通知 v2 ===== */
const Toast = {
  show(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 250);
    }, duration);
  },

  info(message, d)    { this.show(message, 'info', d); },
  success(message, d) { this.show(message, 'success', d); },
  error(message, d)   { this.show(message, 'error', d); },
  warning(message, d) { this.show(message, 'warning', d); },
};
