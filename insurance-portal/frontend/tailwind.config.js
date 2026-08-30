/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        'apple': '0 4px 24px -6px rgba(0, 0, 0, 0.05), 0 0 1px rgba(0,0,0,0.1)',
        'apple-btn': '0 1px 2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0,0,0,0.05)',
      }
    },
  },
  plugins: [],
}
