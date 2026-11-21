# Setup guide

Everything is entered in **Settings → Integrations** (the gear at the top right of the dashboard). Values are saved to Windows Credential Manager. Once saved, they show as "saved" but can't be viewed again; leave a field blank to keep what's there.

Set things up in this order: Home Assistant first, since most features come through it.

- [1. Home Assistant (required)](#1-home-assistant-required)
- [2. Google Gemini (voice assistant)](#2-google-gemini-voice-assistant)
- [3. UniFi Protect (cameras)](#3-unifi-protect-cameras)
- [4. go2rtc (video bridge)](#4-go2rtc-video-bridge)
- [Optional Home Assistant integrations](#optional-home-assistant-integrations)
- [Screensaver photos](#screensaver-photos)
- [Moving to another device (Backup & restore)](#moving-to-another-device-backup--restore)
- [Troubleshooting](#troubleshooting)

---

## 1. Home Assistant (required)

Home Assistant provides your devices, media players, weather, motion sensors and the sun position (for day and night icons).

**You need:** your Home Assistant URL and a long-lived access token.

1. Note the address you open Home Assistant at, for example `http://homeassistant.local:8123` or `http://192.168.1.20:8123`.
2. In Home Assistant, click your user name at the bottom left to open your profile, then the **Security** tab. Direct link: [my.home-assistant.io/redirect/profile_security](https://my.home-assistant.io/redirect/profile_security).
3. Scroll to **Long-lived access tokens** and click **Create token**. Name it, for example "Smart Home Command".
4. Copy the token right away. Home Assistant shows it only once.
5. In the app, open **Settings → Integrations → Home Assistant**, enter the **URL** and **Long-lived access token**, and click **Save**.

The token acts as your Home Assistant user, so the dashboard sees what that user sees. Tokens are valid for 10 years; to revoke one, delete it from the same Security tab.

Docs: [Home Assistant authentication](https://www.home-assistant.io/docs/authentication/)

---

## 2. Google Gemini (voice assistant)

The voice assistant uses the Gemini Live API (native audio) for spoken conversation, Google Search for current facts, and Home Assistant for device control.

**You need:** a Gemini API key.

1. Sign in with a Google account at [Google AI Studio → API keys](https://aistudio.google.com/apikey).
2. Click **Create API key**. Pick an existing Google Cloud project or let AI Studio create one.
3. Optional but recommended: open the key's **Add restrictions** menu and choose **Restrict to Gemini API only**.
4. Copy the key. In the app, open **Settings → Integrations → Gemini voice**, paste it into **API key** and click **Save**.

**Cost:** AI Studio has a free tier with rate limits. Heavier use needs billing on the Cloud project. Check current limits and prices at [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) and [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

**Using voice:**

- **Wake word:** turn on **Settings → Wake word**, then say "Hey Jarvis". Detection runs entirely on this PC; nothing is sent until the wake word is heard.
- **Hold to talk:** hold `Ctrl+Alt+Space` (from any app) or the mic button.
- Allow microphone access when Windows asks.

Docs: [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key), [Live API](https://ai.google.dev/gemini-api/docs/live)

---

## 3. UniFi Protect (cameras)

**You need:** your UniFi console address and an Integration API key. Requires a recent UniFi OS and Protect version with the Integration API.

1. Sign in to your UniFi console (for example `https://192.168.1.1`) as an **administrator**.
2. Go to **Settings → Control Plane → Integrations**.
3. Create an API key, name it (for example "Smart Home Command") and copy it. It's shown only once.
4. In the app, open **Settings → Integrations → UniFi Protect**. Enter the **Console URL** (the address you open Protect at, such as `http://192.168.1.1/protect`; the app always connects over HTTPS) and the **Integration API key**, then click **Save**.

The key has the permissions of the account that created it, and there's no read-only key, so treat it like a password. The console's certificate is pinned the first time the app connects; saving a different console address resets the pin and the key.

**If there's no Integrations page:** some consoles hide it when you're signed in with a cloud (UI.com) account. Sign in locally with a local admin account (Super Admin), or update UniFi OS and Protect. See the [Home Assistant UniFi Protect docs](https://www.home-assistant.io/integrations/unifiprotect) for the same key.

Cameras also need [go2rtc](#4-go2rtc-video-bridge) to play in the app.

---

## 4. go2rtc (video bridge)

Windows' web engine can't play UniFi's RTSPS streams directly. The app registers each camera with [go2rtc](https://github.com/AlexxIT/go2rtc), which converts the streams to WebRTC.

**You need:** a go2rtc server on your network. The easiest way is the Home Assistant add-on.

1. In Home Assistant, go to **Settings → Add-ons → Add-on store** (newer versions: **Settings → Apps**).
2. Open the **⋮** menu → **Repositories**, add `https://github.com/AlexxIT/hassio-addons`, and click **Add**.
3. Find **go2rtc**, click **Install**, then **Start**.
4. In the app, open **Settings → Integrations → Video bridge (go2rtc)** and enter `http://<your-HA-address>:1984`, for example `http://homeassistant.local:1984`. Click **Save**.

go2rtc's API listens on port **1984** by default; WebRTC uses port **8555**. The URL must be a local or LAN address. go2rtc's API has no password by default, so don't expose port 1984 to the internet.

Docs: [go2rtc](https://github.com/AlexxIT/go2rtc), [Home Assistant add-on](https://github.com/AlexxIT/hassio-addons)

---

## Optional Home Assistant integrations

These need no extra keys in the app. Add them in Home Assistant (**Settings → Devices & services → Add integration**) and they appear in the dashboard automatically.

### Music Assistant

Library search, playlists and grouped speakers in the media cards and by voice ("play some jazz in the kitchen").

- On Home Assistant OS: add the **Music Assistant** integration and keep **Use the official Music Assistant app** selected. Home Assistant installs it; finish Music Assistant's first-run setup in the tab that opens.
- Other installs: run a [Music Assistant server](https://www.music-assistant.io/installation/) first, then add the integration.
- Needs Music Assistant server 2.4 or later.

Docs: [Music Assistant integration](https://www.home-assistant.io/integrations/music_assistant/)

### Denon / Marantz receivers

Power, volume, input and sound mode on the receiver strip and by voice ("turn up the Denon").

- Add **Denon AVR Network Receivers**. It's usually discovered automatically; otherwise enter the receiver's IP address.
- On segmented networks (VLANs), Home Assistant must reach the receiver on TCP ports 23, 8080 and 60006.

Docs: [Denon AVR integration](https://www.home-assistant.io/integrations/denonavr/)

### Weather

The header and screensaver show conditions and temperature from a Home Assistant `weather.*` entity. If you don't have one, add **Meteorologisk institutt (Met.no)**: free, no key, uses your Home Assistant home location. Choose which weather entity to use in **Settings → Screensaver → Weather**.

Docs: [Met.no integration](https://www.home-assistant.io/integrations/met/)

### Motion sensors

The screensaver waits until there's been no input **and** no motion at the front of the house. It watches Home Assistant `binary_sensor` entities that are motion, occupancy or presence sensors with "front" in their name or area (UniFi Protect's own Home Assistant integration provides these). Pick sensors yourself in **Settings → Screensaver**.

### Electric car (Audi Connect + ChargePoint)

A header pill shows the car's battery %, range and charging state, for example "Audi e-tron 64% · 143 mi · Charging 7.2 kW". Hover it for details. You can also ask the voice assistant ("how much range does the car have?"). Both integrations are custom ones from [HACS](https://hacs.xyz/). Either one works alone; with both, the charger's power and the car's battery are combined.

- **Range and battery: Audi Connect.** In HACS, add [audiconnect/audi_connect_ha](https://github.com/audiconnect/audi_connect_ha), restart Home Assistant, then add **Audi Connect** with your myAudi email and password. Set **Region** to **US** and **API Level** to **1** (e-tron). It refreshes every 15 minutes at most, so range can be up to 15 minutes old. Audi changes its private API now and then, which can break the integration until the next update.
- **Charging: ChargePoint.** In HACS, add the custom repository [mbillow/ha-chargepoint](https://github.com/mbillow/ha-chargepoint), restart, then add **ChargePoint** with your ChargePoint account.

The app finds the entities by their names (`…_state_of_charge`, `…_primary_engine_range`, `…_charging_status`, `…_power_output`). Don't rename those entity IDs in Home Assistant.

### Google Home hand-off (Google Assistant SDK)

For devices only Google Home can control (for example a Level lock), the voice assistant can send a typed command to Google Assistant: "use Google to lock the front door".

1. In the [Google Cloud console](https://console.cloud.google.com/), create or pick a project and [enable the Google Assistant API](https://console.cloud.google.com/apis/library/embeddedassistant.googleapis.com).
2. Open **Google Auth Platform → Branding** and click **Get started**. Set the audience to **External**.
3. Under **Audience**, click **Publish app**. Otherwise the sign-in expires every 7 days; in Testing mode, add yourself as a **Test user**.
4. Under **Clients**, click **Create client**, choose **Web application**, and add the redirect URI `https://my.home-assistant.io/redirect/oauth`. Copy the **Client ID** and **Client secret** (the secret is shown only once).
5. In Home Assistant, add the **Google Assistant SDK** integration, enter the client ID and secret, and sign in with the Google account linked to your Google Home.

Google no longer returns text replies through this integration, so the assistant says a command was sent but can't confirm the result. Unlocking always asks you to confirm first.

Docs: [Google Assistant SDK integration](https://www.home-assistant.io/integrations/google_assistant_sdk/)

---

## Screensaver photos

**Settings → Screensaver** → turn it on, choose **Start after** (default 20 minutes) and **New photo every** (default 30 seconds), then add photos:

- **Folders:** tick a suggested folder (Pictures, OneDrive Pictures, Google Drive, Dropbox, iCloud Photos, Amazon Photos) or click **Add folder…**. Any folder works, including ones synced by a cloud app.
- **Shared albums (no app or sign-in needed):** paste a share link and click **Add**:
  - **Google Photos:** open the album → **Share** → **Create link** (anyone with the link).
  - **Amazon Photos:** open the album or folder → **Share** → **Copy link**.
  - **OneDrive:** right-click the folder → **Share** → set to **Anyone with the link can view** → **Copy link**.

Each link shows how many photos it found. These services don't officially support reading share links, so a link can stop working if they change their sites. Photos are cached on this PC (up to 2 GB).

Use **Preview** to see it right away. Any key, tap or mouse movement dismisses it.

---

## Moving to another device (Backup & restore)

Instead of creating new keys and rebuilding your layout, copy everything with one file.

**On the device that's set up:**

1. **Settings → Backup & restore → Export.**
2. Enter a passphrase (8+ characters) twice and click **Export backup…**.
3. Save the `.shcmbackup` file to a USB drive, OneDrive, a network share or any folder.

**On the new device:**

1. Install the app (see the [README](../README.md#install)).
2. **Settings → Backup & restore → Choose backup…** and pick the file from any drive.
3. Enter the passphrase and click **Restore**. The app reloads with everything in place.

The backup includes your layout and groups, hidden tiles, overlay groups, screensaver, media and Now Playing settings, dashboard name, wake word and voice settings, keyboard shortcuts, and all saved credentials. Running timers aren't included. One file can be restored on any number of devices.

Keep the passphrase safe: it's the only way to open the file, and it can't be recovered. Anyone with the file and passphrase gets your API keys, so store the file like a password.

---

## Troubleshooting

| Problem | Try |
| --- | --- |
| "Mock data" badge in the header (sample devices and camera test patterns) | Home Assistant isn't set up yet. Enter the URL and token in **Settings → Integrations**. |
| Cameras stay black or keep loading | Check the go2rtc URL (port 1984) and that the go2rtc add-on is running. Then check the UniFi key. |
| UniFi stops working after a console change | Saving a new console address clears the key and certificate pin. Enter the key again. |
| Voice starts but there's no sound | Check the Windows output device. If the voice bar says sound is blocked, tap the screen once. |
| "Hey Jarvis" doesn't respond | Turn on **Settings → Wake word** and allow microphone access in Windows **Settings → Privacy & security → Microphone**. |
| A shortcut doesn't work | Another app may own it. Pick a different combination in **Settings → Keyboard shortcuts**. |
| A shared album shows an error | Make sure it's shared as "anyone with the link". If the service changed its site, use a synced folder instead. |
| "Wrong passphrase, or the file is damaged" | The passphrase is case-sensitive. A copied file that's incomplete also gives this error. |
