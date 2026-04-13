/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/client/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          50:  '#f0f0f0',
          100: '#d4d4d4',
          200: '#1e1e1e',
          300: '#252525',
          400: '#2c2c2c',
          500: '#333333',
          600: '#3a3a3a',
          700: '#444444',
          800: '#555555',
        },
        brand: {
          DEFAULT: '#f97316',
          dim: '#c2570d',
        },
        meter: {
          green: '#22c55e',
          yellow: '#eab308',
          red: '#ef4444',
          clip: '#ff0000',
          gr: '#3b82f6',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
