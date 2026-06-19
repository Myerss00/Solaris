// /impact page logic — external file so CSP's `script-src 'self'` covers
// it with no inline-script/nonce dependency.
(function () {
  fetch('/api/impact/projects').then(function (r) { return r.json(); }).then(function (projects) {
    if (!projects.length) return;
    const wrap = document.getElementById('pub-projects');
    wrap.innerHTML = projects.map(function (p) {
      const pct = p.goal_usd > 0 ? Math.min(100, Math.round((p.raised_usd / p.goal_usd) * 100)) : 0;
      return (
        '<div class="pub-project-card">' +
        '<h4>' + (p.icon ? p.icon + ' ' : '') + escapeHtml(p.name) + '</h4>' +
        '<div class="pub-progress-bar"><div class="pub-progress-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="pub-project-amounts"><span>$' + p.raised_usd.toLocaleString('en-US') + '</span><span>$' + p.goal_usd.toLocaleString('en-US') + '</span></div>' +
        '</div>'
      );
    }).join('');
  }).catch(function () {});

  fetch('/api/impact/feed').then(function (r) { return r.json(); }).then(function (entries) {
    if (!entries.length) return;
    const wrap = document.getElementById('pub-feed');
    wrap.innerHTML = entries.map(function (e) {
      const date = new Date(e.occurred_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
      const amount = e.amount_usd != null ? '$' + e.amount_usd.toLocaleString('en-US') + ' — ' : '';
      return '<div class="pub-feed-item"><span>✅ ' + date + '</span><span>' + amount + escapeHtml(e.description) + '</span></div>';
    }).join('');
  }).catch(function () {});

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }
})();
