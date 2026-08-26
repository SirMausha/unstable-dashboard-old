import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // CI sets GITHUB_REPOSITORY on process.env; loadEnv only reads .env files.
  const repository = String(process.env.GITHUB_REPOSITORY || env.GITHUB_REPOSITORY || '')
    .split('/')
    .pop()
  const pagesBase = repository ? `/${repository}/` : '/DustBunnyDashboard/'

  return {
    base: mode === 'public' ? pagesBase : '/',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': 'http://127.0.0.1:4174',
      },
    },
  }
})
