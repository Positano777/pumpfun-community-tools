import type { Config } from 'tailwindcss';

// RaptorLabs palette: deep black, charcoal, graphite, crimson, signal red, white.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#050303',
        coal: '#150F10',
        graphite: '#302C2D',
        crimson: '#A20F10',
        signal: '#D63B3B',
        bone: '#F4F1F1',
        muted: '#9C9293',
        safe: '#3FBF7F',
        caution: '#F0A53A',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(214,59,59,0.35), 0 12px 48px -12px rgba(162,15,16,0.55)',
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
