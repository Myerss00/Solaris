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

  async function checkAdblockBanner() {
    const blocked = await window.SolarisAdblock.check();
    if (!blocked) return;

    const banner = document.createElement('div');
    banner.id = 'adblock-banner';
    banner.innerHTML = `
      <div style="
        background: #FF6B35;
        color: white;
        padding: 12px 20px;
        text-align: center;
        font-size: 14px;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
      ">
        <span>🛡️ Ad blocker detected — Please disable it for solarisfortheworld.com to generate for free and support humanitarian causes 🌍</span>
      </div>
    `;
    document.body.prepend(banner);
    document.body.style.paddingTop = '48px';
  }

  checkAdblockBanner();
})();
