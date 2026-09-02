/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#16324F',
        'deep-navy': '#0D1F33',
        gold: '#F5A623',
        orange: '#E8871E',
        neutral: '#5A6B7B',
        canvas: '#F8FAFC',
        surface: '#FFFFFF',
        success: '#15803D',
        danger: '#B91C1C',
        text: '#16324F',
        muted: '#5A6B7B',
        border: '#D8E0E8',
        background: '#F8FAFC',
      },
      borderRadius: { mk: '0.75rem' },
      boxShadow: { mk: '0 12px 30px rgba(13, 31, 51, 0.12)' },
    },
  },
  plugins: [],
};
