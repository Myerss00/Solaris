// Landing page logic — external file so CSP's `script-src 'self'` covers
// it with no inline-script/nonce dependency.
(function () {
  // Animate the impact counters from 0 to their real (admin-set) value,
  // fetched live — no hardcoded numbers here.
  fetch('/api/impact/stats').then(function (r) { return r.json(); }).then(function (stats) {
    const order = ['images_generated', 'videos_created', 'donated_usd', 'schools_funded'];
    const nums = document.querySelectorAll('#pub-counters .num');
    nums.forEach(function (el, i) {
      const target = stats[order[i]] || 0;
      const prefix = el.dataset.prefix || '';
      const duration = 1200;
      const start = performance.now();
      function step(now) {
        const progress = Math.min(1, (now - start) / duration);
        el.textContent = prefix + Math.floor(progress * target).toLocaleString('en-US');
        if (progress < 1) requestAnimationFrame(step);
        else el.textContent = prefix + target.toLocaleString('en-US');
      }
      requestAnimationFrame(step);
    });
  }).catch(function () {});
})();
