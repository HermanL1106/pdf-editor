import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/pdf-editor/',
  optimizeDeps: {
    include: ['pdfjs-dist']
  },
  build: {
    outDir: 'docs'
  }
})
