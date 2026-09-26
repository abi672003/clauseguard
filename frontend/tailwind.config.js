/** @type {import('tailwindcss').Config} */

/*  Colour strategy — ONE convention, used everywhere:
 *  every Tailwind colour below is a direct `var(--token)` reference, so the
 *  values in src/index.css are the single source of truth. Tailwind opacity
 *  modifiers (bg-accent/10) cannot work with var() colours, so index.css also
 *  publishes channel-triplet twins (--accent-rgb, …) of the *same* tokens for
 *  the rare case you need alpha:  bg-[rgb(var(--accent-rgb)/0.12)]
 *  Never introduce a colour that is not one of these tokens.
 */
const tokens = {
  bg: 'var(--bg)',
  'bg-elev': 'var(--bg-elev)',
  surface: 'var(--surface)',
  border: 'var(--border)',
  text: 'var(--text)',
  muted: 'var(--muted)',
  accent: 'var(--accent)',
  grounded: 'var(--grounded)',
  uncertain: 'var(--uncertain)',
  ungrounded: 'var(--ungrounded)',
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: tokens,
      borderColor: tokens,
      ringColor: tokens,
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      transitionTimingFunction: {
        instrument: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        240: '240ms',
        320: '320ms',
        420: '420ms',
      },
      boxShadow: {
        glow: '0 0 0 1px var(--border), 0 18px 48px -24px rgb(var(--accent-rgb) / 0.55)',
        panel: '0 24px 64px -32px rgb(var(--bg-rgb) / 0.9)',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': {
            boxShadow: '0 0 0 0 rgb(var(--accent-rgb) / 0.42)',
            opacity: '1',
          },
          '50%': {
            boxShadow: '0 0 0 10px rgb(var(--accent-rgb) / 0)',
            opacity: '0.72',
          },
        },
        shimmer: {
          '0%': { backgroundPosition: '-160% 0' },
          '100%': { backgroundPosition: '160% 0' },
        },
        rise: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-glow': 'pulse-glow 2.4s cubic-bezier(0.22, 1, 0.36, 1) infinite',
        shimmer: 'shimmer 1.6s cubic-bezier(0.22, 1, 0.36, 1) infinite',
        rise: 'rise 0.32s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};
