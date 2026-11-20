# Project: Smart Home Command & Gemini Voice Overlay
Targets: Windows Desktop (primary), Android, iOS.

## Stack & Commands (Pick One)
### Option A: Tauri v2 (Rust + React/TypeScript)
- Frontend: React 19, TypeScript (strict), TailwindCSS, Zustand (state).
- Backend: Tauri v2 (Rust) for system tray, global hotkeys, and local proxy/hooks.
- Validation (ALWAYS use quiet flags): `npx tsc --noEmit` and `cargo check --manifest-path src-tauri/Cargo.toml -q`

### Option B: Flutter (Dart)
- Framework: Flutter 3.x (Dart 3), Riverpod (state), `media_kit` (RTSP/WebRTC video).
- Validation (ALWAYS use quiet flags): `flutter analyze --no-pub`

## Core Architecture Rules (ZERO EXCEPTIONS)
1. **Strict Provider Pattern:** All smart home integrations MUST implement the unified `DeviceProvider` interface (`connect`, `disconnect`, `subscribeStates`, `executeCommand`).
   - Built-in providers: `HomeAssistantProvider` (WebSocket API), `UnifiProtectProvider` (RTSP/WebRTC streams), `CustomPluginProvider` (REST/MQTT/Webhook hooks for non-HA devices).
2. **State Decoupling:** High-frequency WebSocket messages MUST be normalized and throttled before touching UI state to prevent frame drops.
3. **Gemini Multimodal Live Overlay:**
   - Bidirectional WebSocket (`BidiGenerateContent`).
   - Audio Input: 16-bit PCM, 16kHz, mono, little-endian.
   - Audio Output: 16-bit PCM, 24kHz, mono, little-endian.
   - All smart home actions triggered by voice MUST route through the unified `DeviceProvider` registry via Gemini `toolCall` -> `toolResponse`.
4. **Code Style:** No `any` types. No mock data inside UI components—use mock providers during testing. Keep files under 250 lines.