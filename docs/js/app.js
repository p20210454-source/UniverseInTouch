/* Admin panel — requires site-common.js */
var UIT = window.UIT;

var papers = [];
var categories = [];
var siteStats = null;
var siteSettings = {};

var currentFilter = 'math';
var visibleCount = 5;
var homeBrowse = { papers: [], featured: null, total: 0 };
var browseLoading = false;
var isAdmin = false;
var csrfToken = null;
var pendingAdminPage = null;
var editingPaperId = null;

var SITE_NAME = 'UniverseInTouch';
var LEGACY_SITE_NAMES = { ResearchHub: true, CosmoCause: true };

var ALLOWED_PAGE_IDS = ['admin-page', 'add-paper', 'manage', 'categories', 'analytics', 'install', 'settings'];
var ADMIN_PAGE_IDS = ALLOWED_PAGE_IDS.slice();

// ========== API SERVICE ==========
async function apiFetch(url, options = {}) {
  try {
    const method = (options.method || 'GET').toUpperCase();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    const full = typeof apiUrl === 'function' ? apiUrl(url) : url;
    const res = await fetch(full, {
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
    UIT.showToast('Error: ' + err.message);
    return null;
  }
}

async function checkAuth() {
  try {
    var res = await fetch(apiUrl('/api/auth/me'), { credentials: 'include' });
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
    UIT.showToast('Enter username and password');
    return false;
  }
  var res = await fetch(apiUrl('/api/auth/login'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username, password: password }),
  });
  if (!res.ok) {
    UIT.showToast('Invalid username or password');
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
  UIT.showToast('Signed in as ' + username);
  return true;
}
async function adminLogout() {
  await apiFetch('/api/auth/logout', { method: 'POST' });
  isAdmin = false;
  csrfToken = null;
  updateAdminLogoutUi();
  UIT.showToast('Signed out');
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
  var dash = document.getElementById('admin-page');
  if (dash && dash.classList.contains('active')) {
    if (isAdmin) loadAdminDashboard();
  }
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
  var aboutPapers = document.getElementById('about-paper-count');
  if (aboutPapers) aboutPapers.textContent = published != null ? String(published) : '—';
  var aboutFields = document.getElementById('about-field-count');
  if (aboutFields && siteStats.viewsByField) {
    aboutFields.textContent = String(siteStats.viewsByField.length);
  }
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
    var label = cat ? cat.name : UIT.fieldName(r.field, categories);
    var pct = Math.round((r.views / max) * 100);
    return '<div class="dash-bar-row">' +
      '<span class="dash-bar-label">' + UIT.escapeHTML(label) + '</span>' +
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

function browsePapers() {
  window.location.href = typeof siteUrl === 'function' ? siteUrl('index.html') : '/';
}


// ========== NAVIGATION ==========
function openAdminPanel() {
  showPage('admin-page');
  var sidebar = document.getElementById('admin-sidebar');
  if (sidebar && !sidebar.classList.contains('open')) toggleSidebar();
}

function pageIdFromHash(hash) {
  var raw = (hash || '').replace(/^#/, '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'admin' || raw === 'dashboard') return 'admin-page';
  if (ALLOWED_PAGE_IDS.indexOf(raw) !== -1) return raw;
  return null;
}

function applyHashRoute() {
  var id = pageIdFromHash(location.hash) || 'admin-page';
  showPage(id);
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
  if (document.body.classList.contains('admin-site') && window.matchMedia('(min-width: 900px)').matches) {
    return;
  }
  document.getElementById('admin-sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

// ========== PUBLIC PAPER VIEW (opens public site) ==========
function openPaper(id) {
  window.open(UIT.paperUrl(id), '_blank', 'noopener,noreferrer');
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
  if (!title || !authors) { UIT.showToast('Please fill in required fields (Title, Authors)'); return; }
  
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
    await refreshAdminData();
    UIT.showToast('Paper published successfully!');
    setTimeout(function () { showPage('manage'); }, 1000);
  }
}

async function saveDraft() {
  if (!(await ensureAdmin())) return;
  var title = document.getElementById('f-title').value.trim();
  var authors = document.getElementById('f-authors').value.trim();
  if (!title || !authors) {
    UIT.showToast('Title and authors required for a draft');
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
    UIT.showToast('Draft saved to server.');
  }
}

function clearForm() {
  ['f-title','f-authors','f-date','f-journal','f-doi','f-abstract','f-body','f-tags','f-refs','f-citations'].forEach(id => {
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
    <td style="max-width:280px"><strong style="font-size:13px">${UIT.escapeHTML(p.title.substring(0,60))}${p.title.length>60?'...':''}</strong></td>
    <td style="font-size:13px;color:var(--muted)">${UIT.escapeHTML(p.authors.substring(0,30))}...</td>
    <td><span class="paper-field ${UIT.fieldClass(p.field)}" style="font-size:9px">${UIT.escapeHTML(UIT.fieldName(p.field, categories))}</span></td>
    <td style="font-family:'JetBrains Mono',monospace;font-size:11px;white-space:nowrap">${UIT.formatDate(p.date)}</td>
    <td><span class="status-dot ${statusDotClass(p.status)}"></span><span style="font-size:12px">${UIT.escapeHTML(p.status || 'published')}</span></td>
    <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${p.views}</td>
    <td>
      <a class="action-btn" href="${UIT.paperUrl(p.id)}" target="_blank" rel="noopener noreferrer">View</a>
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
    await refreshAdminData();
    renderManage();
    UIT.showToast('Paper deleted.');
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
  return UIT.formatDate(iso);
}

function statusDotClass(status) {
  if (status === 'draft') return 'draft';
  return 'published';
}

async function loadAdminDashboard() {
  if (!(await ensureAdmin())) return;
  var data = await refreshAdminData(true);
  if (!data) UIT.showToast('Could not load dashboard — try signing in again.');
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
        '<div class="dash-featured-label">Featured on homepage</div>' +
        '<div class="dash-featured-title">' + UIT.escapeHTML(fp.title) + '</div>' +
        '<div class="dash-featured-meta">' + UIT.escapeHTML(fp.authors) + ' · ' + UIT.formatDate(fp.date) + ' · ' + (fp.views || 0) + ' views</div>' +
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
        '<div class="dash-featured-title">' + UIT.escapeHTML(tp.title) + '</div>' +
        '<div class="dash-featured-meta">' + Number(tp.views).toLocaleString() + ' views · ' + UIT.escapeHTML(tp.authors || '') + '</div>' +
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
            '<td style="max-width:220px;font-size:13px"><strong>' + UIT.escapeHTML(p.title.substring(0, 45)) + (p.title.length > 45 ? '…' : '') + '</strong></td>' +
            '<td><span class="paper-field ' + UIT.fieldClass(p.field) + '" style="font-size:9px">' + UIT.escapeHTML(UIT.fieldName(p.field, categories)) + '</span></td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace;font-size:12px">' + (p.views || 0) + '</td>' +
            '<td><span class="status-dot ' + statusDotClass(p.status) + '"></span><span style="font-size:12px">' + UIT.escapeHTML(p.status || 'published') + '</span></td>' +
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
          '<div><div class="activity-text">' + UIT.escapeHTML(item.text) + '</div>' +
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
    <span style="flex:1;font-size:15px">${UIT.escapeHTML(c.name)}</span>
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
    UIT.showToast('Category added!');
  }
}

async function deleteCategory(id) {
  if (!(await ensureAdmin())) return;
  var res = await apiFetch('/api/categories/' + id, { method: 'DELETE' });
  if (res) {
    categories = categories.filter(function (c) { return c.id !== id; });
    renderCategories();
    await refreshAdminData();
    UIT.showToast('Category removed.');
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
    await refreshAdminData();
    UIT.showToast('Settings saved to server.');
  }
}

async function subscribeNewsletter() {
  var input = document.getElementById('newsletter-email');
  var email = input && input.value.trim();
  if (!email) {
    UIT.showToast('Please enter your email.');
    return;
  }
  var res = await apiFetch('/api/subscribers', {
    method: 'POST',
    body: JSON.stringify({ email: email }),
  });
  if (res) {
    input.value = '';
    await fetchStats();
    UIT.showToast('Subscribed! You\'ll receive weekly digests.');
  }
}

// ========== HELPERS ==========
function updateStats() {
  if (siteStats) applyStatsToUI();
  else {
    var els = ['stat-total', 'm-total'];
    els.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = papers.length;
    });
  }
}
function copyCitation(id) {
  var p = papers.find(function (x) { return x.id === id; });
  if (p) UIT.copyCitation(p);
}
function copyInstall() {
  UIT.showToast('Install code copied!');
}
function copyCSS() {
  UIT.showToast('CSS code copied!');
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
    }     else if (action === 'close-sidebar') closeSidebar();
    else if (action === 'toggle-sidebar') toggleSidebar();
    else if (action === 'open-admin') openAdminPanel();
    else if (action === 'browse-papers') {
      e.preventDefault();
      browsePapers();
    }
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
if (!window.UIT) {
  console.error('site-common.js must load before app.js');
} else {
  UIT = window.UIT;
}
bindUiActions();
var loginForm = document.getElementById('admin-login-form');
if (loginForm) loginForm.addEventListener('submit', adminLoginSubmit);
document.querySelectorAll('.sidebar-link[data-page]').forEach(function (a) {
  a.addEventListener('click', function (e) {
    e.preventDefault();
    showPage(a.getAttribute('data-page'));
  });
});
var logoutBtn = document.getElementById('admin-logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', function (e) {
    e.preventDefault();
    adminLogout();
  });
}
applyBrandToUI(SITE_NAME);
checkAuth().then(function (ok) {
  if (!ok) showAdminLogin();
  applyHashRoute();
});
window.addEventListener('hashchange', applyHashRoute);
loadInitialData();
