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

    window.pubRunAdFlow(quality)
      .then(function (token) { callGenerate(quality, style, prompt, token); })
      .catch(function (e) { showError(e.message || 'Could not verify the ad.'); });
  });

  // ---- Audio generation (text-to-speech) ----
  const audioResultWrap = document.getElementById('audio-result-wrap');
  const audioSpinner = document.getElementById('audio-spinner');
  const audioResult = document.getElementById('audio-result');
  const audioErrorResult = document.getElementById('audio-error-result');
  const generatedAudio = document.getElementById('generated-audio');
  let lastAudioUrl = null;

  function showAudioSpinner() {
    audioResultWrap.style.display = 'block';
    audioSpinner.style.display = 'block';
    audioResult.style.display = 'none';
    audioErrorResult.style.display = 'none';
  }
  function showAudio(url) {
    lastAudioUrl = url;
    generatedAudio.src = url;
    audioSpinner.style.display = 'none';
    audioErrorResult.style.display = 'none';
    audioResult.style.display = 'block';
  }
  function showAudioError(message) {
    audioResultWrap.style.display = 'block';
    audioSpinner.style.display = 'none';
    audioResult.style.display = 'none';
    audioErrorResult.textContent = message;
    audioErrorResult.style.display = 'block';
  }

  document.getElementById('audio-download-btn').addEventListener('click', function () {
    if (!lastAudioUrl) return;
    const a = document.createElement('a');
    a.href = lastAudioUrl;
    a.download = 'solaris-audio.wav';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  document.getElementById('audio-generate-again-btn').addEventListener('click', function () {
    audioResultWrap.style.display = 'none';
  });

  document.getElementById('audio-generate-btn').addEventListener('click', function () {
    const text = document.getElementById('audio-text').value.trim();
    if (!text) { showAudioError('Write some text first.'); return; }
    const voice = document.getElementById('audio-voice').value;

    window.pubRunAdFlow('audio')
      .then(function (token) {
        showAudioSpinner();
        return fetch('/api/generate/audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, voice: voice, ad_token: token }),
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          showAudio(data.audio_url);
        } else {
          showAudioError(data.message || 'Could not generate. Please try again.');
        }
      })
      .catch(function (e) {
        showAudioError((e && e.message) || 'Could not generate. Please try again.');
      });
  });

  // ---- Text generation (posts, scripts, email, translate, summarize) ----
  const textResultWrap = document.getElementById('text-result-wrap');
  const textSpinner = document.getElementById('text-spinner');
  const textResult = document.getElementById('text-result');
  const textErrorResult = document.getElementById('text-error-result');
  const textOutput = document.getElementById('text-output');

  function showTextSpinner() {
    textResultWrap.style.display = 'block';
    textSpinner.style.display = 'block';
    textResult.style.display = 'none';
    textErrorResult.style.display = 'none';
  }
  function showText(text) {
    textOutput.textContent = text;
    textSpinner.style.display = 'none';
    textErrorResult.style.display = 'none';
    textResult.style.display = 'block';
  }
  function showTextError(message) {
    textResultWrap.style.display = 'block';
    textSpinner.style.display = 'none';
    textResult.style.display = 'none';
    textErrorResult.textContent = message;
    textErrorResult.style.display = 'block';
  }

  document.getElementById('text-copy-btn').addEventListener('click', function () {
    navigator.clipboard.writeText(textOutput.textContent || '');
  });
  document.getElementById('text-generate-again-btn').addEventListener('click', function () {
    textResultWrap.style.display = 'none';
  });

  document.getElementById('text-generate-btn').addEventListener('click', function () {
    const prompt = document.getElementById('text-prompt').value.trim();
    if (!prompt) { showTextError('Write something first.'); return; }
    const task = document.getElementById('text-task').value;

    window.pubRunAdFlow('text')
      .then(function (token) {
        showTextSpinner();
        return fetch('/api/generate/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: prompt, task: task, ad_token: token }),
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          showText(data.text);
        } else {
          showTextError(data.message || 'Could not generate. Please try again.');
        }
      })
      .catch(function (e) {
        showTextError((e && e.message) || 'Could not generate. Please try again.');
      });
  });
})();
