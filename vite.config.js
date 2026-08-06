import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built app works on GitHub Pages project sites
// (https://<user>.github.io/<repo>/) without configuration.
export default defineConfig({
  plugins: [react()],
  base: './',
})
