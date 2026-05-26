var papers = [];
var categories = [];
var siteStats = null;
var siteSettings = {};

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

var currentFilter = 'math';
var visibleCount = 5;
var homeBrowse = { papers: [], featured: null, total: 0 };
var browseLoading = false;
var isAdmin = false;
var csrfToken = null;
var pendingAdminPage = null;

var SITE_NAME = 'UniverseInTouch';
var LEGACY_SITE_NAMES = { ResearchHub: true, CosmoCause: true };

var ALLOWED_PAGE_IDS = ['home','search-page','about-page','paper-view','admin-page','add-paper','manage','categories','analytics','install','settings'];
var ADMIN_PAGE_IDS = ['admin-page','add-paper','manage','categories','analytics','install','settings'];

function fieldClass(f) {
  return { math: 'paper-field-math' }[f] || 'paper-field-default';
}
function accessClass(a) {
  return { open: 'paper-access-open', peer: 'paper-access-peer' }[a] || 'paper-access-default';
}
function accessLabel(a) {
  return a === 'open' ? 'Open Access' : 'Peer Reviewed';
}

// ========== API SERVICE ==========
async function apiFetch(url, options = {}) {
  try {
    const method = (options.method || 'GET').toUpperCase();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    const res = await fetch(url, {
      credentials: 'include',
      ...options,
      headers,
    });
    if (res.status === 401 || res.status === 403) {
      if (res.status === 403) await checkAuth();
      isAdmin = false;
      csrfToken = null;
      updateAdminLogoutUi();
      showAdminLogin();
      return null;
    }
    if (!res.ok) {
      var errBody = await res.json().catch(function () { return {}; });
      throw new Error(errBody.error || ('API Error: ' + res.status));
    }
    return await res.json();
  } catch (err) {
    showToast('Error: ' + err.message);
    return null;
  }
}

async function checkAuth() {
  try {
    var res = await fetch('/api/auth/me', { credentials: 'include' });
    var data = await res.json();
    isAdmin = !!data.authenticated;
    csrfToken = data.csrfToken || null;
  } catch {
    isAdmin = false;
    csrfToken = null;
  }
  updateAdminLogoutUi();
  return isAdmin;
}

async function ensureAdmin() {
  if (isAdmin) return true;
  await checkAuth();
  if (!isAdmin) {
    showAdminLogin();
    return false;
  }
  return true;
}

function showAdminLogin() {
  document.getElementById('admin-login-modal').classList.add('show');
  var userEl = document.getElementById('admin-username');
  if (userEl && !userEl.value.trim()) userEl.value = 'admin';
  document.getElementById('admin-password').focus();
}
function hideAdminLogin() {
  document.getElementById('admin-login-modal').classList.remove('show');
}
function adminLoginSubmit(e) {
  if (e) e.preventDefault();
  return adminLogin();
}
async function adminLogin() {
  var username = document.getElementById('admin-username').value.trim();
  var password = document.getElementById('admin-password').value;
  if (!username || !password) {
    showToast('Enter username and password');
    return false;
  }
  var res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username, password: password }),
  });
  if (!res.ok) {
    showToast('Invalid username or password');
    return false;
  }
  var loginData = await res.json().catch(function () { return {}; });
  csrfToken = loginData.csrfToken || null;
  isAdmin = true;
  updateAdminLogoutUi();
  hideAdminLogin();
  document.getElementById('admin-password').value = '';
  var nextPage = pendingAdminPage || 'admin-page';
  pendingAdminPage = null;
  await refreshAdminData(true);
  showPage(nextPage);
  showToast('Signed in as ' + username);
  return true;
}
async function adminLogout() {
  await apiFetch('/api/auth/logout', { method: 'POST' });
  isAdmin = false;
  csrfToken = null;
  updateAdminLogoutUi();
  showToast('Signed out');
}
function updateAdminLogoutUi() {
  var btn = document.getElementById('admin-logout-btn');
  if (btn) btn.style.display = isAdmin ? 'flex' : 'none';
}

async function loadInitialData() {
  const [papersData, statsData, catsData, settingsData] = await Promise.all([
    apiFetch('/api/papers'),
    apiFetch('/api/stats'),
    apiFetch('/api/categories'),
    apiFetch('/api/settings'),
  ]);
  if (papersData) papers = papersData;
  if (statsData) {
    siteStats = statsData;
    applyStatsToUI();
  }
  if (catsData) categories = catsData;
  if (settingsData) {
    siteSettings = settingsData;
    applySettingsToUI();
  }
  await fetchBrowseList();
  renderHome();
  bindTagCloudClicks();
}

async function fetchStats() {
  const data = await apiFetch('/api/stats');
  if (data) {
    siteStats = data;
    applyStatsToUI();
  }
  return data;
}

function normalizeSiteName(name) {
  var n = String(name || '').trim();
  if (!n || LEGACY_SITE_NAMES[n]) return SITE_NAME;
  return n;
}

function applyBrandToUI(name) {
  var title = normalizeSiteName(name);
  document.title = title + ' — Academic Paper Blog';
  var brand = document.querySelector('.topbar-brand');
  if (brand) {
    if (title === SITE_NAME) {
      brand.innerHTML = 'Universe<span>InTouch</span>';
    } else {
      brand.textContent = title;
    }
  }
  var sidebarName = document.querySelector('.sidebar-logo span:first-child');
  if (sidebarName) sidebarName.textContent = title;
  var footerBrand = document.querySelector('.footer-brand');
  if (footerBrand && title === SITE_NAME) {
    footerBrand.innerHTML = 'Universe<span style="color:var(--gold)">InTouch</span>';
  }
}

function applySettingsToUI() {
  if (siteSettings.blogTitle) {
    siteSettings.blogTitle = normalizeSiteName(siteSettings.blogTitle);
  }
  var map = {
    'set-blog-title': 'blogTitle',
    'set-tagline': 'tagline',
    'set-papers-per-page': 'papersPerPage',
    'set-featured-id': 'featuredPaperId',
    'set-theme': 'theme',
  };
  Object.keys(map).forEach(function (id) {
    var el = document.getElementById(id);
    var key = map[id];
    if (el && siteSettings[key] !== undefined) el.value = siteSettings[key];
  });
  var tag = document.querySelector('.hero-tag');
  if (tag && siteSettings.tagline) tag.textContent = siteSettings.tagline;
  applyBrandToUI(siteSettings.blogTitle || SITE_NAME);
  if (siteSettings.papersPerPage) {
    visibleCount = Math.min(parseInt(siteSettings.papersPerPage, 10) || 5, 50);
  }
}

function applyStatsToUI() {
  if (!siteStats) return;
  var set = function (id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  var published = siteStats.publishedCount !== undefined
    ? siteStats.publishedCount
    : siteStats.totalPapers;
  set('stat-total', published);
  set('sidebar-total', published);
  set('m-total', published);
  set('m-views', Number(siteStats.totalViews || 0).toLocaleString());
  set('m-citations', Number(siteStats.totalCitations || 0).toLocaleString());
  set('m-open-pct', (siteStats.openAccessPercent || 0) + '%');
  set('m-subscribers', siteStats.subscribers || 0);
  if (siteStats.draftCount !== undefined) set('m-drafts', siteStats.draftCount);
  set('sidebar-month', siteStats.publishedThisMonth !== undefined ? siteStats.publishedThisMonth : '—');
  set('sidebar-views', Number(siteStats.totalViews || 0).toLocaleString());
  set('sidebar-citations', Number(siteStats.totalCitations || 0).toLocaleString());
  set('sidebar-open-pct', (siteStats.openAccessPercent || 0) + '%');
  set('sidebar-peer-pct', (siteStats.peerReviewedPercent || 0) + '%');
  set('sidebar-avg-citations', siteStats.avgCitations || '0');
  set('a-total-views', Number(siteStats.totalViews || 0).toLocaleString());
  set('a-total-citations', Number(siteStats.totalCitations || 0).toLocaleString());
  set('a-subscribers', siteStats.subscribers || 0);
  if (siteStats.topPaper) {
    set('a-top-views', siteStats.topPaper.views);
    set('a-top-title', (siteStats.topPaper.title || '').substring(0, 40));
  }
}

function renderViewsByField(el, rows, emptyText) {
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = '<div class="dash-empty">' + (emptyText || 'No view data yet. Publish papers to see trends.') + '</div>';
    return;
  }
  var max = Math.max.apply(null, rows.map(function (r) { return r.views; }).concat([1]));
  var catBySlug = {};
  categories.forEach(function (c) { catBySlug[c.slug] = c; });
  el.innerHTML = rows.map(function (r) {
    var cat = catBySlug[r.field];
    var label = cat ? cat.name : fieldName(r.field);
    var pct = Math.round((r.views / max) * 100);
    return '<div class="dash-bar-row">' +
      '<span class="dash-bar-label">' + escapeHTML(label) + '</span>' +
      '<div class="dash-bar-track"><div class="dash-bar-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="dash-bar-val">' + r.views + '</span></div>';
  }).join('');
}

function updateDashWelcome(d) {
  var welcome = document.getElementById('dash-welcome');
  if (welcome && d) {
    welcome.textContent =
      d.publishedCount + ' published · ' + d.draftCount + ' drafts · ' +
      Number(d.totalViews).toLocaleString() + ' total views';
  }
}

async function refreshAdminData(forceRender) {
  if (!isAdmin) return null;
  var data = await apiFetch('/api/admin/dashboard');
  if (!data) return null;
  siteStats = Object.assign({}, siteStats || {}, data);
  siteStats.totalPapers = data.publishedCount;
  applyStatsToUI();
  var adminPage = document.getElementById('admin-page');
  if (forceRender || (adminPage && adminPage.classList.contains('active'))) {
    renderAdminDashboard(data);
    updateDashWelcome(data);
  }
  return data;
}

async function fetchBrowseList() {
  const params = new URLSearchParams({
    field: currentFilter,
    limit: String(visibleCount),
    offset: '0',
  });
  const data = await apiFetch('/api/papers/browse?' + params.toString());
  if (!data) return false;
  homeBrowse.papers = data.papers || [];
  homeBrowse.featured = data.featured || null;
  homeBrowse.total = data.total || 0;
  homeBrowse.papers.forEach(function (p) {
    var i = papers.findIndex(function (x) { return x.id === p.id; });
    if (i >= 0) papers[i] = p;
    else papers.push(p);
  });
  if (homeBrowse.featured) {
    var fi = papers.findIndex(function (x) { return x.id === homeBrowse.featured.id; });
    if (fi >= 0) papers[fi] = homeBrowse.featured;
    else papers.push(homeBrowse.featured);
  }
  return true;
}

async function browsePapers() {
  if (browseLoading) return;
  browseLoading = true;
  var btn = document.getElementById('browse-papers-btn');
  if (btn) {
    btn.setAttribute('aria-busy', 'true');
    btn.style.opacity = '0.7';
  }
  var grid = document.getElementById('papers-grid');
  showPage('home');
  if (grid) {
    grid.innerHTML = '<p style="text-align:center;padding:32px;color:var(--muted)">Loading papers from server…</p>';
  }
  visibleCount = 5;
  const ok = await fetchBrowseList();
  browseLoading = false;
  if (btn) {
    btn.removeAttribute('aria-busy');
    btn.style.opacity = '';
  }
  if (ok) {
    renderHome();
    showToast('Loaded ' + homeBrowse.total + ' paper' + (homeBrowse.total === 1 ? '' : 's'));
  }
}


// ========== NAVIGATION ==========
function openAdminPanel() {
  toggleSidebar();
  showPage('admin-page');
}

function pageIdFromHash(hash) {
  var raw = (hash || '').replace(/^#/, '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'admin' || raw === 'dashboard') return 'admin-page';
  if (ALLOWED_PAGE_IDS.indexOf(raw) !== -1) return raw;
  return null;
}

function applyHashRoute() {
  var id = pageIdFromHash(location.hash);
  if (id) showPage(id);
}

function showPage(id) {
  if (ALLOWED_PAGE_IDS.indexOf(id) === -1) return;
  if (ADMIN_PAGE_IDS.indexOf(id) !== -1 && !isAdmin) {
    pendingAdminPage = id;
    checkAuth().then(function (ok) {
      if (!ok) {
        showAdminLogin();
        return;
      }
      pendingAdminPage = null;
      showPage(id);
    });
    return;
  }
  pendingAdminPage = null;
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  var el = document.getElementById(id);
  if (el) el.classList.add('active');
  closeSidebar();
  document.querySelectorAll('.sidebar-link').forEach(function (a) { a.classList.remove('active'); });
  var link = document.querySelector('.sidebar-link[data-page="' + id + '"]');
  if (link) link.classList.add('active');
  if (ADMIN_PAGE_IDS.indexOf(id) !== -1) {
    try {
      history.replaceState(null, '', id === 'admin-page' ? '#admin' : '#' + id);
    } catch (e) { /* ignore */ }
  } else if (location.hash) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* ignore */ }
  }
  if (id === 'home') renderHome();
  if (id === 'manage') loadAdminPapers();
  if (id === 'admin-page') loadAdminDashboard();
  if (id === 'categories') loadCategories();
  if (id === 'analytics') {
    if (isAdmin) {
      refreshAdminData().then(function () { renderAnalytics(); });
    } else {
      fetchStats().then(function () { renderAnalytics(); });
    }
  }
  if (id === 'settings') loadAdminSettings();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ========== SIDEBAR ==========
function toggleSidebar() {
  document.getElementById('admin-sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('admin-sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

// ========== RENDER HOME ==========
function renderHome() {
  renderFeatured();
  renderPapers();
  renderTrending();
  renderTags();
  if (siteStats) applyStatsToUI();
}

function renderFeatured() {
  var fp = homeBrowse.featured || papers.find(p => p.featured);
  var el = document.getElementById('featured-section');
  if (!fp || !el) return;
  el.innerHTML = `
    <div class="featured-paper" data-open-paper="${fp.id}" role="button" tabindex="0">
      <span class="featured-label">Featured publication</span>
      <div class="paper-meta">
        <span class="paper-field ${fieldClass(fp.field)}">${escapeHTML(fieldName(fp.field))}</span>
        <span class="paper-access ${accessClass(fp.access)}">${accessLabel(fp.access)}</span>
        <span class="paper-date">${formatDate(fp.date)}</span>
      </div>
      <a class="paper-title">${escapeHTML(fp.title)}</a>
      <p class="paper-authors">${escapeHTML(fp.authors)}</p>
      <p class="paper-abstract">${fp.abstract ? escapeHTML(fp.abstract.substring(0, 220)) + '...' : ''}</p>
      <div class="paper-footer">
        ${fp.tags.map(t=>`<span class="paper-tag">${escapeHTML(t)}</span>`).join('')}
        <div class="paper-stats" style="margin-left:auto">
          <span class="stat-chip">${escapeHTML(fp.journal)}</span>
          <span class="stat-chip">${fp.citations.toLocaleString()} citations</span>
        </div>
      </div>
    </div>`;
}

function getPapersFiltered() {
  if (homeBrowse.papers.length || homeBrowse.total > 0) {
    return homeBrowse.papers;
  }
  var list = currentFilter === 'all' ? papers : papers.filter(p => p.field === currentFilter);
  return list.filter(p => !p.featured);
}

function renderPapers() {
  var grid = document.getElementById('papers-grid');
  if (!grid) return;
  var filtered = getPapersFiltered();
  if (!filtered.length && homeBrowse.total === 0) {
    grid.innerHTML = '<p style="text-align:center;padding:32px;color:var(--muted)">No papers in this field yet. Submit research or try another filter.</p>';
  } else {
    grid.innerHTML = filtered.map(p => paperCardHTML(p)).join('');
  }
  var btn = document.getElementById('load-more-btn');
  if (btn) btn.style.display = homeBrowse.total > filtered.length ? 'inline-block' : 'none';
}

function paperCardHTML(p) {
  return `<div class="paper-card" data-open-paper="${p.id}" role="button" tabindex="0">
    <div class="paper-meta">
      <span class="paper-field ${fieldClass(p.field)}">${escapeHTML(fieldName(p.field))}</span>
      <span class="paper-access ${accessClass(p.access)}">${accessLabel(p.access)}</span>
      <span class="paper-date">${formatDate(p.date)}</span>
    </div>
    <a class="paper-title">${escapeHTML(p.title)}</a>
    <p class="paper-authors">${escapeHTML(p.authors)}</p>
    <p class="paper-abstract paper-abstract-preview">${escapeHTML(p.abstract)}</p>
    <div class="paper-footer">
      ${p.tags.slice(0,4).map(t=>`<a class="paper-tag">${escapeHTML(t)}</a>`).join('')}
      <div class="paper-stats">
        <span class="stat-chip">${escapeHTML(p.journal)}</span>
        <span class="stat-chip">${p.citations.toLocaleString()} citations</span>
        <span class="stat-chip">${p.views} views</span>
      </div>
    </div>
  </div>`;
}

async function renderTrending() {
  var el = document.getElementById('trending-widget');
  if (!el) return;
  var sorted = await apiFetch('/api/papers/trending?limit=5');
  if (!sorted || !sorted.length) {
    sorted = [...papers].sort((a, b) => b.views - a.views).slice(0, 5);
  }
  el.innerHTML = sorted.map((p, i) => `<div class="trending-item">
    <div class="trending-rank">#${i + 1}</div>
    <div class="trending-title" role="button" tabindex="0" data-paper-id="${p.id}">${escapeHTML(p.title)}</div>
    <div class="trending-meta">${p.views} views · ${p.citations} citations</div>
  </div>`).join('');
  el.querySelectorAll('[data-paper-id]').forEach(function (node) {
    node.addEventListener('click', function () {
      openPaper(parseInt(node.getAttribute('data-paper-id'), 10));
    });
  });
}

async function renderTags() {
  var el = document.getElementById('tag-cloud');
  if (!el) return;
  var tagList = await apiFetch('/api/papers/tags');
  if (!tagList) return;
  el.innerHTML = tagList.slice(0, 18).map(function (t) {
    return `<button type="button" class="tag-pill" data-tag="${escapeHTML(t.name)}">${escapeHTML(t.name)} <span style="color:var(--accent)">${t.count}</span></button>`;
  }).join('');
  bindTagCloudClicks();
}

function bindTagCloudClicks() {
  var el = document.getElementById('tag-cloud');
  if (!el || el._tagBound) return;
  el._tagBound = true;
  el.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tag]');
    if (btn) searchByTag(btn.getAttribute('data-tag'));
  });
}

// ========== PAPER VIEW ==========
async function openPaper(id) {
  var p = papers.find(function (x) { return x.id === id; });
  if (!p) {
    var url = isAdmin ? '/api/admin/papers/' + id : '/api/papers/' + id;
    var fetched = await apiFetch(url);
    if (!fetched) return;
    p = fetched;
    papers.push(p);
  }

  if (p.status === 'published') {
    await apiFetch('/api/papers/' + id + '/view', { method: 'POST' });
  }
  p.views = (p.views || 0) + 1;
  
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  document.getElementById('paper-view').classList.add('active');
  var refs = (p.refs || []).map(r => `<li>${escapeHTML(r)}</li>`).join('');
  document.getElementById('paper-view-content').innerHTML = `
    <button type="button" class="back-btn" data-action="show-page" data-page="home">← Back to Papers</button>
    <div class="paper-meta" style="margin-bottom:16px">
      <span class="paper-field ${fieldClass(p.field)}">${escapeHTML(fieldName(p.field))}</span>
      <span class="paper-access ${accessClass(p.access)}">${accessLabel(p.access)}</span>
    </div>
    <h1 class="paper-full-title">${escapeHTML(p.title)}</h1>
    <p style="font-size:17px;color:var(--muted);font-style:italic;margin-bottom:8px">By ${escapeHTML(p.authors)}</p>
    <div class="paper-info-bar">
      <div class="info-item"><div class="info-label">Journal</div><div class="info-val">${escapeHTML(p.journal)}</div></div>
      <div class="info-item"><div class="info-label">Published</div><div class="info-val">${formatDate(p.date)}</div></div>
      <div class="info-item"><div class="info-label">DOI / ID</div><div class="info-val" style="font-family:'JetBrains Mono',monospace;font-size:12px">${escapeHTML(p.doi)}</div></div>
      <div class="info-item"><div class="info-label">Citations</div><div class="info-val">${p.citations.toLocaleString()}</div></div>
    </div>
    <div class="section-heading">Abstract</div>
    <div class="abstract-text">${escapeHTML(p.abstract)}</div>
    <div class="section-heading">Full Text</div>
    <div class="paper-body-text">${(p.body||'').split('\n\n').map(par=>`<p>${escapeHTML(par)}</p>`).join('')}</div>
    <div class="section-heading">Keywords</div>
    <div class="tag-cloud" style="margin-bottom:24px">${p.tags.map(t=>`<button class="tag-pill">${escapeHTML(t)}</button>`).join('')}</div>
    ${refs ? `<div class="section-heading">References</div><ul class="references-list">${refs}</ul>` : ''}
    <div class="section-heading">Cite This Paper</div>
    <div class="citation-box"><button type="button" class="copy-cite-btn" data-copy-cite="${p.id}">Copy</button>${escapeHTML(p.authors)} (${new Date(p.date).getFullYear()}). ${escapeHTML(p.title)}. <em>${escapeHTML(p.journal)}</em>. ${escapeHTML(p.doi)}</div>
    <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap">
      <a class="btn-primary" href="https://scholar.google.com/scholar?q=${encodeURIComponent(p.title)}" target="_blank">Google Scholar</a>
      ${p.doi && p.doi.startsWith('arXiv') ? `<a class="btn-outline" style="color:var(--ink);border-color:var(--border)" href="https://arxiv.org/abs/${escapeHTML(p.doi.replace('arXiv:',''))}" target="_blank">View on arXiv</a>` : ''}
    </div>`;
  window.scrollTo({top:0,behavior:'smooth'});
}

// ========== FILTER ==========
async function filterPapers(field, btn) {
  currentFilter = field;
  visibleCount = 5;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  await fetchBrowseList();
  renderPapers();
  renderFeatured();
}

async function loadMore() {
  visibleCount += 5;
  await fetchBrowseList();
  renderPapers();
}

// ========== SEARCH ==========
function quickSearch(val) {
  if (!val || val.length < 2) return;
  showPage('search-page');
  document.getElementById('main-search').value = val;
  performSearch(val);
}
async function performSearch(query) {
  var q = (query || document.getElementById('main-search').value).trim();
  var el = document.getElementById('search-results');
  if (!el) return;
  if (!q) {
    el.innerHTML = '<p style="color:var(--muted);padding:32px;text-align:center;">Enter a search term.</p>';
    return;
  }
  el.innerHTML = '<p style="color:var(--muted);padding:32px;text-align:center;">Searching…</p>';
  var params = new URLSearchParams({ field: 'all', q: q, limit: '50', offset: '0' });
  var data = await apiFetch('/api/papers/browse?' + params.toString());
  if (!data) return;
  var results = data.papers || [];
  results.forEach(function (p) {
    var i = papers.findIndex(function (x) { return x.id === p.id; });
    if (i >= 0) papers[i] = p;
    else papers.push(p);
  });
  el.innerHTML = results.length
    ? results.map(function (p) { return paperCardHTML(p); }).join('')
    : '<p style="color:var(--muted);padding:32px;text-align:center;font-size:18px;">No papers found for "' + escapeHTML(q) + '"</p>';
}
function searchByTag(tag) {
  showPage('search-page');
  document.getElementById('main-search').value = tag;
  performSearch(tag);
}

// ========== ADMIN: ADD PAPER ==========
async function loadAdminPapers() {
  if (!(await ensureAdmin())) return;
  var data = await apiFetch('/api/admin/papers');
  if (data) {
    papers = data;
    renderManage();
    updateStats();
  }
}

async function addPaper() {
  if (!(await ensureAdmin())) return;
  var title = document.getElementById('f-title').value.trim();
  var authors = document.getElementById('f-authors').value.trim();
  var date = document.getElementById('f-date').value;
  if (!title || !authors) { showToast('Please fill in required fields (Title, Authors)'); return; }
  
  var paperData = {
    featured: document.getElementById('f-featured').value === 'yes',
    status: 'published',
    title, authors, date: date || new Date().toISOString().slice(0,10),
    field: document.getElementById('f-field').value,
    access: document.getElementById('f-access').value,
    journal: document.getElementById('f-journal').value || 'Unpublished',
    doi: document.getElementById('f-doi').value || '',
    abstract: document.getElementById('f-abstract').value,
    body: document.getElementById('f-body').value,
    tags: document.getElementById('f-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
    refs: document.getElementById('f-refs').value.split('\n').filter(Boolean),
    citations: parseInt(document.getElementById('f-citations').value) || 0
  };

  const savedPaper = await apiFetch('/api/papers', {
    method: 'POST',
    body: JSON.stringify(paperData)
  });

  if (savedPaper) {
    if (paperData.featured) papers.forEach(function (p) { p.featured = false; });
    papers.unshift(savedPaper);
    clearForm();
    await fetchBrowseList();
    await refreshAdminData();
    showToast('Paper published successfully!');
    setTimeout(function () { showPage('home'); }, 1000);
  }
}

async function saveDraft() {
  if (!(await ensureAdmin())) return;
  var title = document.getElementById('f-title').value.trim();
  var authors = document.getElementById('f-authors').value.trim();
  if (!title || !authors) {
    showToast('Title and authors required for a draft');
    return;
  }
  var paperData = {
    featured: false,
    status: 'draft',
    title: title,
    authors: authors,
    date: document.getElementById('f-date').value || new Date().toISOString().slice(0, 10),
    field: document.getElementById('f-field').value,
    access: document.getElementById('f-access').value,
    journal: document.getElementById('f-journal').value || 'Unpublished',
    doi: document.getElementById('f-doi').value || '',
    abstract: document.getElementById('f-abstract').value,
    body: document.getElementById('f-body').value,
    tags: document.getElementById('f-tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
    refs: document.getElementById('f-refs').value.split('\n').filter(Boolean),
    citations: parseInt(document.getElementById('f-citations').value, 10) || 0,
  };
  var saved = await apiFetch('/api/papers', { method: 'POST', body: JSON.stringify(paperData) });
  if (saved) {
    papers.unshift(saved);
    await refreshAdminData();
    showToast('Draft saved to server.');
  }
}

function clearForm() {
  ['f-title','f-authors','f-date','f-journal','f-doi','f-abstract','f-body','f-tags','f-refs','f-pdf','f-citations'].forEach(id => {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
}

// ========== ADMIN: MANAGE ==========
function renderManage() {
  var table = document.getElementById('manage-table');
  var count = document.getElementById('manage-count');
  if (!table) return;
  if (count) count.textContent = papers.length;
  table.innerHTML = `<thead><tr>
    <th>Title</th><th>Authors</th><th>Field</th><th>Date</th><th>Status</th><th>Views</th><th>Actions</th>
  </tr></thead><tbody>` +
  papers.map(p => `<tr>
    <td style="max-width:280px"><strong style="font-size:13px">${escapeHTML(p.title.substring(0,60))}${p.title.length>60?'...':''}</strong></td>
    <td style="font-size:13px;color:var(--muted)">${escapeHTML(p.authors.substring(0,30))}...</td>
    <td><span class="paper-field ${fieldClass(p.field)}" style="font-size:9px">${escapeHTML(fieldName(p.field))}</span></td>
    <td style="font-family:'JetBrains Mono',monospace;font-size:11px;white-space:nowrap">${formatDate(p.date)}</td>
    <td><span class="status-dot ${statusDotClass(p.status)}"></span><span style="font-size:12px">${escapeHTML(p.status || 'published')}</span></td>
    <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${p.views}</td>
    <td>
      <button type="button" class="action-btn" data-open-paper="${p.id}">View</button>
      <button type="button" class="action-btn danger" data-delete-paper="${p.id}">Delete</button>
    </td>
  </tr>`).join('') + '</tbody>';
}

async function deletePaper(id) {
  if (!(await ensureAdmin())) return;
  if (!confirm('Are you sure you want to delete this paper?')) return;
  
  const res = await apiFetch(`/api/papers/${id}`, { method: 'DELETE' });
  if (res) {
    papers = papers.filter(function (p) { return p.id !== id; });
    await fetchBrowseList();
    await refreshAdminData();
    renderManage();
    showToast('Paper deleted.');
  }
}

// ========== ADMIN DASHBOARD ==========
function formatRelativeTime(iso) {
  if (!iso) return 'Recently';
  var then = new Date(iso).getTime();
  if (isNaN(then)) return 'Recently';
  var sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 60) return 'Just now';
  if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
  if (sec < 86400) return Math.floor(sec / 3600) + ' hr ago';
  if (sec < 604800) return Math.floor(sec / 86400) + ' days ago';
  return formatDate(iso);
}

function statusDotClass(status) {
  if (status === 'draft') return 'draft';
  return 'published';
}

async function loadAdminDashboard() {
  if (!(await ensureAdmin())) return;
  var data = await refreshAdminData(true);
  if (!data) showToast('Could not load dashboard — try signing in again.');
}

function renderAdminDashboard(d) {
  var set = function (id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set('m-total', d.publishedCount);
  set('m-drafts', d.draftCount);
  set('m-views', Number(d.totalViews).toLocaleString());
  set('m-citations', Number(d.totalCitations).toLocaleString());
  set('m-open-pct', d.openAccessPercent + '%');
  set('m-subscribers', d.subscribers);
  set('m-total-sub', d.totalPapers + ' total in database');
  set('m-drafts-sub', d.draftCount ? 'Needs review' : 'All clear');
  set('m-avg-cite', 'Avg ' + d.avgCitations + ' per paper');
  set('m-peer-pct', d.peerReviewedPercent + '% peer reviewed');
  set('m-categories', (d.categoryCount || 0) + ' categories');
  set('stat-total', d.publishedCount);
  set('sidebar-total', d.publishedCount);

  renderViewsByField(
    document.getElementById('dash-field-chart'),
    d.viewsByField || [],
    'No view data yet. Publish papers to see trends.'
  );

  var featEl = document.getElementById('dash-featured');
  if (featEl) {
    if (d.featuredPaper) {
      var fp = d.featuredPaper;
      featEl.innerHTML =
        '<div class="dash-featured">' +
        '<div class="dash-featured-label">â­ Featured on homepage</div>' +
        '<div class="dash-featured-title">' + escapeHTML(fp.title) + '</div>' +
        '<div class="dash-featured-meta">' + escapeHTML(fp.authors) + ' · ' + formatDate(fp.date) + ' · ' + (fp.views || 0) + ' views</div>' +
        '<button type="button" class="action-btn" data-paper-id="' + fp.id + '">View paper</button></div>';
      featEl.querySelector('[data-paper-id]').addEventListener('click', function () {
        openPaper(fp.id);
      });
    } else {
      featEl.innerHTML = '<div class="dash-empty">Mark a paper as featured when publishing, or set Featured Paper ID in Settings.</div>';
    }
  }

  var topEl = document.getElementById('dash-top-paper');
  if (topEl) {
    if (d.topPaper) {
      var tp = d.topPaper;
      topEl.innerHTML =
        '<div class="dash-featured" style="border-left-color:var(--gold)">' +
        '<div class="dash-featured-label">Most viewed</div>' +
        '<div class="dash-featured-title">' + escapeHTML(tp.title) + '</div>' +
        '<div class="dash-featured-meta">' + Number(tp.views).toLocaleString() + ' views · ' + escapeHTML(tp.authors || '') + '</div>' +
        '<button type="button" class="action-btn" data-top-id="' + tp.id + '">Open</button></div>';
      topEl.querySelector('[data-top-id]').addEventListener('click', function () {
        openPaper(tp.id);
      });
    } else {
      topEl.innerHTML = '<div class="dash-empty">No published papers yet.</div>';
    }
  }

  var table = document.getElementById('admin-recent-table');
  if (table) {
    var recent = d.recentPapers || [];
    if (!recent.length) {
      table.innerHTML = '<tbody><tr><td colspan="4" class="dash-empty">No published papers yet.</td></tr></tbody>';
    } else {
      table.innerHTML = '<thead><tr><th>Title</th><th>Field</th><th>Views</th><th>Status</th><th></th></tr></thead><tbody>' +
        recent.map(function (p) {
          return '<tr>' +
            '<td style="max-width:220px;font-size:13px"><strong>' + escapeHTML(p.title.substring(0, 45)) + (p.title.length > 45 ? '…' : '') + '</strong></td>' +
            '<td><span class="paper-field ' + fieldClass(p.field) + '" style="font-size:9px">' + escapeHTML(fieldName(p.field)) + '</span></td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace;font-size:12px">' + (p.views || 0) + '</td>' +
            '<td><span class="status-dot ' + statusDotClass(p.status) + '"></span><span style="font-size:12px">' + escapeHTML(p.status || 'published') + '</span></td>' +
            '<td><button type="button" class="action-btn" data-recent-id="' + p.id + '">View</button></td>' +
            '</tr>';
        }).join('') + '</tbody>';
      table.querySelectorAll('[data-recent-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          openPaper(parseInt(btn.getAttribute('data-recent-id'), 10));
        });
      });
    }
  }

  var actEl = document.getElementById('dash-activity');
  if (actEl) {
    var activity = d.activity || [];
    if (!activity.length) {
      actEl.innerHTML = '<div class="dash-empty">Updates appear when you add, edit, or save drafts.</div>';
    } else {
      var icons = { add: '+', edit: 'E' };
      actEl.innerHTML = activity.map(function (item) {
        var iconClass = item.type === 'edit' ? 'edit' : 'add';
        return '<div class="activity-item clickable" data-activity-id="' + item.paperId + '" role="button" tabindex="0">' +
          '<div class="activity-icon ' + iconClass + '">' + (icons[item.type] || '·') + '</div>' +
          '<div><div class="activity-text">' + escapeHTML(item.text) + '</div>' +
          '<div class="activity-time">' + formatRelativeTime(item.at) + '</div></div></div>';
      }).join('');
      actEl.querySelectorAll('[data-activity-id]').forEach(function (row) {
        row.addEventListener('click', function () {
          openPaper(parseInt(row.getAttribute('data-activity-id'), 10));
        });
      });
    }
  }
}

async function loadCategories() {
  var data = await apiFetch('/api/categories');
  if (data) categories = data;
  renderCategories();
}

// ========== CATEGORIES ==========
function renderCategories() {
  var el = document.getElementById('cat-list');
  if (!el) return;
  el.innerHTML = categories.map(function (c) {
    var safeColor = /^#[0-9A-Fa-f]{6}$/.test(c.color) ? c.color : '#c0392b';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px dashed var(--border)">
    <span style="width:14px;height:14px;border-radius:50%;background:${safeColor};display:inline-block;flex-shrink:0"></span>
    <span style="flex:1;font-size:15px">${escapeHTML(c.name)}</span>
    <button type="button" class="action-btn danger" data-cat-id="${c.id}">×</button>
  </div>`;
  }).join('');
  el.querySelectorAll('[data-cat-id]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      deleteCategory(parseInt(btn.getAttribute('data-cat-id'), 10));
    });
  });
}

async function addCategory() {
  if (!(await ensureAdmin())) return;
  var name = document.getElementById('cat-name').value.trim();
  var color = document.getElementById('cat-color').value;
  if (!name) return;
  var created = await apiFetch('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: name, color: color }),
  });
  if (created) {
    categories.push(created);
    document.getElementById('cat-name').value = '';
    renderCategories();
    await refreshAdminData();
    showToast('Category added!');
  }
}

async function deleteCategory(id) {
  if (!(await ensureAdmin())) return;
  var res = await apiFetch('/api/categories/' + id, { method: 'DELETE' });
  if (res) {
    categories = categories.filter(function (c) { return c.id !== id; });
    renderCategories();
    await refreshAdminData();
    showToast('Category removed.');
  }
}

// ========== ANALYTICS ==========
function renderAnalytics() {
  if (!siteStats) return;
  renderViewsByField(
    document.getElementById('analytics-chart'),
    siteStats.viewsByField || [],
    'No view data yet.'
  );
  applyStatsToUI();
}

async function loadAdminSettings() {
  if (!(await ensureAdmin())) return;
  var data = await apiFetch('/api/admin/settings');
  if (data) {
    siteSettings = data;
    applySettingsToUI();
  }
}

async function saveSettings() {
  if (!(await ensureAdmin())) return;
  var payload = {
    blogTitle: document.getElementById('set-blog-title').value.trim(),
    tagline: document.getElementById('set-tagline').value.trim(),
    papersPerPage: document.getElementById('set-papers-per-page').value,
    featuredPaperId: document.getElementById('set-featured-id').value.trim(),
    theme: document.getElementById('set-theme').value,
  };
  var data = await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
  if (data) {
    siteSettings = data;
    applySettingsToUI();
    await fetchBrowseList();
    await refreshAdminData();
    showToast('Settings saved to server.');
  }
}

async function subscribeNewsletter() {
  var input = document.getElementById('newsletter-email');
  var email = input && input.value.trim();
  if (!email) {
    showToast('Please enter your email.');
    return;
  }
  var res = await apiFetch('/api/subscribers', {
    method: 'POST',
    body: JSON.stringify({ email: email }),
  });
  if (res) {
    input.value = '';
    await fetchStats();
    showToast('Subscribed! You\'ll receive weekly digests.');
  }
}

// ========== HELPERS ==========
function fieldName(f) {
  var c = categories.find(function (x) { return x.slug === f; });
  if (c) return c.name;
  return { math: 'Mathematics' }[f] || f;
}
function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
}
function updateStats() {
  if (siteStats) applyStatsToUI();
  else {
    var els = ['stat-total', 'sidebar-total', 'm-total'];
    els.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = papers.length;
    });
  }
}
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
function copyCitation(id) {
  var p = papers.find(x => x.id === id);
  if (!p) return;
  var text = `${p.authors} (${new Date(p.date).getFullYear()}). ${p.title}. ${p.journal}. ${p.doi}`;
  navigator.clipboard.writeText(text).then(() => showToast('Citation copied to clipboard!')).catch(() => showToast('Please copy manually.'));
}
function copyInstall() {
  showToast('Install code copied!');
}
function copyCSS() {
  showToast('CSS code copied!');
}

function bindUiActions() {
  document.addEventListener('click', function (e) {
    var openEl = e.target.closest('[data-open-paper]');
    if (openEl) {
      openPaper(parseInt(openEl.getAttribute('data-open-paper'), 10));
      return;
    }
    var delEl = e.target.closest('[data-delete-paper]');
    if (delEl) {
      deletePaper(parseInt(delEl.getAttribute('data-delete-paper'), 10));
      return;
    }
    var citeEl = e.target.closest('[data-copy-cite]');
    if (citeEl) {
      copyCitation(parseInt(citeEl.getAttribute('data-copy-cite'), 10));
      return;
    }
    var actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-action');
    if (action === 'show-page') {
      e.preventDefault();
      showPage(actionEl.getAttribute('data-page'));
    } else if (action === 'close-sidebar') closeSidebar();
    else if (action === 'open-admin') openAdminPanel();
    else if (action === 'browse-papers') { e.preventDefault(); browsePapers(); }
    else if (action === 'filter-papers') filterPapers(actionEl.getAttribute('data-field'), actionEl);
    else if (action === 'load-more') loadMore();
    else if (action === 'subscribe') subscribeNewsletter();
    else if (action === 'perform-search') performSearch();
    else if (action === 'add-paper') addPaper();
    else if (action === 'save-draft') saveDraft();
    else if (action === 'clear-form') clearForm();
    else if (action === 'add-category') addCategory();
    else if (action === 'save-settings') saveSettings();
    else if (action === 'copy-install') copyInstall();
    else if (action === 'copy-css') copyCSS();
    else if (action === 'hide-admin-login') hideAdminLogin();
  });
  var quickSearchEl = document.getElementById('quick-search');
  if (quickSearchEl) {
    quickSearchEl.addEventListener('input', function () { quickSearch(this.value); });
  }
}

// ========== INIT ==========
bindUiActions();
document.querySelectorAll('.sidebar-link[data-page]').forEach(function (a) {
  a.addEventListener('click', function (e) {
    e.preventDefault();
    showPage(a.getAttribute('data-page'));
  });
});
document.getElementById('admin-logout-btn').addEventListener('click', function (e) {
  e.preventDefault();
  adminLogout();
});
applyBrandToUI(SITE_NAME);
checkAuth().then(function () {
  applyHashRoute();
});
window.addEventListener('hashchange', applyHashRoute);
loadInitialData();
