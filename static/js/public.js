// Shared logic for the public site: rewarded-ad modal used by /generate.
// No dependency on the authenticated app's JS — this runs for anonymous
// visitors who never log in.

(function () {
  'use strict';

  // Rotates while the user waits — purely motivational copy, not tied to
  // the actual verification (which is the timer + /api/ads/verify below).
  var MOTIVATIONAL_MESSAGES = [
    'Your ad supports free AI for everyone 🌍',
    'This 30-second ad funds schools in war zones 🏫',
    "You're helping someone who can't afford AI tools ❤️",
  ];

  function overallBar(done, total) {
    const filled = '█'.repeat(done);
    const empty = '░'.repeat(Math.max(0, total - done));
    return 'Progress: ' + filled + empty + ' ' + done + '/' + total;
  }

  // Loads the real HilltopAds in-page push tag into the modal's ad slot.
  // Note: this ad format renders as a browser-level notification/overlay
  // controlled by the ad network's own script, not as a graphic confined
  // to this div — there's no "ad finished" callback it exposes, so
  // completion is still verified by the timer + /api/ads/verify below
  // (same as how the existing reward-ad gate already worked).
  function loadRewardAd(slot) {
    slot.textContent = '';
    slot.style.width = '300px';
    slot.style.height = '250px';
    slot.style.margin = '0 auto';
    slot.style.overflow = 'hidden';

    (function(gmwczz){
      var d = document,
          s = d.createElement('script'),
          l = d.scripts[d.scripts.length - 1];
      s.settings = gmwczz || {};
      s.src = "//massivesalad.com/b.XyVhsDdLGllr0VYfWDc_/seQmm9xuTZSUqlFkxPhTgcGx/Npj/Am1POKDhkJt_NKzkEk2SMFDrUG5RMqwz";
      s.async = true;
      s.referrerPolicy = 'no-referrer-when-downgrade';
      slot.appendChild(s);
    })({});
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
      const slot = document.getElementById('pub-ad-slot');
      const fill = document.getElementById('pub-ad-progress-fill');
      const timeLabel = document.getElementById('pub-ad-time');
      const overall = document.getElementById('pub-ad-overall');
      const closeBtn = document.getElementById('pub-ad-close');
      const msg = document.getElementById('pub-ad-msg');

      overlay.classList.add('open');
      closeBtn.disabled = true;
      closeBtn.textContent = 'Close ❌';
      loadRewardAd(slot);

      let msgIndex = 0;
      msg.textContent = MOTIVATIONAL_MESSAGES[0];
      const msgTimer = setInterval(function () {
        msgIndex = (msgIndex + 1) % MOTIVATIONAL_MESSAGES.length;
        msg.textContent = MOTIVATIONAL_MESSAGES[msgIndex];
      }, 10000);

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
            clearInterval(msgTimer);
            msg.textContent = '🎉 All done! Generating your creation...';
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
            counter.textContent = '📺 Ad ' + adNumber + ' of ' + adCount;
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
                  msg.textContent = '✅ Ad complete! Loading next ad...';
                  setTimeout(function () { runAd(adNumber + 1); }, 1200);
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
            clearInterval(msgTimer);
            overlay.classList.remove('open');
          };
        })
        .catch(function () {
          clearInterval(msgTimer);
          overlay.classList.remove('open');
          reject(new Error('Could not start the ad. Please try again.'));
        });
    });
  };
})();
