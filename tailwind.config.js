// Tailwind for the app (frontend/index.html and the scripts that build its
// markup). Built ahead of time into frontend/css/app.css with
// `npm run build:css` instead of compiling in the browser, so the first
// paint is already styled. Rebuild after adding new utility classes.
module.exports = {
  content: ['./frontend/index.html', './frontend/js/**/*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        navy: { DEFAULT: '#0D1B2A', 2: '#1B3A5C' },
        teal: { DEFAULT: '#0A7E8C', light: '#E0F4F6' },
        gold: { DEFAULT: '#C49A00', light: '#FEF9E7' },
        brand: { green: '#1A7A4A', orange: '#C0642A', red: '#B03020' },
      },
    },
  },
};
