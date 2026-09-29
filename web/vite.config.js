import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// 兩個入口：index.html（櫃檯／入場機／總部後台）與 app.html（會員 App，/app 開頭的網址）
const memberAppRoutes = {
  name: 'member-app-routes',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (/^\/app(\/[^.]*)?(\?.*)?$/.test(req.url)) req.url = '/app.html'
      next()
    })
  },
}

export default defineConfig({
  plugins: [react(), memberAppRoutes],
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), app: resolve(__dirname, 'app.html') },
    },
  },
})
