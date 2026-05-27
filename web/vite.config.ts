import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(), // Tailwind v4 native Vite plugin — faster than PostCSS in dev
    react(),
  ],
})
