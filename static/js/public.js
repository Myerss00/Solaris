// Shared logic for the public site: rewarded-ad modal used by /generate.
// No dependency on the authenticated app's JS — this runs for anonymous
// visitors who never log in.

(function () {
  'use strict';

  function overallBar(done, total) {
    const filled = '█'.repeat(done);
    const empty = '░'.repeat(Math.max(0, total - done));
    return 'Progreso: ' + filled + empty + ' ' + done + '/' + total;
  }

  /**
   * Runs the full ad-reward flow for a tier: every tier requires watching
   * `ad_count` short ads back-to-back (no free tier). Resolves with the
   * spendable ad token once all ads have played and the server verifies the
   * elapsed time. Rejects if start/verify fails — the close button stays
   * disabled until the very last ad finishes.
   */
  window.pubRunAdFlow = function (tier) {
    return new Promise(function (resolve, reject) {
      const overlay = document.getElementById('pub-ad-modal');
      const counter = document.getElementById('pub-ad-counter');
      const fill = document.getElementById('pub-ad-progress-fill');
      const timeLabel = document.getElementById('pub-ad-time');
      const overall = document.getElementById('pub-ad-overall');
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
          const adCount = data.ad_count;
          const perAd = data.seconds_per_ad;

          function verifyAndResolve() {
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

          function runAd(adNumber) {
            counter.textContent = '📺 Anuncio ' + adNumber + ' de ' + adCount;
            overall.textContent = overallBar(adNumber - 1, adCount);
            let remaining = perAd;
            timeLabel.textContent = remaining;
            fill.style.width = '0%';

            const tick = setInterval(function () {
              remaining -= 1;
              const pct = Math.max(0, Math.min(100, ((perAd - remaining) / perAd) * 100));
              fill.style.width = pct + '%';
              timeLabel.textContent = Math.max(remaining, 0);
              if (remaining <= 0) {
                clearInterval(tick);
                overall.textContent = overallBar(adNumber, adCount);
                if (adNumber < adCount) {
                  runAd(adNumber + 1);
                } else {
                  closeBtn.disabled = false;
                  verifyAndResolve();
                }
              }
            }, 1000);
          }

          runAd(1);

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
