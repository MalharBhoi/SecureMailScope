/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        crit: 'var(--crit)',
        'crit-soft': 'var(--crit-soft)',
        high: 'var(--high)',
        'high-soft': 'var(--high-soft)',
        med: 'var(--med)',
        'med-soft': 'var(--med-soft)',
        ok: 'var(--ok)',
        'ok-soft': 'var(--ok-soft)',
        info: 'var(--info)',
        'info-soft': 'var(--info-soft)',
        'shap-pos': 'var(--shap-pos)',
        'shap-neg': 'var(--shap-neg)',
      },
      fontFamily: {
        // Locally available faces only — see the note in index.html.
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'DejaVu Sans Mono', 'monospace'],
        display: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
