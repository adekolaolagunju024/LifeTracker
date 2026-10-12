// Tailwind for the public pages (landing, privacy, terms), built ahead of
// time into frontend/css/site.css by `npm run build:css` rather than the
// in-browser Play CDN, which Tailwind says isn't for production: it ships
// a large compiler script and paints unstyled content first.
module.exports = {
  content: ['./frontend/landing.html', './frontend/privacy.html', './frontend/terms.html', './backend/landing.js'], // landing.js writes the stage cards, the tour and What's new
  theme: {
    extend: {
      fontFamily: { sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'] },
      colors: {
        navy: { DEFAULT: '#0D1B2A', 2: '#1B3A5C' },
        teal: { DEFAULT: '#0A7E8C', light: '#5EEAD4' },
      },
    },
  },
};
