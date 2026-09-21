import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './'：产物落任意域名/子路径的 Nginx 根都可用，无需按环境构建
// input 用相对 root 的路径 —— rollup 自行解析，避免 ESM 下无 __dirname
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        download: 'download.html'
      }
    }
  }
})
