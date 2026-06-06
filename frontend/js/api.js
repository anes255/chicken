// Tiny API + auth helper shared by every page.
const Auth = {
  get token() { return localStorage.getItem('token'); },
  get user() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; } },
  set({ token, user }) {
    if (token) localStorage.setItem('token', token);
    if (user) localStorage.setItem('user', JSON.stringify(user));
  },
  clear() { localStorage.removeItem('token'); localStorage.removeItem('user'); },
  get isLoggedIn() { return !!this.token; },
  get isAdmin() { return !!(this.user && this.user.is_admin); },
};

async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && Auth.token) headers['Authorization'] = `Bearer ${Auth.token}`;
  const res = await fetch(`${window.API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (data && data.error) || 'حدث خطأ غير متوقع';
    if (res.status === 401) { Auth.clear(); }
    throw new Error(msg);
  }
  return data;
}
