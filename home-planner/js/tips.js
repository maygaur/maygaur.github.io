/*
 * Explanation popovers. Any element with data-tip="<id>" shows the registered content:
 * hover (mouse) or click/tap (touch, pen, keyboard). On phones it opens as a bottom sheet.
 * Content is registered per scope and built lazily, so big tables stay cheap to re-render.
 */
(function (root) {
  'use strict';
  var reg = new Map(), scopes = {}, seq = 0;
  var tipEl = null, current = null, pinned = false, hoverT = null, hideT = null;

  /** Forget everything registered under a scope (call before re-rendering that area). */
  function reset(scope) {
    (scopes[scope] || []).forEach(function (id) { reg.delete(id); });
    scopes[scope] = [];
    if (current && !document.body.contains(current)) hide();
  }
  /** Register content (HTML string or function returning HTML). Returns the attribute string. */
  function attr(scope, content) {
    var id = 't' + (++seq);
    reg.set(id, content);
    (scopes[scope] = scopes[scope] || []).push(id);
    return ' data-tip="' + id + '" tabindex="0"';
  }

  function ensure() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'tip-pop';
    tipEl.setAttribute('role', 'dialog');
    tipEl.hidden = true;
    tipEl.addEventListener('pointerenter', function () { clearTimeout(hideT); });
    tipEl.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !pinned) scheduleHide(); });
    tipEl.addEventListener('click', function (e) { if (e.target.closest('.tip-close')) hide(); });
    document.body.appendChild(tipEl);
    return tipEl;
  }
  function sheetMode() { return window.innerWidth < 640; }

  function show(target, pin) {
    var c = reg.get(target.dataset.tip);
    if (c == null) return;
    var html = typeof c === 'function' ? c() : c;
    if (!html) return;
    var el = ensure();
    clearTimeout(hideT);
    if (current && current !== target) current.classList.remove('tip-on');
    current = target; pinned = !!pin;
    target.classList.add('tip-on');
    el.innerHTML = '<button type="button" class="tip-close" aria-label="Close">×</button>' + html;
    el.hidden = false;
    el.classList.toggle('sheet', sheetMode());
    place(target);
  }
  function place(target) {
    var el = tipEl;
    if (el.classList.contains('sheet')) { el.style.left = el.style.top = ''; return; }
    el.style.left = '0px'; el.style.top = '0px';
    var r = target.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight, gap = 8;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8);
    var top = r.bottom + gap;
    if (top + h > vh - 8 && r.top - gap - h > 8) top = r.top - gap - h;
    top = Math.max(8, Math.min(top, vh - h - 8));
    el.style.left = left + 'px'; el.style.top = top + 'px';
  }
  function hide() {
    clearTimeout(hoverT); clearTimeout(hideT);
    if (tipEl) tipEl.hidden = true;
    if (current) current.classList.remove('tip-on');
    current = null; pinned = false;
  }
  function scheduleHide() { clearTimeout(hideT); hideT = setTimeout(hide, 180); }

  document.addEventListener('pointerover', function (e) {
    if (e.pointerType !== 'mouse') return;
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (!t || pinned) return;
    clearTimeout(hideT); clearTimeout(hoverT);
    hoverT = setTimeout(function () { show(t, false); }, 220);
  });
  document.addEventListener('pointerout', function (e) {
    if (e.pointerType !== 'mouse') return;
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) return;
    if (e.relatedTarget && (t.contains(e.relatedTarget) || (tipEl && tipEl.contains(e.relatedTarget)))) return;
    clearTimeout(hoverT);
    if (!pinned) scheduleHide();
  });
  document.addEventListener('click', function (e) {
    if (tipEl && tipEl.contains(e.target)) return;
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (t) {
      if (current === t && pinned) hide(); else show(t, true);
      return;
    }
    if (current) hide();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && current) { hide(); return; }
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (t && (e.key === 'Enter' || e.key === ' ') && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) { e.preventDefault(); show(t, true); }
  });
  window.addEventListener('scroll', function () { if (current && tipEl && !tipEl.classList.contains('sheet')) { if (pinned) place(current); else hide(); } }, true);
  window.addEventListener('resize', function () { if (current) hide(); });

  root.HBPTips = { reset: reset, attr: attr, hide: hide };
})(this);
