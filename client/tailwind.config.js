/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#ad5d3b', dark: '#8e482d', light: '#f5e9e3', contrast: '#7f422d' },
        teal: { DEFAULT: '#c17655', dark: '#8e482d' },
        gold: { DEFAULT: '#ffc107', dark: '#b77900' },
        success: '#198754',
        error: '#dc3545',
        charcoal: '#1b1917',
        ink: '#1d1b19',
        muted: '#6f6a64',
        surface: '#f8f6f3',
        border: '#e9e5e0',
      },
      fontFamily: { sans: ['Inter', 'sans-serif'], heading: ['Poppins', 'sans-serif'] },
      borderRadius: { card: '0.875rem', button: '0.5rem' },
      boxShadow: { card: '0 8px 24px -4px rgba(27, 25, 23, 0.08), 0 2px 4px -1px rgba(27, 25, 23, 0.04)' },
    },
  },
  plugins: [],
}


