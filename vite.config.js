import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/my-notepad/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // changeOrigin을 끄면 서버가 받는 Host가 화면 주소와 같아져서, 서버의 출처 검사를 통과한다.
      '/api': { target: 'http://localhost:3001', changeOrigin: false },
    },
  },
})
