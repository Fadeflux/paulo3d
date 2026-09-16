/** Tailwind compilé au build : le CSS utilisé est intégré dans docs/index.html (rapide, hors-ligne, sans script externe). */
module.exports = {
  content: ['./src/index.html', './src/js/**/*.js'],
  // classes composées dynamiquement (btn-${variant})
  safelist: ['btn-primary', 'btn-secondary', 'btn-ghost', 'btn-danger'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#05070A', 900: '#0A0E13', 850: '#0D1218', 800: '#121922', 700: '#19222D', 600: '#243142', 500: '#334358' },
        neon: { DEFAULT: '#22F2A0', 300: '#86F9CB', 400: '#4DF7B4', 600: '#12C987', 700: '#0B8F5E' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
};
