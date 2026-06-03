import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        blush: {
          50: '#fff7fb',
          100: '#f6d9e9',
          200: '#DFB2CB',
          300: '#E3A2C8',
          400: '#d982b3',
          500: '#c96a9e'
        },
        skysoft: {
          50: '#f5f8fe',
          100: '#e2ebf8',
          200: '#B4C6E2',
          300: '#A4BBE0',
          400: '#84a2d2',
          500: '#6689bf'
        },
        creamsoft: {
          50: '#fbfaf7',
          100: '#eeece6',
          200: '#D9D8D3',
          300: '#c8c6bf',
          400: '#b6b2a9'
        }
      },
      boxShadow: {
        soft: '0 18px 50px rgba(113, 110, 125, 0.14)',
        dreamy: '0 24px 70px rgba(164, 187, 224, 0.22)'
      }
    }
  },
  plugins: []
};

export default config;
