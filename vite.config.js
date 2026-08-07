import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built app works on GitHub Pages project sites
// (https://<user>.github.io/<repo>/) without configuration.
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    // Visible in the footer so "which version am I running?" is answerable.
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
  },
})
