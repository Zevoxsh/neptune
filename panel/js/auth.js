(function () {
  const token = localStorage.getItem('neptune_token');
  if (!token) {
    window.location.href = '/panel/login.html';
    return;
  }
  const payload = api.parseJwt(token);
  if (!payload || !payload.id) {
    localStorage.removeItem('neptune_token');
    window.location.href = '/panel/login.html';
  }
})();
