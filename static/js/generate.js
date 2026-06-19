// /generate page logic — external file so CSP's `script-src 'self'`
// covers it with no inline-script/nonce dependency at all.
(function () {
  // ---- Tabs ----
  document.querySelectorAll('.pub-tabs > .pub-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.pub-tabs > .pub-tab').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.pub-panel').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });
  const hash = (location.hash || '').replace('#', '');
  if (hash) {
    const target = document.querySelector('.pub-tab[data-tab="' + hash + '"]');
    if (target) target.click();
  }

  // ---- Chip selectors ----
  function wireChipRow(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    row.querySelectorAll('.pub-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        row.querySelectorAll('.pub-chip').forEach(function (c) { c.classList.remove('selected'); });
        chip.classList.add('selected');
      });
    });
  }
  wireChipRow('img-style-row');
  wireChipRow('img-quality-row');

  // ---- Image generation ----
  const result = document.getElementById('result');
  const spinner = document.getElementById('spinner');
  const imageResult = document.getElementById('image-result');
  const errorResult = document.getElementById('error-result');
  const generatedImage = document.getElementById('generated-image');
  const spinnerText = document.getElementById('spinner-text');
  let lastImageDataUrl = null;

  function showSpinner(text) {
    spinnerText.textContent = text || '⏳ Generating your image... this can take 15-30 seconds';
    result.style.display = 'block';
    spinner.style.display = 'block';
    imageResult.style.display = 'none';
    errorResult.style.display = 'none';
  }
  function showImage(dataUrl) {
    lastImageDataUrl = dataUrl;
    generatedImage.src = dataUrl;
    spinner.style.display = 'none';
    errorResult.style.display = 'none';
    imageResult.style.display = 'block';
  }
  function showError(message) {
    result.style.display = 'block';
    spinner.style.display = 'none';
    imageResult.style.display = 'none';
    errorResult.textContent = message;
    errorResult.style.display = 'block';
  }

  document.getElementById('download-btn').addEventListener('click', function () {
    if (!lastImageDataUrl) return;
    const a = document.createElement('a');
    a.href = lastImageDataUrl;
    a.download = 'solaris.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  document.getElementById('generate-again-btn').addEventListener('click', function () {
    result.style.display = 'none';
  });

  function callGenerate(quality, style, prompt, adToken) {
    showSpinner();
    fetch('/api/generate/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt, style: style, quality: quality, ad_token: adToken || null }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          showImage(data.image_data_url);
        } else {
          // Friendly message only — never the raw error/exception.
          showError(data.message || 'Could not generate. Please try again.');
        }
      })
      .catch(function () {
        showError('Could not generate. Please try again.');
      });
  }

  document.getElementById('img-generate-btn').addEventListener('click', function () {
    const prompt = document.getElementById('img-prompt').value.trim();
    if (!prompt) { showError('Write a description first.'); return; }

    const style = document.querySelector('#img-style-row .selected').dataset.value;
    const quality = document.querySelector('#img-quality-row .selected').dataset.value; // "basic" | "hd" | "4k"

    if (quality === 'basic') {
      callGenerate('basic', style, prompt, null);
    } else {
      window.pubRunAdFlow(quality)
        .then(function (token) { callGenerate(quality, style, prompt, token); })
        .catch(function (e) { showError(e.message || 'Could not verify the ad.'); });
    }
  });

  // ---- "Notify me" signups for video/audio ----
  function wireSignup(prefix, feature) {
    const btn = document.getElementById(prefix + '-signup-btn');
    const input = document.getElementById(prefix + '-signup-email');
    const msg = document.getElementById(prefix + '-signup-msg');
    btn.addEventListener('click', function () {
      const email = input.value.trim();
      if (!email) { msg.textContent = 'Write your email first.'; return; }
      msg.textContent = 'Saving...';
      fetch('/api/notify/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, feature: feature }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          msg.textContent = res.ok ? "✅ Done! We'll let you know when it's ready." : (res.d.detail || 'Could not save. Please try again.');
        })
        .catch(function () { msg.textContent = 'Could not save. Please try again.'; });
    });
  }
  wireSignup('video', 'video');
  wireSignup('audio', 'audio');
})();
