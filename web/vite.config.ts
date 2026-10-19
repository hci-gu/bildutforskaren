import path from "path"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const apiTarget = env.BILDUTFORSKAREN_API_TARGET
  const apiKey = env.BILDUTFORSKAREN_API_KEY

  if (env.VITE_API_URL === '/api' && (!apiTarget || !apiKey)) {
    throw new Error('Set BILDUTFORSKAREN_API_TARGET and BILDUTFORSKAREN_API_KEY for the local API proxy')
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: apiTarget && apiKey ? {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          headers: { 'X-API-Key': apiKey },
          rewrite: (url: string) => url.replace(/^\/api(?=\/|$)/, ''),
        },
      },
    } : undefined,
  }
})
