const API_BASE = '/api';
let _refreshing = false;

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

async function apiFetch(method, path, body) {
  const token = localStorage.getItem('neptune_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !_refreshing) {
    _refreshing = true;
    try {
      const r = await fetch(API_BASE + '/auth/refresh', { method: 'POST', credentials: 'include' });
      if (r.ok) {
        const data = await r.json();
        localStorage.setItem('neptune_token', data.token);
        _refreshing = false;
        return apiFetch(method, path, body);
      }
    } catch {}
    _refreshing = false;
    localStorage.removeItem('neptune_token');
    window.location.href = '/panel/login.html';
    return null;
  }

  return res;
}

const api = {
  get:    (path)       => apiFetch('GET',    path),
  post:   (path, body) => apiFetch('POST',   path, body),
  put:    (path, body) => apiFetch('PUT',    path, body),
  delete: (path)       => apiFetch('DELETE', path),
  parseJwt,
};

window.api = api;
