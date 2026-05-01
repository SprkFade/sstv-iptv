import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      colors: {
        ink: "#101317",
        mist: "#f5f7fa",
        panel: "#ffffff",
        line: "#dce3ea",
        accent: "#0f766e",
        berry: "#9f1239",
        gold: "#b45309"
      },
      boxShadow: {
        soft: "0 12px 36px rgba(16, 19, 23, 0.08)"
      }
    }
  },
  plugins: []
} satisfies Config;
