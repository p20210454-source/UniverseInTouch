/* Public multi-page site — requires site-common.js */
var papers = [];
var siteStats = null;
var currentFilter = 'math';
var browsePageSize = 5;
var browseLimit = 5;
var homeBrowse = { papers: [], featured: null, total: 0 };
var currentPaperView = null;

var UIT = window.UIT;

async function apiGet(url) {
  try {
    var res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error(err.error || 'Request failed');
    }
    return await res.json();
  } catch (e) {
    UIT.showToast(e.message);
    return null;
  }
}

function renderFeatured() {
  var fp = homeBrowse.featured || papers.find(function (p) { return p.featured; });
  var el = document.getElementById('featured-section');
  if (!fp || !el) return;
  el.innerHTML = UIT.featuredPaperHTML(fp, { cursor: true });
}

function getPapersFiltered() {
  if (homeBrowse.papers.length || homeBrowse.total > 0) return homeBrowse.papers;
  var list =
    currentFilter === 'all'
      ? papers
      : papers.filter(function (p) {
          return p.field === currentFilter;
        });
  return list.filter(function (p) {
    return !p.featured;
  });
}

function renderPapers() {
  var grid = document.getElementById('papers-grid');
  if (!grid) return;
  var filtered = getPapersFiltered();
  if (!filtered.length && homeBrowse.total === 0) {
    grid.innerHTML =
      '<p style="text-align:center;padding:32px;color:var(--muted)">No papers in this field yet.</p>';
  } else {
    grid.innerHTML = filtered
      .map(function (p) {
        return UIT.paperCardHTML(p, { cursor: true });
      })
      .join('');
  }
  var btn = document.getElementById('load-more-btn');
  if (btn) btn.style.display = homeBrowse.total > filtered.length ? 'inline-block' : 'none';
}

async function fetchBrowseList(reset) {
  if (reset) browseLimit = browsePageSize;
  var params = new URLSearchParams({
    field: currentFilter,
    limit: String(browseLimit),
    offset: '0',
  });
  var data = await apiGet('/api/papers/browse?' + params.toString());
  if (!data) return false;
  homeBrowse.papers = data.papers || [];
  homeBrowse.featured = data.featured || null;
  homeBrowse.total = data.total || 0;
  return true;
}

async function renderTrending() {
  var el = document.getElementById('trending-widget');
  if (!el) return;
  var sorted = await apiGet('/api/papers/trending?limit=5');
  if (!sorted || !sorted.length) {
    sorted = papers.slice().sort(function (a, b) {
      return b.views - a.views;
    }).slice(0, 5);
  }
  el.innerHTML = sorted
    .map(function (p, i) {
      return (
        '<div class="trending-item">' +
        '<div class="trending-rank">#' +
        (i + 1) +
        '</div>' +
        '<a class="trending-title" href="' +
        UIT.paperUrl(p.id) +
        '">' +
        UIT.escapeHTML(p.title) +
        '</a>' +
        '<div class="trending-meta">' +
        p.views +
        ' views</div></div>'
      );
    })
    .join('');
}

async function renderTags() {
  var el = document.getElementById('tag-cloud');
  if (!el) return;
  var tagList = await apiGet('/api/papers/tags');
  if (!tagList) return;
  el.innerHTML = tagList
    .slice(0, 18)
    .map(function (t) {
      return (
        '<a class="tag-pill" href="/search.html?q=' +
        encodeURIComponent(t.name) +
        '">' +
        UIT.escapeHTML(t.name) +
        ' <span style="color:var(--accent)">' +
        t.count +
        '</span></a>'
      );
    })
    .join('');
}

function applyStatsToUI() {
  if (!siteStats) return;
  var set = function (id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set('sidebar-total', siteStats.totalPapers);
  set('sidebar-open-pct', (siteStats.openAccessPercent || 0) + '%');
  set('sidebar-peer-pct', (siteStats.peerReviewedPercent || 0) + '%');
  set('sidebar-avg-citations', siteStats.avgCitations || '0');
}

async function loadHome() {
  var papersData = await apiGet('/api/papers');
  var statsData = await apiGet('/api/stats');
  var settingsData = await apiGet('/api/settings');
  if (papersData) papers = papersData;
  if (statsData) {
    siteStats = statsData;
    applyStatsToUI();
  }
  if (settingsData) {
    if (settingsData.theme) UIT.applyTheme(settingsData.theme);
    var perPage = parseInt(settingsData.papersPerPage, 10);
    if (perPage >= 1 && perPage <= 50) {
      browsePageSize = perPage;
      browseLimit = perPage;
    }
  }
  await fetchBrowseList(true);
  renderFeatured();
  renderPapers();
  await renderTrending();
  await renderTags();
}

async function filterPapers(field, btn) {
  currentFilter = field;
  browseLimit = browsePageSize;
  document.querySelectorAll('.filter-btn').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btn) btn.classList.add('active');
  await fetchBrowseList(true);
  renderFeatured();
  renderPapers();
}

async function loadMore() {
  browseLimit += browsePageSize;
  await fetchBrowseList(false);
  renderPapers();
}

async function subscribeNewsletter() {
  var input = document.getElementById('newsletter-email');
  var email = input && input.value.trim();
  if (!email) {
    UIT.showToast('Please enter your email.');
    return;
  }
  try {
    var res = await fetch('/api/subscribers', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email }),
    });
    if (!res.ok) throw new Error('Subscribe failed');
    if (input) input.value = '';
    UIT.showToast('Subscribed successfully.');
  } catch (e) {
    UIT.showToast('Could not subscribe.');
  }
}

async function loadPaperPage() {
  var params = new URLSearchParams(window.location.search);
  var id = parseInt(params.get('id'), 10);
  var el = document.getElementById('paper-view-content');
  if (!id || !el) {
    if (el) el.innerHTML = '<p class="about-content">Paper not found.</p>';
    return;
  }
  var p = await apiGet('/api/papers/' + id);
  if (!p) {
    el.innerHTML = '<p>Paper not found.</p>';
    return;
  }
  currentPaperView = p;
  await fetch('/api/papers/' + id + '/view', { method: 'POST', credentials: 'include' });
  el.innerHTML = UIT.renderPaperDetailHtml(p);
  document.title = (p.title || 'Paper') + ' — UniverseInTouch';
  var copyBtn = document.getElementById('copy-cite-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      UIT.copyCitation(currentPaperView);
    });
  }
}

async function loadSearchPage() {
  var params = new URLSearchParams(window.location.search);
  var q = params.get('q') || '';
  var input = document.getElementById('main-search');
  if (input) input.value = q;
  if (q) await performSearch(q);
}

async function performSearch(query) {
  var q = (query || (document.getElementById('main-search') && document.getElementById('main-search').value) || '').trim();
  var el = document.getElementById('search-results');
  if (!el) return;
  if (!q) {
    el.innerHTML = '<p style="color:var(--muted);padding:32px 0">Enter a search term.</p>';
    return;
  }
  el.innerHTML = '<p style="color:var(--muted);padding:32px 0">Searching…</p>';
  var data = await apiGet(
    '/api/papers/browse?' +
      new URLSearchParams({ field: 'all', q: q, limit: '50', offset: '0' }).toString()
  );
  if (!data) return;
  var results = data.papers || [];
  el.innerHTML = results.length
    ? results.map(function (p) { return UIT.paperCardHTML(p); }).join('')
    : '<p style="color:var(--muted);padding:32px 0">No papers found for “' + UIT.escapeHTML(q) + '”.</p>';
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', '/search.html?q=' + encodeURIComponent(q));
  }
}

function bindHome() {
  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      filterPapers(btn.getAttribute('data-field'), btn);
    });
  });
  var loadBtn = document.getElementById('load-more-btn');
  if (loadBtn) loadBtn.addEventListener('click', loadMore);
  var subBtn = document.getElementById('subscribe-btn');
  if (subBtn) subBtn.addEventListener('click', subscribeNewsletter);
}

function bindSearch() {
  var form = document.getElementById('search-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      performSearch();
    });
  }
}

document.addEventListener('DOMContentLoaded', function () {
  if (!window.UIT) {
    console.error('site-common.js must load before site.js');
    return;
  }
  UIT = window.UIT;
  UIT.applyTheme('paper-ink');
  var page = document.body.getAttribute('data-page');
  if (page === 'home') {
    bindHome();
    loadHome().then(function () {
      if (typeof window.rebindCustomCursor === 'function') window.rebindCustomCursor();
    });
  } else if (page === 'paper') {
    loadPaperPage();
  } else if (page === 'search') {
    bindSearch();
    loadSearchPage();
  }
});
