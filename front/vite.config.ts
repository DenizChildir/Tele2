import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, // Default Vite port
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.VITE_API_PORT || 3000}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${process.env.VITE_API_PORT || 3000}`,
        ws: true,
      }
    }
  }
})