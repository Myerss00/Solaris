// /impact page logic — external file so CSP's `script-src 'self'` covers
// it with no inline-script/nonce dependency.
(function () {
  fetch('/api/impact/stats').then(function (r) { return r.json(); }).then(function (stats) {
    const el = document.getElementById('pub-stat-images');
    if (!el) return;
    const target = stats.images_generated || 0;
    const duration = 1200;
    const start = performance.now();
    function step(now) {
      const progress = Math.min(1, (now - start) / duration);
      el.textContent = Math.floor(progress * target).toLocaleString('en-US');
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target.toLocaleString('en-US');
    }
    requestAnimationFrame(step);
  }).catch(function () {});
})();
