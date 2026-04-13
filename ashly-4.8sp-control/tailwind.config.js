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
          base: '#0f1117',
          panel: '#161b22',
          raised: '#1c2333',
          input: '#0f1117',
          hover: '#1c2333',
        },
        brand: {
          DEFAULT: '#58a6ff',
          dim: '#388bfd',
          muted: '#1f6feb',
        },
        surface: '#161b22',
        border: {
          DEFAULT: '#30363d',
          subtle: '#21262d',
        },
        text: {
          primary: '#e1e4e8',
          secondary: '#8b949e',
          muted: '#484f58',
        },
        green: {
          DEFAULT: '#238636',
          text: '#3fb950',
        },
        blue: {
          DEFAULT: '#1f6feb',
          text: '#58a6ff',
        },
        red: {
          DEFAULT: '#da3633',
          text: '#f85149',
        },
        yellow: {
          DEFAULT: '#d29922',
        },
        meter: {
          green: '#3fb950',
          yellow: '#d29922',
          red: '#f85149',
          clip: '#ff4444',
          gr: '#58a6ff',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", 'Roboto', 'sans-serif'],
        mono: ["'SF Mono'", 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 3px rgba(0,0,0,0.4)',
        glow: '0 0 12px rgba(88,166,255,0.25)',
      },
    },
  },
  plugins: [],
};
