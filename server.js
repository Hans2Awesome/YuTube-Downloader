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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer for file uploads
const upload = multer({ dest: UPLOADS_DIR });

// In-memory download tracker
const downloads = new Map();

// ─── Routes ───────────────────────────────────────────────

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
  const { url, cookiesPath } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const args = ['--dump-json', '--no-playlist', '--no-download'];
  if (cookiesPath && fs.existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath);
  }
  args.push(url);

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
      // Parse common yt-dlp errors for user-friendly messages
      let errorMsg = 'Failed to get video info.';
      if (stderr.includes('cookies')) {
        errorMsg = 'Cookies may be expired or invalid. Please re-export your cookies.txt.';
      } else if (stderr.includes('not available') || stderr.includes('Private video')) {
        errorMsg = 'This video is not available. It may be private or region-locked.';
      } else if (stderr.includes('Unsupported URL')) {
        errorMsg = 'Unsupported URL. Please enter a valid YouTube video URL.';
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
        viewCount: info.view_count || 0,
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to parse video information.' });
    }
  });

  // Timeout: 30 seconds
  setTimeout(() => {
    if (responded) return;
    responded = true;
    proc.kill();
    res.status(504).json({ error: 'Request timed out. The video may be too large or the connection is slow.' });
  }, 30000);
});

/**
 * POST /api/download
 * Start downloading a video with yt-dlp
 */
app.post('/api/download', (req, res) => {
  const { url, cookiesPath, quality, title } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const id = uuidv4();
  const outputTemplate = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);

  // Build yt-dlp arguments
  const args = ['--no-playlist', '--newline', '--progress'];

  if (quality === 'audio') {
    args.push('-f', 'bestaudio');
    args.push('--extract-audio', '--audio-format', 'mp3');
  } else {
    const height = quality || '1080';
    args.push('-f', `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`);
    args.push('--merge-output-format', 'mp4');
  }

  args.push('-o', outputTemplate);

  if (cookiesPath && fs.existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath);
  }

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
