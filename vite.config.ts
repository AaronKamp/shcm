import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Tauri expects a fixed port and ignores src-tauri changes during dev.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  // onnxruntime-web (wake word) loads its WASM at runtime; pre-bundling breaks that lookup.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
