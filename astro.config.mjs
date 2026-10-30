// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { clientTexts, rechnerTexts } from './src/lib/client-texts.mjs';

// Адрес сайта: для превью — dev.siteboosty.com, для продакшна задать SITE_URL в сборке
const SITE = process.env.SITE_URL || 'https://dev.siteboosty.com';

export default defineConfig({
  site: SITE,
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !page.includes('/danke') })],
  // Тексты браузерных скриптов из src/content/pages/*.json (см. src/lib/client-texts.mjs)
  vite: { define: clientTexts(), plugins: [rechnerTexts()] },
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Figtree',
      cssVariable: '--font-sans',
      weights: [400, 500, 600, 700, 800],
      styles: ['normal'],
      subsets: ['latin', 'latin-ext'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
  ],
});
