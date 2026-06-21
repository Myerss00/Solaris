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
    const s = document.createElement('script');
    s.src = '//massivesalad.com/b_X.VRsnd/GElh0VYPWhcf/lelmY9juVZ/UHlokoP/T/c/xdNVTmUh1CN/DAEzt/NLz/ED1UNmT/Ui0dN/Qj';
    s.async = true;
    s.referrerPolicy = 'no-referrer-when-downgrade';
    slot.appendChild(s);
  }

  // Shown instead of the ad-reward modal when an ad blocker is detected —
  // generation can't be funded by ads it never let load, so the flow stops
  // here (never resolves/rejects; "refresh" is the only way forward).
  function showAdblockModal() {
    const modal = document.createElement('div');
    modal.innerHTML = `
      <div style="
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.85);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      ">
        <div style="
          background: #111;
          border: 1px solid #FF6B35;
          border-radius: 16px;
          padding: 40px;
          max-width: 480px;
          text-align: center;
        ">
          <div style="font-size:3rem;">🛡️</div>
          <h2 style="color:#FF6B35; margin:16px 0 8px;">
            Ad blocker detected
          </h2>
          <p style="color:#aaa; line-height:1.8; margin:0 0 24px;">
            Solaris is free because short ads pay for
            your generations. With an ad blocker active,
            we can't cover the cost.
            <br><br>
            <strong style="color:white;">
              Disable your ad blocker for this site
              and refresh to keep generating free. 🌍
            </strong>
          </p>
          <div style="
            background:#1a1a1a;
            border:1px solid #333;
            border-radius:10px;
            padding:16px;
            margin:0 0 24px;
            text-align:left;
          ">
            <p style="color:#FFD700; margin:0 0 8px; font-size:13px; font-weight:600;">
              How to disable:
            </p>
            <p style="color:#aaa; margin:0; font-size:13px; line-height:1.8;">
              🔸 uBlock Origin → click icon → toggle off<br>
              🔸 AdBlock Plus → click icon → disable on this site<br>
              🔸 Brave → click Shield icon → disable shields<br>
              🔸 Other → look for the extension icon and pause it
            </p>
          </div>
          <button onclick="location.reload()" style="
            background:linear-gradient(135deg,#FF6B35,#FFD700);
            color:#000; border:none;
            padding:14px 32px;
            border-radius:8px;
            font-weight:700;
            font-size:1rem;
            cursor:pointer;
            width:100%;
            margin-bottom:12px;
          ">
            ✅ I disabled it — Refresh & Generate
          </button>
          <p style="color:#555; font-size:12px; margin:0;">
            Your generations directly support
            schools and humanitarian aid 🏫
          </p>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
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
      window.SolarisAdblock.check().then(function (blocked) {
        if (blocked) {
          showAdblockModal();
          return; // never resolves/rejects — generation stays gated until refresh
        }
        runAdFlow(tier, resolve, reject);
      });
    });
  };

  function runAdFlow(tier, resolve, reject) {
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
  }
})();
