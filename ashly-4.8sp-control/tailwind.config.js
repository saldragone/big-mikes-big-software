/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/client/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base:   '#09090f',
          panel:  '#0f0f1a',
          raised: '#14141f',
          input:  '#0b0b14',
          hover:  '#1a1a28',
        },
        brand: {
          DEFAULT: '#f97316',
          dim:     '#c2570d',
          muted:   '#7c3810',
        },
        meter: {
          green:  '#22c55e',
          yellow: '#eab308',
          red:    '#ef4444',
          clip:   '#ff3333',
          gr:     '#3b82f6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        panel:    '0 1px 3px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.04)',
        'glow-brand': '0 0 16px rgba(249,115,22,0.35)',
        'glow-sm':    '0 0 8px rgba(249,115,22,0.2)',
      },
      borderColor: {
        subtle: 'rgba(255,255,255,0.06)',
        DEFAULT: 'rgba(255,255,255,0.10)',
        strong:  'rgba(255,255,255,0.16)',
      },
    },
  },
  plugins: [],
};
