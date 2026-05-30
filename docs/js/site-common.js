/**
 * Shared utilities for UniverseInTouch public site + admin.
 * Load before site.js or app.js.
 */
(function (global) {
  'use strict';

  var FIELD_LABELS = {
    math: 'Mathematics',
    cs: 'Computer Science',
    phys: 'Physics',
    bio: 'Biology',
  };

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function fieldClass(f) {
    return { math: 'paper-field-math' }[f] || 'paper-field-default';
  }

  function accessClass(a) {
    return { open: 'paper-access-open', peer: 'paper-access-peer' }[a] || 'paper-access-default';
  }

  function accessLabel(a) {
    return a === 'open' ? 'Open Access' : 'Peer Reviewed';
  }

  function fieldName(f, categories) {
    if (categories && categories.length) {
      var c = categories.find(function (x) {
        return x.slug === f;
      });
      if (c) return c.name;
    }
    return FIELD_LABELS[f] || f;
  }

  function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function paperUrl(id) {
    var rel = 'paper.html?id=' + encodeURIComponent(id);
    return typeof global.siteUrl === 'function' ? global.siteUrl(rel) : '/' + rel;
  }

  function siteHref(rel) {
    return typeof global.siteUrl === 'function' ? global.siteUrl(rel) : '/' + String(rel || '').replace(/^\//, '');
  }

  function showToast(msg, toastId) {
    var t = document.getElementById(toastId || 'toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () {
      t.classList.remove('show');
    }, 3000);
  }

  function normalizeDoi(doi) {
    if (!doi) return '';
    return String(doi)
      .trim()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  }

  function isDoiValue(doi) {
    return /^10\.\d{4,9}\//.test(normalizeDoi(doi));
  }

  function isArxivId(doi) {
    var s = String(doi || '').trim();
    return /^arXiv:/i.test(s) || /^\d{4}\.\d{4,5}(v\d+)?$/i.test(s);
  }

  function arxivAbsId(doi) {
    var s = String(doi || '').trim();
    if (/^arXiv:/i.test(s)) return s.replace(/^arXiv:/i, '');
    return s;
  }

  function resolvePublisherUrl(doi) {
    var s = normalizeDoi(doi);
    if (!s) return '';
    if (isArxivId(doi)) return 'https://arxiv.org/abs/' + encodeURIComponent(arxivAbsId(doi));
    if (isDoiValue(s)) return 'https://doi.org/' + encodeURIComponent(s);
    return '';
  }

  function googleScholarUrl(paper) {
    var q;
    var doi = normalizeDoi(paper && paper.doi);
    if (isDoiValue(doi)) q = doi;
    else if (paper && paper.doi && isArxivId(paper.doi)) q = 'arXiv:' + arxivAbsId(paper.doi);
    else q = [paper && paper.title, paper && paper.authors].filter(Boolean).join(' ');
    return 'https://scholar.google.com/scholar?q=' + encodeURIComponent(q);
  }

  function publisherLinkLabel(doi) {
    if (!doi) return '';
    if (isArxivId(doi)) return 'View on arXiv';
    if (isDoiValue(doi)) return 'View on publisher (DOI)';
    return '';
  }

  function formatCitation(paper) {
    if (!paper) return '';
    var year = paper.date ? new Date(paper.date).getFullYear() : '';
    var doiPart = paper.doi ? '. ' + (normalizeDoi(paper.doi) || paper.doi) : '';
    return (
      (paper.authors || '') +
      ' (' +
      year +
      '). ' +
      (paper.title || '') +
      '. ' +
      (paper.journal || '') +
      doiPart
    );
  }

  function renderDoiHtml(doi) {
    if (!doi) return '&mdash;';
    var label = escapeHTML(normalizeDoi(doi) || doi);
    var url = resolvePublisherUrl(doi);
    if (!url) return label;
    return (
      '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="doi-link">' + label + '</a>'
    );
  }

  function paperExternalLinksHtml(p) {
    if (!p) return '';
    var scholarUrl = googleScholarUrl(p);
    var publisherUrl = resolvePublisherUrl(p.doi);
    var publisherLabel = publisherLinkLabel(p.doi);
    var html =
      '<div class="paper-external-links">' +
      '<a class="btn-primary scholar-btn" href="' +
      scholarUrl +
      '" target="_blank" rel="noopener noreferrer">Google Scholar</a>';
    if (publisherUrl && publisherLabel) {
      html +=
        '<a class="btn-outline paper-link-secondary" href="' +
        publisherUrl +
        '" target="_blank" rel="noopener noreferrer">' +
        escapeHTML(publisherLabel) +
        '</a>';
    }
    html += '</div>';
    return html;
  }

  function copyCitation(paper, messages) {
    if (!paper) return;
    var text = formatCitation(paper);
    var okMsg = (messages && messages.ok) || 'Citation copied to clipboard.';
    var failMsg = (messages && messages.fail) || 'Could not copy citation.';
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      showToast(failMsg);
      return;
    }
    navigator.clipboard.writeText(text).then(
      function () {
        showToast(okMsg);
      },
      function () {
        showToast(failMsg);
      }
    );
  }

  function paperMetaHtml(p, categories) {
    return (
      '<div class="paper-meta">' +
      '<span class="paper-field ' +
      fieldClass(p.field) +
      '">' +
      escapeHTML(fieldName(p.field, categories)) +
      '</span>' +
      '<span class="paper-date">' +
      formatDate(p.date) +
      '</span>' +
      '<span class="paper-access ' +
      accessClass(p.access) +
      '">' +
      accessLabel(p.access) +
      '</span></div>'
    );
  }

  function paperCardHTML(p, opts) {
    opts = opts || {};
    var cursor = opts.cursor ? ' data-cursor-text="Read paper"' : '';
    return (
      '<a class="paper-card" href="' +
      paperUrl(p.id) +
      '"' +
      cursor +
      '>' +
      paperMetaHtml(p, opts.categories) +
      '<span class="paper-title">' +
      escapeHTML(p.title) +
      '</span>' +
      '<p class="paper-authors">' +
      escapeHTML(p.authors) +
      '</p>' +
      '<p class="paper-abstract paper-abstract-preview">' +
      escapeHTML(p.abstract) +
      '</p>' +
      '<div class="paper-footer">' +
      (p.tags || [])
        .slice(0, 4)
        .map(function (t) {
          return '<span class="paper-tag">' + escapeHTML(t) + '</span>';
        })
        .join('') +
      '<div class="paper-stats">' +
      '<span class="stat-chip">' +
      escapeHTML(p.journal) +
      '</span>' +
      '<span class="stat-chip">' +
      Number(p.citations || 0).toLocaleString() +
      ' citations</span>' +
      '<span class="stat-chip">' +
      Number(p.views || 0) +
      ' views</span>' +
      '</div></div></a>'
    );
  }

  function featuredPaperHTML(p, opts) {
    opts = opts || {};
    var cursor = opts.cursor ? ' data-cursor-text="Read paper"' : '';
    return (
      '<a class="featured-paper" href="' +
      paperUrl(p.id) +
      '"' +
      cursor +
      '>' +
      '<span class="featured-label">Featured publication</span>' +
      '<span class="paper-title">' +
      escapeHTML(p.title) +
      '</span>' +
      '<p class="paper-authors">' +
      escapeHTML(p.authors) +
      '</p>' +
      '<p class="paper-abstract">' +
      (p.abstract ? escapeHTML(p.abstract.substring(0, 220)) + '...' : '') +
      '</p>' +
      '<div class="paper-footer">' +
      (p.tags || [])
        .map(function (t) {
          return '<span class="paper-tag">' + escapeHTML(t) + '</span>';
        })
        .join('') +
      '<div class="paper-stats" style="margin-left:auto">' +
      '<span class="stat-chip">' +
      escapeHTML(p.journal) +
      '</span>' +
      '<span class="stat-chip">' +
      Number(p.citations || 0).toLocaleString() +
      ' citations</span>' +
      '</div></div></a>'
    );
  }

  function renderPaperDetailHtml(p, categories) {
    var refs = (p.refs || [])
      .map(function (r) {
        return '<li>' + escapeHTML(r) + '</li>';
      })
      .join('');
    var tags =
      p.tags && p.tags.length
        ? '<h2 class="section-heading">Keywords</h2><div class="tag-cloud paper-keywords">' +
          p.tags
            .map(function (t) {
              return (
                '<a class="tag-pill" href="' +
                siteHref('search.html?q=' + encodeURIComponent(t)) +
                '">' +
                escapeHTML(t) +
                '</a>'
              );
            })
            .join('') +
          '</div>'
        : '';
    return (
      '<a href="' + siteHref('index.html') + '" class="back-btn">&larr; Back to papers</a>' +
      '<div class="paper-meta" style="margin-bottom:16px">' +
      '<span class="paper-field ' +
      fieldClass(p.field) +
      '">' +
      escapeHTML(fieldName(p.field, categories)) +
      '</span>' +
      '<span class="paper-access ' +
      accessClass(p.access) +
      '">' +
      accessLabel(p.access) +
      '</span></div>' +
      '<h1 class="paper-full-title">' +
      escapeHTML(p.title) +
      '</h1>' +
      '<p style="font-size:17px;color:var(--muted);font-style:italic">By ' +
      escapeHTML(p.authors) +
      '</p>' +
      '<div class="paper-info-bar">' +
      '<div class="info-item"><div class="info-label">Journal</div><div class="info-val">' +
      escapeHTML(p.journal) +
      '</div></div>' +
      '<div class="info-item"><div class="info-label">Published</div><div class="info-val">' +
      formatDate(p.date) +
      '</div></div>' +
      '<div class="info-item"><div class="info-label">DOI</div><div class="info-val doi-info-val">' +
      renderDoiHtml(p.doi) +
      '</div></div>' +
      '<div class="info-item"><div class="info-label">Citations</div><div class="info-val">' +
      Number(p.citations || 0).toLocaleString() +
      '</div></div></div>' +
      paperExternalLinksHtml(p) +
      '<h2 class="section-heading">Abstract</h2>' +
      '<div class="abstract-text">' +
      escapeHTML(p.abstract) +
      '</div>' +
      '<h2 class="section-heading">Full Text</h2>' +
      '<div class="paper-body-text">' +
      (p.body || '')
        .split('\n\n')
        .map(function (par) {
          return '<p>' + escapeHTML(par) + '</p>';
        })
        .join('') +
      '</div>' +
      tags +
      (refs ? '<h2 class="section-heading">References</h2><ul class="references-list">' + refs + '</ul>' : '') +
      '<h2 class="section-heading">Cite this paper</h2>' +
      '<div class="citation-box">' +
      '<button type="button" class="copy-cite-btn" id="copy-cite-btn">Copy</button>' +
      escapeHTML(formatCitation(p)) +
      '</div>'
    );
  }

  var linksApi = {
    normalizeDoi: normalizeDoi,
    isDoiValue: isDoiValue,
    isArxivId: isArxivId,
    resolvePublisherUrl: resolvePublisherUrl,
    googleScholarUrl: googleScholarUrl,
    publisherLinkLabel: publisherLinkLabel,
    formatCitation: formatCitation,
  };

  var THEME_CLASSES = ['theme-paper-ink', 'theme-dark-academia', 'theme-clean-white'];

  function applyTheme(theme) {
    if (typeof document === 'undefined') return;
    THEME_CLASSES.forEach(function (c) {
      document.body.classList.remove(c);
    });
    var t = THEME_CLASSES.indexOf('theme-' + (theme || 'paper-ink')) >= 0 ? theme : 'paper-ink';
    document.body.classList.add('theme-' + t);
  }

  global.PaperLinks = linksApi;
  global.UIT = {
    escapeHTML: escapeHTML,
    fieldClass: fieldClass,
    accessClass: accessClass,
    accessLabel: accessLabel,
    fieldName: fieldName,
    formatDate: formatDate,
    paperUrl: paperUrl,
    siteHref: siteHref,
    showToast: showToast,
    renderDoiHtml: renderDoiHtml,
    paperExternalLinksHtml: paperExternalLinksHtml,
    copyCitation: copyCitation,
    paperCardHTML: paperCardHTML,
    featuredPaperHTML: featuredPaperHTML,
    renderPaperDetailHtml: renderPaperDetailHtml,
    paperMetaHtml: paperMetaHtml,
    applyTheme: applyTheme,
    links: linksApi,
  };
})(typeof window !== 'undefined' ? window : this);
