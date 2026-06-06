// Renders the shared header & footer, handles nav + auth state.
const NAV = [
  { href: 'index.html', label: 'الرئيسية' },
  { href: 'about.html', label: 'عن النادي' },
  { href: 'rules.html', label: 'الشروط والأهداف' },
  { href: 'dashboard.html', label: 'مشاركتي', auth: true },
  { href: 'admin.html', label: 'لوحة المدير', admin: true },
];

function currentPage() {
  const p = location.pathname.split('/').pop();
  return p === '' ? 'index.html' : p;
}

function renderHeader() {
  const el = document.getElementById('site-header');
  if (!el) return;
  const page = currentPage();
  const links = NAV.filter((n) => {
    if (n.admin) return Auth.isAdmin;
    if (n.auth) return Auth.isLoggedIn;
    return true;
  })
    .map(
      (n) =>
        `<a href="${n.href}" class="${page === n.href ? 'active' : ''}">${n.label}</a>`
    )
    .join('');

  const authArea = Auth.isLoggedIn
    ? `<div class="auth-area">
         <span class="hello">مرحباً، ${Auth.user ? Auth.user.full_name : ''}</span>
         <button class="btn btn-ghost" id="logoutBtn">خروج</button>
       </div>`
    : `<div class="auth-area">
         <a class="btn btn-ghost" href="login.html">تسجيل الدخول</a>
         <a class="btn btn-primary" href="register.html">إنشاء حساب</a>
       </div>`;

  el.innerHTML = `
    <div class="topbar">
      <div class="container topbar-inner">
        <div class="topbar-socials">
          <span>ORNAMENTAL POULTRY CLUB</span>
        </div>
        <div class="topbar-flag"></div>
      </div>
    </div>
    <div class="container header-inner">
      <a class="brand" href="index.html">
        <img src="assets/expo-logo.png" alt="شعار المعرض" class="brand-logo" onerror="this.style.display='none'">
        <span class="brand-text">
          <strong>نادي دجاج الزينة بالجزائر</strong>
          <small>منصة رسمية تهتم بمربي وهواة دجاج الزينة في الجزائر</small>
        </span>
      </a>
      <img src="assets/abc-logo.png" alt="نادي البراهما الجزائري" class="brand-logo brand-logo-right" onerror="this.style.display='none'">
    </div>
    <nav class="mainnav">
      <div class="container nav-inner">
        <div class="nav-links">${links}</div>
        ${authArea}
      </div>
    </nav>`;

  const logout = document.getElementById('logoutBtn');
  if (logout) logout.onclick = () => { Auth.clear(); location.href = 'index.html'; };
}

function renderFooter() {
  const el = document.getElementById('site-footer');
  if (!el) return;
  el.innerHTML = `
    <div class="container footer-grid">
      <div class="footer-item"><strong>مجتمع واحد</strong><span>يجمع هواة ومربي دجاج الزينة</span></div>
      <div class="footer-item"><strong>تعلم وتطوير</strong><span>دورات وتكوينات دورية</span></div>
      <div class="footer-item"><strong>حماية السلالات</strong><span>المحافظة على التراث الحيواني</span></div>
      <div class="footer-item"><strong>تحكيم عادل وشفاف</strong><span>لضمان أفضل النتائج</span></div>
      <div class="footer-item"><strong>تواصل معنا</strong><span>المعرض الوطني لدجاج الزينة 2026</span></div>
    </div>
    <div class="footer-bottom">© 2026 نادي دجاج الزينة بالجزائر — نادي البراهما الجزائري ABC. جميع الحقوق محفوظة.</div>`;
}

// Guards
function requireAuth() {
  if (!Auth.isLoggedIn) { location.href = 'login.html'; return false; }
  return true;
}
function requireAdmin() {
  if (!Auth.isAdmin) { location.href = 'login.html'; return false; }
  return true;
}

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  renderFooter();
});
