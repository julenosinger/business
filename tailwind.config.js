/** @type {import('tailwindcss').Config} */
const ch = (name) => `rgb(var(--${name}-rgb) / <alpha-value>)`

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: ch('bg'),
        panel: ch('panel'),
        ink: ch('ink'),
        accent: ch('accent'),
        'accent-ink': ch('accent-ink'),
        ok: ch('ok'),
        bad: ch('bad'),
        warn: ch('warn'),
        fill: ch('fill'),
        violet: ch('violet'),
        sky: ch('blue'),
        surface: 'var(--surface)',
        'surface-strong': 'var(--surface-strong)',
        muted: 'var(--muted)',
        subtle: 'var(--subtle)',
        line: 'var(--line)',
      },
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
        display: ['"Space Grotesk"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
