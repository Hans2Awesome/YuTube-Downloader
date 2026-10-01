/**
 * YTDownload — Frontend Application
 * Handles cookies upload, video info fetching, download, and progress tracking.
 */
(() => {
  'use strict';

  // ─── State ──────────────────────────────────────
  const state = {
    cookiesPath: null,
    videoInfo: null,
    downloadId: null,
    selectedQuality: '1080',
    isLoading: false,
    isDownloading: false,
    pollTimer: null,
  };

  // ─── DOM Elements ───────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    // Cookies
    dropzone: $('#dropzone'),
    cookiesInput: $('#cookies-input'),
    cookiesStatus: $('#cookies-status'),
    cookiesFilename: $('#cookies-filename'),
    cookiesRemove: $('#cookies-remove'),

    // URL
    urlInput: $('#url-input'),
    fetchBtn: $('#fetch-btn'),

    // Loading
    loading: $('#loading'),

    // Video Info
    videoInfo: $('#video-info'),
    videoThumbnail: $('#video-thumbnail'),
    videoTitle: $('#video-title'),
    videoChannel: $('#video-channel'),
    videoViews: $('#video-views'),
    videoDuration: $('#video-duration-badge'),

    // Quality & Download
    stepQuality: $('#step-quality'),
    qualitySelector: $('#quality-selector'),
    downloadBtn: $('#download-btn'),

    // Progress
    progressSection: $('#progress-section'),
    progressLabel: $('#progress-label'),
    progressPercent: $('#progress-percent'),
    progressFill: $('#progress-fill'),
    progressSpeed: $('#progress-speed'),
    progressEta: $('#progress-eta'),

    // Complete
    downloadComplete: $('#download-complete'),
    downloadSize: $('#download-size'),
    saveBtn: $('#save-btn'),

    // Error
    errorBanner: $('#error-banner'),
    errorText: $('#error-text'),
    errorClose: $('#error-close'),
  };

  // ─── Helpers ────────────────────────────────────

  /** Format seconds to MM:SS or HH:MM:SS */
  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /** Format bytes to human-readable size */
  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  /** Format view count (e.g. 1.2M views) */
  function formatViews(count) {
    if (!count) return '0 views';
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K views`;
    return `${count} views`;
  }

  /** Show an error message */
  function showError(message) {
    dom.errorText.textContent = message;
    dom.errorBanner.hidden = false;
  }

  /** Hide the error banner */
  function hideError() {
    dom.errorBanner.hidden = true;
    dom.errorText.textContent = '';
  }

  /** Toggle loading state */
  function setLoading(loading) {
    state.isLoading = loading;
    dom.loading.hidden = !loading;
    dom.fetchBtn.disabled = loading;
  }

  /** JSON fetch helper */
  async function api(url, options = {}) {
    const res = await fetch(url, options);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // ─── Cookies Upload ─────────────────────────────

  function handleCookiesFile(file) {
    if (!file) return;

    // Basic validation
    if (!file.name.endsWith('.txt')) {
      showError('Please upload a .txt file (Netscape cookies format).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showError('File is too large. Cookies.txt should be under 5 MB.');
      return;
    }

    hideError();

    const formData = new FormData();
    formData.append('cookies', file);

    fetch('/api/upload-cookies', { method: 'POST', body: formData })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);

        state.cookiesPath = data.cookiesPath;
        dom.cookiesFilename.textContent = `${data.filename} uploaded ✓`;
        dom.dropzone.hidden = true;
        dom.cookiesStatus.hidden = false;
      })
      .catch((err) => {
        showError(`Failed to upload cookies: ${err.message}`);
      });
  }

  function removeCookies() {
    state.cookiesPath = null;
    dom.dropzone.hidden = false;
    dom.cookiesStatus.hidden = true;
    dom.cookiesInput.value = '';
  }

  // Dropzone events
  dom.dropzone.addEventListener('click', () => dom.cookiesInput.click());
  dom.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dom.cookiesInput.click();
    }
  });

  dom.cookiesInput.addEventListener('change', (e) => {
    handleCookiesFile(e.target.files[0]);
  });

  // Drag & Drop
  ['dragenter', 'dragover'].forEach((evt) => {
    dom.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dom.dropzone.classList.add('dropzone--dragover');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dom.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dom.dropzone.classList.remove('dropzone--dragover');
    });
  });

  dom.dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files[0];
    handleCookiesFile(file);
  });

  dom.cookiesRemove.addEventListener('click', removeCookies);

  // ─── Fetch Video Info ───────────────────────────

  async function fetchVideoInfo() {
    const url = dom.urlInput.value.trim();

    if (!url) {
      showError('Please enter a YouTube video URL.');
      dom.urlInput.focus();
      return;
    }

    // Basic URL validation
    if (!url.includes('youtube.com/') && !url.includes('youtu.be/')) {
      showError('Please enter a valid YouTube URL (youtube.com or youtu.be).');
      return;
    }

    hideError();
    setLoading(true);

    // Reset previous state
    dom.videoInfo.hidden = true;
    dom.stepQuality.hidden = true;
    dom.progressSection.hidden = true;
    dom.downloadComplete.hidden = true;
    state.videoInfo = null;

    try {
      const info = await api('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          cookiesPath: state.cookiesPath,
        }),
      });

      state.videoInfo = info;

      // Populate video info UI
      dom.videoThumbnail.src = info.thumbnail;
      dom.videoThumbnail.alt = info.title;
      dom.videoTitle.textContent = info.title;
      dom.videoChannel.textContent = info.channel;
      dom.videoViews.textContent = formatViews(info.viewCount);
      dom.videoDuration.textContent = formatDuration(info.duration);

      // Show sections
      dom.videoInfo.hidden = false;
      dom.stepQuality.hidden = false;
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  dom.fetchBtn.addEventListener('click', fetchVideoInfo);
  dom.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchVideoInfo();
  });

  // ─── Quality Selector ──────────────────────────

  const qualityBtns = $$('.quality-btn');

  qualityBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      qualityBtns.forEach((b) => b.classList.remove('quality-btn--active'));
      btn.classList.add('quality-btn--active');
      state.selectedQuality = btn.dataset.quality;
    });
  });

  // ─── Download ───────────────────────────────────

  async function startDownload() {
    const url = dom.urlInput.value.trim();

    if (!url || !state.videoInfo) {
      showError('Please fetch video info first.');
      return;
    }

    if (state.isDownloading) return;
    state.isDownloading = true;

    hideError();
    dom.downloadBtn.disabled = true;
    dom.downloadBtn.querySelector('span').textContent = 'Starting...';

    // Show progress section
    dom.progressSection.hidden = false;
    dom.downloadComplete.hidden = true;
    dom.progressFill.style.width = '0%';
    dom.progressPercent.textContent = '0%';
    dom.progressLabel.textContent = 'Preparing download...';
    dom.progressSpeed.textContent = '—';
    dom.progressEta.textContent = 'ETA: calculating...';

    try {
      const data = await api('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          cookiesPath: state.cookiesPath,
          quality: state.selectedQuality,
          title: state.videoInfo.title,
        }),
      });

      state.downloadId = data.id;
      startProgressPolling(data.id);
    } catch (err) {
      showError(err.message);
      resetDownloadButton();
    }
  }

  dom.downloadBtn.addEventListener('click', startDownload);

  // ─── Progress Polling ──────────────────────────

  function startProgressPolling(id) {
    // Clear previous polling
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
    }

    state.pollTimer = setInterval(async () => {
      try {
        const status = await api(`/api/status/${id}`);

        // Update progress UI
        dom.progressFill.style.width = `${status.progress}%`;
        dom.progressPercent.textContent = `${Math.round(status.progress)}%`;

        // Update status label
        switch (status.status) {
          case 'starting':
            dom.progressLabel.textContent = 'Starting download...';
            break;
          case 'downloading':
            dom.progressLabel.textContent = 'Downloading...';
            break;
          case 'merging':
            dom.progressLabel.textContent = 'Merging video & audio...';
            break;
          case 'processing':
            dom.progressLabel.textContent = 'Processing...';
            break;
          case 'completed':
            handleDownloadComplete(id, status);
            return;
          case 'error':
            handleDownloadError(status.error);
            return;
        }

        // Speed & ETA
        if (status.speed) dom.progressSpeed.textContent = status.speed;
        if (status.eta) dom.progressEta.textContent = `ETA: ${status.eta}`;

      } catch (err) {
        // If polling fails, don't stop — could be a transient error
        console.warn('Polling error:', err.message);
      }
    }, 500);
  }

  function handleDownloadComplete(id, status) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;

    // Update progress to 100%
    dom.progressFill.style.width = '100%';
    dom.progressPercent.textContent = '100%';
    dom.progressLabel.textContent = 'Complete!';
    dom.progressSpeed.textContent = '';
    dom.progressEta.textContent = '';

    // Show download complete section
    setTimeout(() => {
      dom.progressSection.hidden = true;
      dom.downloadComplete.hidden = false;

      if (status.filesize) {
        dom.downloadSize.textContent = `File size: ${formatFileSize(status.filesize)}`;
      }

      dom.saveBtn.href = `/api/file/${id}`;
    }, 600);

    resetDownloadButton();
  }

  function handleDownloadError(errorMsg) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;

    dom.progressSection.hidden = true;
    showError(errorMsg || 'Download failed. Please check your URL and cookies.');
    resetDownloadButton();
  }

  function resetDownloadButton() {
    state.isDownloading = false;
    dom.downloadBtn.disabled = false;
    dom.downloadBtn.querySelector('span').textContent = 'Download Video';
  }

  // ─── Error Close ────────────────────────────────
  dom.errorClose.addEventListener('click', hideError);

  // ─── Keyboard Shortcut ──────────────────────────
  // Ctrl+V in URL input → auto-paste and fetch
  dom.urlInput.addEventListener('paste', () => {
    // Small delay to let the paste complete
    setTimeout(() => {
      if (dom.urlInput.value.trim() && !state.isLoading) {
        fetchVideoInfo();
      }
    }, 100);
  });

})();
