# Smart Home Command

A Windows dashboard for your smart home, with a voice assistant built in. It connects to **Home Assistant** for devices, media and weather, to **UniFi Protect** for live cameras, and to **Google Gemini** for natural voice control ("Hey Jarvis…").

Built with Tauri v2 (Rust) and React. Credentials are kept in Windows Credential Manager, never in plain files or in the app's web layer.

## Features

- **Dashboard**: lights, switches, locks, covers, climate and sensors from Home Assistant, grouped by area or into your own groups. Rearrange, resize, rename and hide tiles with **Edit layout**.
- **Cameras**: live UniFi Protect video over WebRTC (through go2rtc), picture-in-picture and full screen.
- **Voice assistant**: say "Hey Jarvis", press a shortcut or click the mic, then talk naturally. It controls devices, answers questions using Google Search, sets timers, and can pass commands to Google Home.
- **Media**: Now Playing cards, Music Assistant library search, and Denon/Marantz receiver controls (power, volume, input, sound mode).
- **Overlay**: a small always-on-top window with your favorite controls (default shortcut `Ctrl+Shift+Space`).
- **Screensaver**: a photo slideshow after a period of no input and no front-camera motion. It shows the time and weather and moves around the screen to prevent burn-in. Photos can come from local folders or shared albums in Google Photos, Amazon Photos or OneDrive.
- **Header**: the dashboard name (click it to rename), current weather and time, and **focus view** (fills the whole screen, over the taskbar; `F11`).
- **Backup & restore**: one passphrase-encrypted file with your layout, settings, shortcuts and credentials. Restore it from a USB drive or any folder, on this PC or others.

## Install

1. Download the latest `Smart.Home.Command_<version>_x64_en-US.msi` from [Releases](../../releases).
2. **Optional, removes the "unknown publisher" warning:** the installer is signed with a self-signed certificate. Download `shcm-codesign.cer` from the [0.1.0 release](../../releases/tag/v0.1.0), double-click it and choose **Install Certificate**. Install it into **Trusted Root Certification Authorities**, then again into **Trusted Publishers**.
3. Run the MSI. Newer versions upgrade older ones in place and keep your settings.

Requires Windows 10 or 11 (x64). Microsoft Edge WebView2 is included with Windows 11 and installed automatically on Windows 10 if missing.

## Set up

Open **Settings** (the gear at the top right) and fill in **Integrations**. See **[docs/SETUP.md](docs/SETUP.md)** for step-by-step instructions and links for each service:

| Service | What it's for | What you need | Cost |
| --- | --- | --- | --- |
| [Home Assistant](docs/SETUP.md#1-home-assistant-required) | Devices, media, weather, motion sensors | URL + long-lived access token | Free |
| [Google Gemini](docs/SETUP.md#2-google-gemini-voice-assistant) | Voice assistant | API key from Google AI Studio | Free tier; paid above limits |
| [UniFi Protect](docs/SETUP.md#3-unifi-protect-cameras) | Cameras | Console URL + Integration API key | Free |
| [go2rtc](docs/SETUP.md#4-go2rtc-video-bridge) | Plays UniFi camera streams | URL of a go2rtc server (HA add-on) | Free |

Optional extras through Home Assistant: [Music Assistant](docs/SETUP.md#music-assistant), [Denon/Marantz receivers](docs/SETUP.md#denon--marantz-receivers), [weather](docs/SETUP.md#weather), [Google Home hand-off](docs/SETUP.md#google-home-hand-off-google-assistant-sdk) and [screensaver photo albums](docs/SETUP.md#screensaver-photos).

Already set up on another device? Use **[Backup & restore](docs/SETUP.md#moving-to-another-device-backup--restore)** instead of entering everything again.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+Space` | Show or hide the overlay (works from any app) |
| `Ctrl+Alt+Space` | Hold to talk (works from any app) |
| `F11` | Focus view on or off |
| `Esc` | Close dialogs |

Change the global shortcuts in **Settings → Keyboard shortcuts**.

## Privacy and security

- Credentials (tokens, API keys, URLs) are stored in **Windows Credential Manager** under `com.shcm.desktop`. The app's web layer can save them but never read them back; the Rust side attaches them to requests.
- Changing the Home Assistant or UniFi address wipes the credentials saved for it, so a key can't be redirected to another server.
- Voice audio goes from the app to Google Gemini. Device control stays on your network (Home Assistant, UniFi, go2rtc).
- Backup files are encrypted with Argon2id and XChaCha20-Poly1305. Without the passphrase they can't be opened, and a forgotten passphrase can't be recovered.

## Build from source

Prerequisites: [Node.js](https://nodejs.org/) 20+, [Rust](https://rustup.rs/) (stable, MSVC toolchain) and the [Tauri prerequisites for Windows](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
```

```bash
npm run tauri dev
```

Without Tauri, `npm run dev` runs the dashboard in a browser with mock devices.

Checks:

```bash
npx tsc --noEmit
```

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Build the installer (downloads WiX on first run):

```bash
npm run tauri build -- --bundles msi
```

The MSI is written to `src-tauri/target/release/bundle/msi/`. Signing uses the certificate whose thumbprint is in `src-tauri/tauri.conf.json` (`bundle.windows.certificateThumbprint`); change or remove it to sign with your own certificate.

## Project layout

```
src/                 React UI (TypeScript)
  providers/         Home Assistant, UniFi Protect, plugin and mock providers
  voice/             Gemini Live client, mic capture, playback, wake word
  ui/                Dashboard, overlay, screensaver, settings
src-tauri/src/       Rust: credential store, relays, go2rtc bridge, photos, backup
docs/SETUP.md        Integration setup guide
```
