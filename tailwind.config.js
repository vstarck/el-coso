/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app.html", "./src/app/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        fg: "var(--fg)",
        "fg-muted": "var(--fg-muted)",
        "fg-dim": "var(--fg-dim)",
        "fg-faint": "var(--fg-faint)",
        border: "var(--border)",
        "border-2": "var(--border-2)",
        "border-3": "var(--border-3)",
        accent: "var(--accent)",
        "accent-text": "var(--accent-text)",
        "accent-tint": "var(--accent-tint)",
        "accent-edge": "var(--accent-edge)",
        "accent-row-bg": "var(--accent-row-bg)",
        "panel-1": "var(--panel-1)",
        "panel-2": "var(--panel-2)",
        "panel-3": "var(--panel-3)",
      },
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        panel: "12px",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
