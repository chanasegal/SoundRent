/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        royal: {
          DEFAULT: '#002244',
          dark: '#001a36',
          light: '#003366'
        }
      },
      fontFamily: {
        sans: ['Heebo', 'system-ui', 'sans-serif']
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateY(-8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        }
      }
    }
  },
  plugins: []
};
