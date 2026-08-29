/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
      },
      boxShadow: {
        'apple': '0 4px 24px -6px rgba(0, 0, 0, 0.05), 0 0 1px rgba(0,0,0,0.1)',
        'apple-btn': '0 1px 2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0,0,0,0.05)',
      }
    },
  },
  plugins: [],
}
