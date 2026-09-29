import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Ensure Electron runs in app mode with the correct binary
// (WPS Lingxi sets these env vars which interfere with our dev server)
delete process.env.ELECTRON_RUN_AS_NODE
delete process.env.ELECTRON_EXEC_PATH

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['dingtalk-stream', 'node-pty', 'ssh2']
      }
    }
  },
  preload: {},
  renderer: {
    server: {
      host: '127.0.0.1'
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          launcher: resolve('src/renderer/launcher.html'),
          clipboard: resolve('src/renderer/clipboard.html'),
          'file-search': resolve('src/renderer/file-search.html')
        }
      }
    }
  }
})
