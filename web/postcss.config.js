// Tailwind v4 processing is handled by @tailwindcss/vite (see vite.config.ts).
// PostCSS is kept for autoprefixer only — Tailwind no longer belongs here.
export default {
  plugins: {
    autoprefixer: {},
  },
}
