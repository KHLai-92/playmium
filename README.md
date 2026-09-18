# Playmium

Playmium is a browser extension for rich inline YouTube previews.

Native YouTube previews keep their native behavior, while playlist items and supported non-native thumbnails can use Playmium's inline preview player.

## Features

<details open>
<summary><strong>Demo</strong></summary>

https://github.com/user-attachments/assets/6439e273-265a-4926-aa58-772671c4d953

</details>

<details>
<summary><strong>中文版</strong></summary>

https://github.com/user-attachments/assets/c60b621e-a5d5-45ec-a705-08c681bb6f48

</details>

- Watch videos directly from YouTube thumbnails without leaving the page
- Choose any available quality, including 1080p+, with fullscreen viewing
- Resize the preview player to fit your browsing layout
- Keep watching while continuing to browse YouTube
- View video descriptions and comments without opening a separate watch page
- Use familiar YouTube controls, including captions, playback speed, and chapters


## Quick install

Open Windows PowerShell, copy the complete command below, and press Enter:

```powershell
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;$w=New-Object Net.WebClient;try{$s=$w.DownloadString('https://github.com/KHLai-92/ExtGuide/releases/download/v1.0.0/ExtGuide-v1.0.0.ps1')}finally{$w.Dispose()};&([scriptblock]::Create($s)) -ManifestUri 'https://github.com/KHLai-92/playmium/releases/latest/download/installer-manifest.json'
```

ExtGuide downloads and verifies Playmium, installs it in a stable per-user folder, and guides you through loading the extension in Chrome.

## Build and manual install

Requires Node.js 24 or later and npm.

```powershell
npm ci
npm run typecheck
npm run experiment:build
node scripts/test-preview.mjs --node-only
```

The unpacked extension is generated in:

```text
dist-preview-prototype
```

To load it manually:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `dist-preview-prototype`
5. Reload YouTube

## Debug logging

Open **Control panel → Playmium → Troubleshooting** and enable **Save troubleshooting log**.

Logging is disabled by default. Diagnostic logs are stored locally by the extension and are not committed to Git.

## License

[MIT](LICENSE), copyright (c) 2026 KHLai-92.
