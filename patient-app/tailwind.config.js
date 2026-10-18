/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 4px 24px -6px rgba(0, 0, 0, 0.06), 0 0 1px rgba(0, 0, 0, 0.1)',
      },
    },
  },
  plugins: [],
}
