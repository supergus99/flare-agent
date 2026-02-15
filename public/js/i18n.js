/**
 * Flare client-side i18n.
 * - Set data-locale="en" or data-locale="pt" on <html>.
 * - Use data-i18n="key" (dot notation, e.g. "contact.title") for text content.
 * - Use data-i18n-placeholder="key" for input/textarea placeholder.
 * - Use data-i18n-title="key" for title attribute.
 * - Use data-i18n-href="key" for path (from paths.* keys); sets element href.
 * - **text** in locale strings is rendered as <strong>text</strong> when using data-i18n.
 */
(function () {
  var locale = (document.documentElement.getAttribute('data-locale') || '').trim().toLowerCase();
  if (!locale) {
    var pathname = window.location.pathname || '';
    if (pathname.indexOf('/pt/') === 0 || pathname === '/pt' || pathname === '/pt/') locale = 'pt';
    else {
      var q = window.location.search && window.location.search.indexOf('lang=') !== -1
        ? new URLSearchParams(window.location.search).get('lang')
        : null;
      if (q) locale = String(q).trim().toLowerCase().slice(0, 5);
    }
  }
  if (!locale) {
    try { locale = (localStorage.getItem('flare_locale') || '').trim().toLowerCase().slice(0, 5); } catch (e) {}
  }
  if (locale !== 'pt') locale = 'en';

  var dict = {};
  var base = (function () {
    var p = window.location.pathname || '';
    if (p.indexOf('/pt/') === 0 || p === '/pt' || p === '/pt/') return window.location.origin + '';
    return window.location.origin + '';
  })();

  function getByKey(obj, key) {
    var parts = key.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length && cur != null; i++) cur = cur[parts[i]];
    return cur != null ? String(cur) : '';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderValue(str) {
    if (str == null) return '';
    str = String(str);
    return escapeHtml(str).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  }

  function t(key) {
    return getByKey(dict, key);
  }

  function path(key) {
    var fullKey = (key.indexOf('paths.') === 0) ? key : 'paths.' + key;
    return getByKey(dict, fullKey) || '#';
  }

  function apply() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (!key) return;
      var val = t(key);
      if (el.getAttribute('data-i18n-html') !== null) el.innerHTML = renderValue(val);
      else el.textContent = val.replace(/\*\*(.*?)\*\*/g, '$1');
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = t(key);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-title');
      if (key) el.title = t(key);
    });
    document.querySelectorAll('[data-i18n-href]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-href');
      if (!key) return;
      var p = path(key);
      if (p && p !== '#') el.href = p;
    });
    var titleKey = document.body && document.body.getAttribute('data-doc-title');
    if (titleKey) document.title = t(titleKey);
    var descKey = document.body && document.body.getAttribute('data-doc-desc');
    if (descKey) {
      var meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute('content', t(descKey));
    }
  }

  function init() {
    var url = base + '/locales/' + locale + '.json';
    fetch(url)
      .then(function (r) { return r.ok ? r.json() : (locale === 'en' ? {} : fetch(base + '/locales/en.json').then(function (r2) { return r2.ok ? r2.json() : {}; })); })
      .then(function (data) {
        dict = data || {};
        if (!dict.paths && locale === 'pt') {
          dict.paths = { home: '/pt/', contact: '/pt/contact.html', checkout: '/pt/checkout.html', success: '/pt/success.html', assessment: '/pt/assessment.html' };
        }
        if (!dict.paths && locale === 'en') {
          dict.paths = { home: '/', contact: '/contact.html', checkout: '/checkout.html', success: '/success.html', assessment: '/assessment.html' };
        }
        apply();
        try { localStorage.setItem('flare_locale', locale); } catch (e) {}
      })
      .catch(function () {
        dict = {};
        apply();
      });
  }

  window.FLARE_I18N = {
    locale: locale,
    t: t,
    path: path,
    apply: apply,
    dict: function () { return dict; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
