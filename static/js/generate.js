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

  // ---- Sub-tabs (e.g. Images: Generate/Edit Image, Text: Generate/Documents) ----
  function wireSubtabs(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const panelRoot = container.parentElement;
    container.querySelectorAll('.pub-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.pub-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        panelRoot.querySelectorAll('.pub-subpanel').forEach(function (p) { p.classList.remove('active'); });
        document.getElementById(btn.dataset.subtab + '-subpanel').classList.add('active');
      });
    });
  }
  wireSubtabs('img-subtabs');
  wireSubtabs('text-subtabs');

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

    window.open('https://pleased-report.com/bi3/V.0sPr3Hpev/bHmjVIJEZsDv0/3sMnT/UA1/NWTnU-3gLZTNc/xEN/TNUo1HNnjQEj', '_blank');
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

    window.open('https://pleased-report.com/bi3/V.0sPr3Hpev/bHmjVIJEZsDv0/3sMnT/UA1/NWTnU-3gLZTNc/xEN/TNUo1HNnjQEj', '_blank');
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

  // ---- Image editing ----
  const imgEditUploadZone = document.getElementById('img-edit-upload-zone');
  const imgEditFileInput = document.getElementById('img-edit-file-input');
  const imgEditPreview = document.getElementById('img-edit-preview');
  const imgEditUploadLabel = document.getElementById('img-edit-upload-label');
  const imgEditResultWrap = document.getElementById('img-edit-result-wrap');
  const imgEditSpinner = document.getElementById('img-edit-spinner');
  const imgEditResult = document.getElementById('img-edit-result');
  const imgEditErrorResult = document.getElementById('img-edit-error-result');
  const imgEditNote = document.getElementById('img-edit-note');
  let imgEditDataUrl = null;
  let lastImgEditUrl = null;

  function wireUploadZone(zone, input, onFile) {
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', function () {
      if (input.files[0]) onFile(input.files[0]);
    });
  }

  wireUploadZone(imgEditUploadZone, imgEditFileInput, function (file) {
    if (file.size > 10 * 1024 * 1024) { showImgEditError('Image must be 10MB or smaller.'); return; }
    const reader = new FileReader();
    reader.onload = function () {
      imgEditDataUrl = reader.result;
      imgEditPreview.src = imgEditDataUrl;
      imgEditPreview.style.display = 'block';
      imgEditUploadLabel.textContent = file.name;
    };
    reader.readAsDataURL(file);
  });

  function showImgEditSpinner() {
    imgEditResultWrap.style.display = 'block';
    imgEditSpinner.style.display = 'block';
    imgEditResult.style.display = 'none';
    imgEditErrorResult.style.display = 'none';
  }
  function showImgEditResult(originalUrl, editedUrl, note) {
    lastImgEditUrl = editedUrl;
    document.getElementById('img-edit-original').src = originalUrl;
    document.getElementById('img-edit-edited').src = editedUrl;
    if (note) { imgEditNote.textContent = note; imgEditNote.style.display = 'block'; }
    else { imgEditNote.style.display = 'none'; }
    imgEditSpinner.style.display = 'none';
    imgEditErrorResult.style.display = 'none';
    imgEditResult.style.display = 'block';
  }
  function showImgEditError(message) {
    imgEditResultWrap.style.display = 'block';
    imgEditSpinner.style.display = 'none';
    imgEditResult.style.display = 'none';
    imgEditErrorResult.textContent = message;
    imgEditErrorResult.style.display = 'block';
  }

  document.getElementById('img-edit-download-btn').addEventListener('click', function () {
    if (!lastImgEditUrl) return;
    const a = document.createElement('a');
    a.href = lastImgEditUrl;
    a.download = 'solaris-edited.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  document.getElementById('img-edit-again-btn').addEventListener('click', function () {
    imgEditResultWrap.style.display = 'none';
  });

  document.getElementById('img-edit-btn').addEventListener('click', function () {
    if (!imgEditDataUrl) { showImgEditError('Upload an image first.'); return; }
    const prompt = document.getElementById('img-edit-prompt').value.trim();
    if (!prompt) { showImgEditError('Describe what you want to change first.'); return; }
    const originalUrl = imgEditDataUrl;

    window.open('https://pleased-report.com/bi3/V.0sPr3Hpev/bHmjVIJEZsDv0/3sMnT/UA1/NWTnU-3gLZTNc/xEN/TNUo1HNnjQEj', '_blank');
    window.pubRunAdFlow('image_edit')
      .then(function (token) {
        showImgEditSpinner();
        return fetch('/api/generate/image-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imgEditDataUrl, prompt: prompt, ad_token: token }),
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          showImgEditResult(originalUrl, data.image_url, data.message);
        } else {
          showImgEditError(data.message || 'Could not edit the image. Please try again.');
        }
      })
      .catch(function (e) {
        showImgEditError((e && e.message) || 'Could not edit the image. Please try again.');
      });
  });

  // ---- Document conversion ----
  const DOC_TARGETS = { pdf: ['docx', 'txt'], docx: ['pdf', 'txt'], doc: ['pdf', 'txt'], txt: ['pdf', 'docx'] };
  const DOC_TARGET_LABELS = { pdf: 'PDF', docx: 'Word .docx', txt: 'Text .txt' };
  const docUploadZone = document.getElementById('doc-upload-zone');
  const docFileInput = document.getElementById('doc-file-input');
  const docUploadLabel = document.getElementById('doc-upload-label');
  const docFileName = document.getElementById('doc-file-name');
  const docTargetField = document.getElementById('doc-target-field');
  const docTargetRow = document.getElementById('doc-target-row');
  const docConvertBtn = document.getElementById('doc-convert-btn');
  const docResultWrap = document.getElementById('doc-result-wrap');
  const docSpinner = document.getElementById('doc-spinner');
  const docResult = document.getElementById('doc-result');
  const docErrorResult = document.getElementById('doc-error-result');
  let docFile = null;
  let docTargetFormat = null;

  function updateDocConvertBtn() {
    docConvertBtn.disabled = !(docFile && docTargetFormat);
  }

  wireUploadZone(docUploadZone, docFileInput, function (file) {
    if (file.size > 20 * 1024 * 1024) { showDocError('File must be 20MB or smaller.'); return; }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const targets = DOC_TARGETS[ext];
    if (!targets) { showDocError('Unsupported file type — upload a PDF, DOCX, DOC, or TXT file.'); return; }

    docFile = file;
    docTargetFormat = null;
    docUploadLabel.textContent = file.name;
    docFileName.textContent = 'Selected: ' + file.name;
    docFileName.style.display = 'block';
    docResultWrap.style.display = 'none';

    docTargetRow.innerHTML = '';
    targets.forEach(function (fmt) {
      const chip = document.createElement('div');
      chip.className = 'pub-chip';
      chip.dataset.value = fmt;
      chip.textContent = 'Convert to ' + DOC_TARGET_LABELS[fmt];
      chip.addEventListener('click', function () {
        docTargetRow.querySelectorAll('.pub-chip').forEach(function (c) { c.classList.remove('selected'); });
        chip.classList.add('selected');
        docTargetFormat = fmt;
        updateDocConvertBtn();
      });
      docTargetRow.appendChild(chip);
    });
    docTargetField.style.display = 'block';
    updateDocConvertBtn();
  });

  function showDocSpinner() {
    docResultWrap.style.display = 'block';
    docSpinner.style.display = 'block';
    docResult.style.display = 'none';
    docErrorResult.style.display = 'none';
  }
  function showDocResult(message) {
    docSpinner.style.display = 'none';
    docErrorResult.style.display = 'none';
    docResult.textContent = message;
    docResult.style.display = 'block';
  }
  function showDocError(message) {
    docResultWrap.style.display = 'block';
    docSpinner.style.display = 'none';
    docResult.style.display = 'none';
    docErrorResult.textContent = message;
    docErrorResult.style.display = 'block';
  }

  docConvertBtn.addEventListener('click', function () {
    if (!docFile || !docTargetFormat) return;

    window.open('https://pleased-report.com/bi3/V.0sPr3Hpev/bHmjVIJEZsDv0/3sMnT/UA1/NWTnU-3gLZTNc/xEN/TNUo1HNnjQEj', '_blank');
    window.pubRunAdFlow('doc_convert')
      .then(function (token) {
        showDocSpinner();
        const formData = new FormData();
        formData.append('file', docFile);
        formData.append('target_format', docTargetFormat);
        formData.append('ad_token', token);
        return fetch('/api/convert/document', { method: 'POST', body: formData });
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          showDocResult('✅ Converted! Downloading ' + data.filename + '...');
          const a = document.createElement('a');
          a.href = data.download_url;
          a.download = data.filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else {
          showDocError(data.message || 'Could not convert this file. Please try again.');
        }
      })
      .catch(function (e) {
        showDocError((e && e.message) || 'Could not convert this file. Please try again.');
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

    window.open('https://pleased-report.com/bi3/V.0sPr3Hpev/bHmjVIJEZsDv0/3sMnT/UA1/NWTnU-3gLZTNc/xEN/TNUo1HNnjQEj', '_blank');
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
