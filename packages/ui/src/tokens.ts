export const tokens = {
  colors: {
    brand: {
      teal: '#0D9488',
      tealDark: '#0F766E',
      mint: '#10B981',
      mintLight: '#34D399',
      navy: '#0B192C',
      navyLight: '#152238',
      navyDark: '#060E18',
      gold: '#F59E0B',
      goldLight: '#FBBF24',
    },
    surface: {
      canvas: '#F8FAFC',
      card: '#FFFFFF',
      mintTint: '#F0FDF4',
      tealTint: '#F0FDFA',
      muted: '#F1F5F9',
    },
    text: {
      primary: '#0F172A',
      secondary: '#475569',
      muted: '#94A3B8',
      inverted: '#FFFFFF',
    },
    border: {
      subtle: '#F1F5F9',
      default: '#E2E8F0',
      active: '#10B981',
    },
  },
  radius: {
    sm: '0.375rem',
    md: '0.625rem',
    lg: '0.875rem',
    xl: '1.125rem',
    '2xl': '1.5rem',
    full: '9999px',
  },
  shadow: {
    card: '0 4px 20px -2px rgba(11, 25, 44, 0.06), 0 2px 6px -1px rgba(11, 25, 44, 0.02)',
    cardHover: '0 14px 34px -4px rgba(13, 148, 136, 0.16), 0 6px 14px -2px rgba(11, 25, 44, 0.05)',
    button: '0 4px 14px 0 rgba(16, 185, 129, 0.35)',
  },
} as const;

export type ThemeTokens = typeof tokens;
