(function () {
  const token = localStorage.getItem('neptune_token');
  const payload = api.parseJwt(token) || {};
  const role = payload.role || '';
  const username = payload.username || payload.sub || '?';
  const host = window.NEPTUNE_HOST || location.hostname;

  const isAdmin  = role === 'admin';
  const isUser   = role === 'admin' || role === 'user';

  const nav = [
    { label: '📊 Dashboard',        href: '/panel/dashboard.html',  show: true },
    { section: 'Hébergement' },
    { label: '🌐 Domaines',          href: '/panel/domains.html',    show: true },
    { label: '🗄️ Bases de données',  href: '/panel/databases.html',  show: isUser },
    { section: 'Fichiers' },
    { label: '📂 Gestionnaire',      href: '/panel/files.html',      show: true },
    { label: '🔑 Comptes FTP',       href: '/panel/ftp.html',        show: isUser },
    { section: 'Sécurité' },
    { label: '🔒 SSL',               href: '/panel/ssl.html',        show: isUser },
    { section: 'Administration' },
    { label: '👤 Comptes',           href: '/panel/accounts.html',   show: isUser },
    { label: '⚙️ Serveur',           href: '/panel/server.html',     show: isAdmin },
  ];

  const current = location.pathname;

  function navHTML() {
    return nav.map(item => {
      if (item.section) {
        return `<div class="nav-section">${item.section}</div>`;
      }
      if (!item.show) return '';
      const active = current === item.href ? ' active' : '';
      return `<a class="nav-item${active}" href="${item.href}">${item.label}</a>`;
    }).join('');
  }

  async function logout() {
    await api.post('/auth/logout');
    localStorage.removeItem('neptune_token');
    window.location.href = '/panel/login.html';
  }

  const initial = username.charAt(0).toUpperCase();

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const html = `
    <div class="sidebar-logo">
      <div class="sidebar-logo-title">⚡ NEPTUNE</div>
      <div class="sidebar-logo-host">${escapeHtml(host)}</div>
    </div>
    <nav class="sidebar-nav">
      ${navHTML()}
    </nav>
    <div class="sidebar-footer">
      <div class="sidebar-avatar">${escapeHtml(initial)}</div>
      <div>
        <div class="sidebar-user-name">${escapeHtml(username)}</div>
        <div class="sidebar-user-role">${escapeHtml(role)}</div>
      </div>
      <button class="sidebar-logout" id="btn-logout" title="Déconnexion">⏻</button>
    </div>
  `;

  const el = document.getElementById('sidebar');
  if (el) {
    el.innerHTML = html;
    document.getElementById('btn-logout').addEventListener('click', logout);
  }
})();
