# 🎬 YTDownload

A sleek, premium web application for downloading YouTube Premium & membership-exclusive videos using cookies authentication.

![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)
![yt-dlp](https://img.shields.io/badge/yt--dlp-latest-red?logo=youtube&logoColor=white)

---

## ✨ Features

- 🔐 **Cookies-based authentication** — Use your subscribed account's cookies to access exclusive content
- 🎨 **Premium dark UI** — Glassmorphism design with smooth animations
- 📤 **Drag & drop** cookies.txt upload
- 🔍 **Video preview** — View title, thumbnail, channel & duration before downloading
- 📊 **Real-time progress** — Live download progress bar with speed & ETA
- 🎚️ **Quality selector** — 4K, 1080p, 720p, 480p, or MP3 audio
- 📱 **Responsive** — Works on desktop and mobile browsers
- 🗑️ **Auto-cleanup** — Temporary files are deleted after 1 hour

---

## 📋 Prerequisites

Make sure you have the following installed:

| Tool | Version | Purpose |
|------|---------|---------|
| [Node.js](https://nodejs.org/) | 18+ | Runtime |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Latest | Download engine |
| [ffmpeg](https://ffmpeg.org/) | 4+ | Merge video & audio streams |

### Quick Install (Ubuntu / WSL)

```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# yt-dlp
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# ffmpeg
sudo apt-get install -y ffmpeg
```

---

## 🚀 Getting Started

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd YTDownload
npm install
```

### 2. Run the Server

```bash
npm start
```

Or with auto-restart on file changes:

```bash
npm run dev
```

### 3. Open in Browser

```
http://localhost:3000
```

---

## 📖 How to Use

### Step 1: Export Cookies

Export `cookies.txt` from a browser where you're logged into YouTube with a subscribed account.

**Recommended extensions:**
- Chrome / Kiwi: [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/cclelndahbckbenkjhflpdbgdldlbecc)
- Firefox: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)

> 💡 **Android users:** Use [Kiwi Browser](https://play.google.com/store/apps/details?id=com.kiwibrowser.browser) which supports Chrome extensions. Export cookies there and transfer the file to your PC.

### Step 2: Upload & Download

1. **Drag & drop** your `cookies.txt` file into the upload zone
2. **Paste** the YouTube video URL
3. Click **Fetch Info** to preview the video
4. **Select quality** (4K / 1080p / 720p / 480p / MP3)
5. Click **Download Video** and wait for it to finish
6. Click **Save File** to download to your computer

---

## 🏗️ Project Structure

```
YTDownload/
├── server.js              # Express backend (API + yt-dlp integration)
├── package.json           # Dependencies & scripts
├── public/                # Frontend static files
│   ├── index.html         # Main HTML page
│   ├── style.css          # Premium dark theme CSS
│   └── app.js             # Client-side JavaScript
├── uploads/               # Temporary cookies storage (auto-cleaned)
├── downloads/             # Downloaded videos (auto-cleaned)
├── .gitignore
└── README.md
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload-cookies` | Upload cookies.txt file |
| `POST` | `/api/info` | Get video metadata (title, thumbnail, duration) |
| `POST` | `/api/download` | Start video download |
| `GET` | `/api/status/:id` | Poll download progress |
| `GET` | `/api/file/:id` | Download the completed file |

---

## ⚠️ Important Notes

- **Cookies expire** — If downloads fail, re-export your cookies from the browser
- **Local use only** — This app is designed to run on your local network
- **Auto-cleanup** — All uploaded cookies and downloaded files are automatically deleted after **1 hour**
- **Legal** — Only download content you have legitimate access to through your subscription

---

## 🛠️ Tech Stack

- **Backend:** Node.js + Express 5
- **Frontend:** Vanilla HTML, CSS, JavaScript
- **Download Engine:** yt-dlp (via child_process)
- **File Upload:** Multer
- **Design:** Dark mode, glassmorphism, Inter font

---

## 📄 License

ISC
