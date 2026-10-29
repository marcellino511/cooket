/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#080B12',
        surface: '#121826',
        elevated: '#182132',
        ink: '#F8FAFC',
        muted: '#94A3B8',
        line: '#263244',
        brand: {
          DEFAULT: '#60A5FA',
          hover: '#93C5FD',
          50: 'rgba(96, 165, 250, 0.12)',
          100: 'rgba(96, 165, 250, 0.22)',
        },
        success: { DEFAULT: '#34D399', 50: 'rgba(52, 211, 153, 0.12)', 100: 'rgba(52, 211, 153, 0.24)' },
        warning: { DEFAULT: '#FBBF24', 50: 'rgba(251, 191, 36, 0.12)', 100: 'rgba(251, 191, 36, 0.24)' },
        danger: { DEFAULT: '#F87171', 50: 'rgba(248, 113, 113, 0.12)', 100: 'rgba(248, 113, 113, 0.26)' },
        // The default light slate scale is remapped for a dark interface: low numbers are surfaces, high numbers are text.
        slate: {
          50: '#182132',
          100: '#1C2638',
          200: '#263244',
          300: '#334155',
          400: '#64748B',
          500: '#7C8BA1',
          600: '#94A3B8',
          700: '#CBD5E1',
          800: '#E2E8F0',
          900: '#F1F5F9',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      borderRadius: {
        card: '16px',
        control: '10px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0, 0, 0, 0.35)',
        pop: '0 16px 40px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.4)',
      },
      spacing: {
        18: '4.5rem',
      },
    },
  },
  plugins: [],
}
