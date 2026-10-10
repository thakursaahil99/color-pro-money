import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 950: "#060b1a", 900: "#0a1128", 800: "#111a38", 700: "#1a2550", 600: "#26336a" },
        game: { red: "#ef4444", green: "#22c55e", violet: "#a855f7" },
      },
      fontFamily: { sans: ["system-ui", "Segoe UI", "Roboto", "sans-serif"] },
      keyframes: {
        pop: { "0%": { transform: "scale(.9)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
      },
      animation: { pop: "pop .25s ease-out" },
    },
  },
  plugins: [],
} satisfies Config;
