import type { Config } from 'tailwindcss';

// RaptorLabs palette, dark theme over the deep-space backdrop. Token names
// are roles: ink is the page surface, coal the card surface, graphite the
// hairlines, bone the primary text and muted the secondary text; signal is
// the accent red and crimson the critical red, brighter than signal so it
// reads as the stronger alarm on dark surfaces. Every text color clears WCAG
// AA (4.5:1) on the page and card surfaces.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#05060A',
        coal: '#0D0F16',
        graphite: '#272A35',
        crimson: '#FF4D5E',
        signal: '#E24A4A',
        bone: '#ECEDF2',
        muted: '#9296A5',
        safe: '#3FBF7F',
        caution: '#F0A53A',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(214,59,59,0.35), 0 12px 40px -12px rgba(162,15,16,0.6)',
        card: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 44px -22px rgba(0,0,0,0.9)',
      },
      keyframes: {
        sweep: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
        pulsefade: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
      },
      animation: {
        sweep: 'sweep 1.6s ease-in-out infinite',
        pulsefade: 'pulsefade 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
