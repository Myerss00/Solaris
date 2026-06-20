// Landing page logic — external file so CSP's `script-src 'self'` covers
// it with no inline-script/nonce dependency.
(function () {
  const counterEl = document.getElementById('pub-live-counter');
  if (!counterEl) return;

  function refreshCounter() {
    fetch('/api/impact/stats').then(function (r) { return r.json(); }).then(function (stats) {
      const total = stats.images_generated || 0;
      counterEl.textContent = '🌍 ' + total.toLocaleString('en-US') + ' free generations and counting';
      counterEl.style.display = 'block';
    }).catch(function () {});
  }

  refreshCounter();
  setInterval(refreshCounter, 30000);
})();
