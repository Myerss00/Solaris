// Shared logic for the public site: rewarded-ad modal used by /generate.
// No dependency on the authenticated app's JS — this runs for anonymous
// visitors who never log in.

(function () {
  'use strict';

  /**
   * Runs the full ad-reward flow for a tier and resolves with the spendable
   * ad token once the wait completes and the server verifies it. Rejects if
   * start/verify fails — the modal never lets the user "skip" early since
   * the close button stays disabled until the countdown hits 0.
   */
  window.pubRunAdFlow = function (tier) {
    return new Promise(function (resolve, reject) {
      const overlay = document.getElementById('pub-ad-modal');
      const fill = document.getElementById('pub-ad-progress-fill');
      const timeLabel = document.getElementById('pub-ad-time');
      const closeBtn = document.getElementById('pub-ad-close');
      const msg = document.getElementById('pub-ad-msg');

      overlay.classList.add('open');
      closeBtn.disabled = true;
      closeBtn.textContent = 'Close ❌';
      msg.textContent = 'While you wait, your ad helps build schools in war zones 🌍';

      fetch('/api/ads/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: tier }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          const total = data.required_seconds;
          let remaining = total;
          timeLabel.textContent = remaining;
          fill.style.width = '0%';

          const tick = setInterval(function () {
            remaining -= 1;
            const pct = Math.max(0, Math.min(100, ((total - remaining) / total) * 100));
            fill.style.width = pct + '%';
            timeLabel.textContent = Math.max(remaining, 0);
            if (remaining <= 0) {
              clearInterval(tick);
              closeBtn.disabled = false;
              msg.textContent = '✅ Done! Processing your image...';
              fetch('/api/ads/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: data.token }),
              })
                .then(function (r) { return r.json().then(function (v) { return { ok: r.ok, v: v }; }); })
                .then(function (res) {
                  overlay.classList.remove('open');
                  if (res.ok) {
                    resolve(data.token);
                  } else {
                    reject(new Error('Could not verify the ad. Please try again.'));
                  }
                })
                .catch(function () {
                  overlay.classList.remove('open');
                  reject(new Error('Could not verify the ad. Please try again.'));
                });
            }
          }, 1000);

          closeBtn.onclick = function () {
            if (closeBtn.disabled) return;
            overlay.classList.remove('open');
          };
        })
        .catch(function () {
          overlay.classList.remove('open');
          reject(new Error('Could not start the ad. Please try again.'));
        });
    });
  };
})();
