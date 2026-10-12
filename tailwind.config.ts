import type { Config } from 'tailwindcss';

// RaptorLabs palette, light theme. Token names are roles: ink is the page
// surface, coal the card surface, graphite the hairlines, bone the primary
// text and muted the secondary text; signal and crimson are the brand reds.
// Every text color clears WCAG AA (4.5:1) on the page surface.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#F7F4F3',
        coal: '#FFFFFF',
        graphite: '#DAD3D3',
        crimson: '#A20F10',
        signal: '#C42B2B',
        bone: '#1B1516',
        muted: '#675D5F',
        safe: '#177A4C',
        caution: '#A85A0B',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(196,43,43,0.25), 0 10px 28px -12px rgba(162,15,16,0.45)',
        card: '0 1px 2px rgba(27,21,22,0.04), 0 10px 30px -14px rgba(27,21,22,0.12)',
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
