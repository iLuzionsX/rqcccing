import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the production build loads under /rqcccing/ on GitHub Pages.
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
