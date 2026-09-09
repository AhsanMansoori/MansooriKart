/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--mk-background)',
        foreground: 'var(--mk-foreground)',
        card: 'var(--mk-card)',
        'card-foreground': 'var(--mk-card-foreground)',
        primary: 'var(--mk-primary)',
        'primary-foreground': 'var(--mk-primary-foreground)',
        'primary-light': 'var(--mk-primary-light)',
        secondary: 'var(--mk-secondary)',
        'secondary-foreground': 'var(--mk-secondary-foreground)',
        muted: 'var(--mk-muted)',
        'muted-foreground': 'var(--mk-muted-foreground)',
        accent: 'var(--mk-accent)',
        'accent-foreground': 'var(--mk-accent-foreground)',
        border: 'var(--mk-border)',
        input: 'var(--mk-input)',
        ring: 'var(--mk-ring)',
        destructive: 'var(--mk-destructive)',
        'destructive-foreground': 'var(--mk-destructive-foreground)',
        success: 'var(--mk-success)',
        'success-foreground': 'var(--mk-success-foreground)',
        warning: 'var(--mk-warning)',
        'warning-foreground': 'var(--mk-warning-foreground)',
        info: 'var(--mk-info)',
        'info-foreground': 'var(--mk-info-foreground)',
        brand: {
          green: 'var(--mk-brand-green)',
          'light-green': 'var(--mk-brand-light-green)',
          gold: 'var(--mk-brand-gold)',
          yellow: 'var(--mk-brand-yellow)',
        },
      },
      borderRadius: {
        mk: '0.75rem',
        'mk-lg': '1rem',
      },
      boxShadow: {
        mk: '0 12px 30px rgba(15, 23, 42, 0.08)',
      },
    },
  },
  plugins: [],
};
