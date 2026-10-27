import { defineConfig, type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 干净路由：/guide 而不是 /guide.html。
// 只重写「无斜杠」那一种：产物 HTML 里资源是相对路径（base './'），
// 浏览器停在 /guide/ 时会把 ./assets/... 解析成 /guide/assets/... 直接 404。
const PAGES = ['download', 'guide', 'go'] as const

// 官网固定端口，刻意避开 Vite 默认的 5173 / 4173：主项目 electron-vite 的 renderer dev / preview
// 正占着这两个默认值，同机同开时 Vite 会把官网静默挪到 5174 / 4174 —— 看着在自己端口上测官网，
// 其实打开的是主项目。strictPort 让端口被占时直接报错，不偷偷换端口。
const DEV_PORT = 5280
const PREVIEW_PORT = 5281

// 反馈服务联调（S-226）：线上由 nginx 把 /api/ 反代到 127.0.0.1:7860
// （deploy/feedback/nginx-location.conf），本地没有 nginx 这一层，
// dev / preview 各挂一份等价代理，前端那句 `./api/feedback` 一个字不用改。
// 后端没起也不影响页面：拿不到数据就整段不渲染（src/lib/feedback.ts 文件头）。
const FEEDBACK_API = 'http://127.0.0.1:7860'
const apiProxy = { '/api': { target: FEEDBACK_API, changeOrigin: false } }

function rewriteCleanUrls(middlewares: Connect.Server): void {
  middlewares.use((req, _res, next) => {
    const url = req.url ?? ''
    const queryAt = url.indexOf('?')
    const path = queryAt === -1 ? url : url.slice(0, queryAt)
    const name = path.slice(1)
    if ((PAGES as readonly string[]).includes(name)) {
      req.url = `/${name}.html${queryAt === -1 ? '' : url.slice(queryAt)}`
    }
    next()
  })
}

// base './'：产物落任意域名/子路径的 Nginx 根都可用，无需按环境构建
// input 用相对 root 的路径 —— rollup 自行解析，避免 ESM 下无 __dirname
export default defineConfig({
  // 四个入口的 MPA（首页 + 下载 + 使用指引 + 下载中转页）：默认 'spa' 会把任意未知路径回退成首页，
  // 打错 /guid 也"看着像 200"，排错时最容易骗到自己；'mpa' 下未知路径正常 404。
  // 原第四个入口 changelog 已删（老大 2026-09-23：官网不留更新日志，入口一律跳 GitHub）。
  // 第五个入口 go 是下载中转页（S-186，2026-10-10）：下载按钮先到它，再由页面跳加速站。
  appType: 'mpa',
  server: { port: DEV_PORT, strictPort: true, proxy: apiProxy },
  preview: { port: PREVIEW_PORT, strictPort: true, proxy: apiProxy },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'clean-urls',
      configureServer: (server) => rewriteCleanUrls(server.middlewares),
      configurePreviewServer: (server) => rewriteCleanUrls(server.middlewares)
    }
  ],
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        download: 'download.html',
        guide: 'guide.html',
        go: 'go.html'
      }
    }
  }
})
