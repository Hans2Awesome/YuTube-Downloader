const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Config ───────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// Create directories
[UPLOADS_DIR, DOWNLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Middleware ────────────────────────────────────────────
app.use(express.json({ type: 'application/json' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Request logger (debug)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  }
  next();
});

// Multer for file uploads
const upload = multer({ dest: UPLOADS_DIR });

// In-memory download tracker
const downloads = new Map();

// ─── Path & Cookies Helpers ────────────────────────────────

/**
 * Resolves a cookies file path whether provided as Windows path (C:\...) or WSL/Linux path (/mnt/c/...)
 */
function resolveCookiesPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  const trimmed = filePath.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return null;

  // Direct check
  if (fs.existsSync(trimmed)) return trimmed;

  // If running on WSL/Linux and given a Windows path (e.g. C:\Users\... or C:/Users/...)
  if (process.platform === 'linux') {
    const winMatch = trimmed.match(/^([a-zA-Z]):[/\\](.*)/);
    if (winMatch) {
      const drive = winMatch[1].toLowerCase();
      const rest = winMatch[2].replace(/\\/g, '/');
      const wslPath = `/mnt/${drive}/${rest}`;
      if (fs.existsSync(wslPath)) return wslPath;
    }
  }

  // If running on Windows and given a WSL path (e.g. /mnt/c/...)
  if (process.platform === 'win32') {
    const wslMatch = trimmed.match(/^\/mnt\/([a-zA-Z])\/(.*)/);
    if (wslMatch) {
      const drive = wslMatch[1].toUpperCase();
      const rest = wslMatch[2].replace(/\//g, '\\');
      const winPath = `${drive}:\\${rest}`;
      if (fs.existsSync(winPath)) return winPath;
    }
  }

  return null;
}

/**
 * Check if a default cookies.txt exists in Downloads or workspace
 */
function getDefaultCookiesInfo() {
  const candidates = [];
  if (process.platform === 'linux') {
    candidates.push({
      path: '/mnt/c/Users/server lemahabang/Downloads/cookies.txt',
      display: 'C:\\Users\\server lemahabang\\Downloads\\cookies.txt'
    });
  } else {
    candidates.push({
      path: 'C:\\Users\\server lemahabang\\Downloads\\cookies.txt',
      display: 'C:\\Users\\server lemahabang\\Downloads\\cookies.txt'
    });
  }
  candidates.push({
    path: path.join(__dirname, 'cookies.txt'),
    display: 'cookies.txt (workspace)'
  });

  for (const c of candidates) {
    if (fs.existsSync(c.path)) {
      return { found: true, path: c.path, display: c.display };
    }
  }
  return { found: false, path: null, display: null };
}

/**
 * Builds base yt-dlp arguments with JS runtime support
 */
function getBaseYtdlpArgs(effectiveCookies) {
  const args = [
    '--no-playlist',
    '--no-js-runtimes',
    '--js-runtimes', 'node',
  ];
  if (effectiveCookies && fs.existsSync(effectiveCookies)) {
    args.push('--cookies', effectiveCookies);
  }
  return args;
}

// ─── Routes ───────────────────────────────────────────────

/**
 * GET /api/cookies-info
 * Returns whether default cookies are detected
 */
app.get('/api/cookies-info', (req, res) => {
  const def = getDefaultCookiesInfo();
  res.json({
    hasDefault: def.found,
    defaultPath: def.path,
    displayPath: def.display
  });
});

/**
 * POST /api/validate-cookies
 * Validates a custom cookies path
 */
app.post('/api/validate-cookies', (req, res) => {
  const { path: userPath } = req.body || {};
  const resolved = resolveCookiesPath(userPath);
  if (resolved) {
    return res.json({ valid: true, resolvedPath: resolved });
  }
  res.status(400).json({ error: 'File cookies tidak ditemukan di path tersebut.' });
});

/**
 * POST /api/upload-cookies
 * Upload a cookies.txt file (Netscape format)
 */
app.post('/api/upload-cookies', upload.single('cookies'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Rename to .txt extension for yt-dlp compatibility
  const newPath = req.file.path + '.txt';
  fs.renameSync(req.file.path, newPath);

  res.json({
    success: true,
    cookiesPath: newPath,
    filename: req.file.originalname
  });
});

/**
 * POST /api/info
 * Fetch video metadata using yt-dlp --dump-json
 */
app.post('/api/info', (req, res) => {
  const body = req.body || {};
  const { url, cookiesPath } = body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Determine effective cookies path: explicit param > default location
  const resolvedPath = resolveCookiesPath(cookiesPath);
  const defaultInfo = getDefaultCookiesInfo();
  const effectiveCookies = resolvedPath || (defaultInfo.found ? defaultInfo.path : null);

  const args = [
    '--dump-json',
    '--no-download',
    ...getBaseYtdlpArgs(effectiveCookies),
    url
  ];

  console.log(`🔍 Fetching info for: ${url} (Cookies: ${effectiveCookies || 'none'})`);

  const proc = spawn('yt-dlp', args);
  let stdout = '';
  let stderr = '';
  let responded = false;

  proc.stdout.on('data', (data) => { stdout += data.toString(); });
  proc.stderr.on('data', (data) => { stderr += data.toString(); });

  proc.on('close', (code) => {
    if (responded) return;
    responded = true;

    if (code !== 0) {
      let errorMsg = 'Gagal mengambil informasi video.';
      if (stderr.includes('Join this channel') || stderr.includes('members-only')) {
        if (effectiveCookies) {
          errorMsg = 'Akun di cookies.txt tidak memiliki akses langganan (membership) ke channel ini. Pastikan cookies diekspor dari akun yang sudah bergabung/join ke channel tersebut.';
        } else {
          errorMsg = 'Video ini khusus member (Members-only). Silakan upload atau pilih file cookies.txt dari akun YouTube yang sudah berlangganan channel ini.';
        }
      } else if (stderr.includes('The page needs to be reloaded')) {
        errorMsg = 'YouTube meminta verifikasi reload. Silakan coba klik Fetch Info sekali lagi.';
      } else if (stderr.includes('Sign in to confirm') || stderr.includes('bot')) {
        errorMsg = 'YouTube meminta verifikasi login/bot. Pastikan cookies.txt Anda masih aktif dan diekspor dari browser yang login.';
      } else if (stderr.includes('cookies') || stderr.includes('expired')) {
        errorMsg = 'Cookies kedaluwarsa atau tidak valid. Silakan ekspor ulang cookies.txt.';
      } else if (stderr.includes('not available') || stderr.includes('Private video')) {
        errorMsg = 'Video ini tidak tersedia, bersifat privat, atau dibatasi wilayah.';
      } else if (stderr.includes('Unsupported URL')) {
        errorMsg = 'URL tidak didukung. Masukkan link YouTube yang valid.';
      } else if (stderr) {
        errorMsg = stderr.split('\n').filter(l => l.startsWith('ERROR')).join(' ') || stderr.substring(0, 300);
      }
      return res.status(500).json({ error: errorMsg });
    }

    try {
      const info = JSON.parse(stdout);
      res.json({
        title: info.title || 'Unknown Title',
        thumbnail: info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || '',
        duration: info.duration || 0,
        channel: info.channel || info.uploader || 'Unknown Channel',
        viewCount: info.view_count || info.like_count || 0,
        availability: info.availability || 'public',
        usedCookies: !!effectiveCookies,
      });
    } catch (e) {
      res.status(500).json({ error: 'Gagal memproses data video.' });
    }
  });

  // Timeout: 35 seconds
  setTimeout(() => {
    if (responded) return;
    responded = true;
    proc.kill();
    res.status(504).json({ error: 'Permintaan timed out. Koneksi lambat atau YouTube sedang merespons lama.' });
  }, 35000);
});

/**
 * POST /api/download
 * Start downloading a video with yt-dlp
 */
app.post('/api/download', (req, res) => {
  const body = req.body || {};
  const { url, cookiesPath, quality, title } = body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const id = uuidv4();
  const outputTemplate = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);

  const resolvedPath = resolveCookiesPath(cookiesPath);
  const defaultInfo = getDefaultCookiesInfo();
  const effectiveCookies = resolvedPath || (defaultInfo.found ? defaultInfo.path : null);

  const args = [
    '--newline',
    '--progress',
    ...getBaseYtdlpArgs(effectiveCookies),
  ];

  if (quality === 'audio') {
    args.push('-f', 'bestaudio/best');
    args.push('--extract-audio', '--audio-format', 'mp3');
  } else {
    const height = quality || '1080';
    args.push('-f', `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`);
    args.push('--merge-output-format', 'mp4');
  }

  args.push('-o', outputTemplate);
  args.push(url);


  // Initialize download record
  downloads.set(id, {
    status: 'starting',
    progress: 0,
    speed: '',
    eta: '',
    filename: '',
    title: title || 'video',
    filesize: 0,
    error: null,
    startedAt: Date.now()
  });

  console.log(`📥 Starting download [${id}]: ${url} @ ${quality || '1080'}p`);

  const proc = spawn('yt-dlp', args);

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    const dl = downloads.get(id);
    if (!dl) return;

    for (const line of lines) {
      // Download progress: [download]  45.3% of ~123.45MiB at 2.34MiB/s ETA 00:18
      const progressMatch = line.match(/([\d.]+)%/);
      if (progressMatch) {
        dl.progress = parseFloat(progressMatch[1]);
        dl.status = 'downloading';
      }

      const speedMatch = line.match(/at\s+([\d.]+\s*\S+\/s)/);
      if (speedMatch) dl.speed = speedMatch[1];

      const etaMatch = line.match(/ETA\s+([\d:]+)/);
      if (etaMatch) dl.eta = etaMatch[1];

      // Merging phase
      if (line.includes('Merging formats') || line.includes('[Merger]')) {
        dl.status = 'merging';
        dl.progress = 99;
        dl.speed = '';
        dl.eta = '';
      }

      // Post-processing (audio extraction, etc.)
      if (line.includes('Extracting audio') || line.includes('[ExtractAudio]') || line.includes('[PostProcess]')) {
        dl.status = 'processing';
        dl.progress = 99;
      }

      // Already downloaded
      if (line.includes('has already been downloaded')) {
        dl.status = 'completed';
        dl.progress = 100;
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const dl = downloads.get(id);
    if (dl) {
      const msg = data.toString();
      // Only store actual errors, not warnings
      if (msg.includes('ERROR') || msg.includes('error')) {
        dl.error = (dl.error || '') + msg;
      }
    }
  });

  proc.on('close', (code) => {
    const dl = downloads.get(id);
    if (!dl) return;

    if (code === 0) {
      // Find the output file(s) — pick the largest one (merged output)
      try {
        const files = fs.readdirSync(DOWNLOADS_DIR)
          .filter(f => f.startsWith(id))
          .map(f => ({
            name: f,
            size: fs.statSync(path.join(DOWNLOADS_DIR, f)).size
          }))
          .sort((a, b) => b.size - a.size);

        if (files.length > 0) {
          dl.status = 'completed';
          dl.progress = 100;
          dl.filename = files[0].name;
          dl.filesize = files[0].size;
          dl.speed = '';
          dl.eta = '';
          console.log(`✅ Download complete [${id}]: ${files[0].name} (${(files[0].size / 1048576).toFixed(1)} MB)`);
        } else {
          dl.status = 'error';
          dl.error = 'Download completed but output file was not found.';
        }
      } catch (e) {
        dl.status = 'error';
        dl.error = 'Error reading download directory.';
      }
    } else {
      dl.status = 'error';
      if (!dl.error) {
        dl.error = `Download failed (exit code ${code}). Please check your URL and cookies.`;
      }
      console.error(`❌ Download failed [${id}]: ${dl.error}`);
    }
  });

  proc.on('error', (err) => {
    const dl = downloads.get(id);
    if (dl) {
      dl.status = 'error';
      dl.error = `Failed to start yt-dlp: ${err.message}. Is yt-dlp installed?`;
    }
  });

  res.json({ id });
});

/**
 * GET /api/status/:id
 * Poll download progress
 */
app.get('/api/status/:id', (req, res) => {
  const dl = downloads.get(req.params.id);
  if (!dl) {
    return res.status(404).json({ error: 'Download not found' });
  }
  res.json(dl);
});

/**
 * GET /api/file/:id
 * Serve the downloaded file
 */
app.get('/api/file/:id', (req, res) => {
  const dl = downloads.get(req.params.id);
  if (!dl || dl.status !== 'completed') {
    return res.status(404).json({ error: 'File is not ready yet' });
  }

  const filePath = path.join(DOWNLOADS_DIR, dl.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  // Build a clean download filename from the video title
  const ext = path.extname(dl.filename);
  const sanitizedTitle = (dl.title || 'video')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);

  res.download(filePath, `${sanitizedTitle}${ext}`);
});

// ─── Auto-Cleanup ─────────────────────────────────────────
// Remove files older than 1 hour, every 30 minutes
setInterval(() => {
  const maxAge = 3600000; // 1 hour in ms
  const now = Date.now();

  [UPLOADS_DIR, DOWNLOADS_DIR].forEach(dir => {
    try {
      fs.readdirSync(dir).forEach(file => {
        const filePath = path.join(dir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
            console.log(`🗑️  Cleaned: ${file}`);
          }
        } catch (e) { /* skip */ }
      });
    } catch (e) { /* skip */ }
  });

  // Purge old download records from memory
  for (const [id, dl] of downloads.entries()) {
    if (now - dl.startedAt > maxAge) {
      downloads.delete(id);
    }
  }
}, 1800000);

// ─── Start Server ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║        🎬  YTDownload Server         ║');
  console.log(`  ║   🌐  http://localhost:${PORT}            ║`);
  console.log('  ║   📁  Ready for downloads            ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
