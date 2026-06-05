import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Pitch greens for the World Cup theme.
        pitch: {
          50: "#f1faf3",
          100: "#dcf2e1",
          200: "#bbe4c6",
          300: "#8bcfa1",
          400: "#54b074",
          500: "#2f9354",
          600: "#1f7642",
          700: "#1a5d37",
          800: "#174a2e",
          900: "#143d28",
          950: "#0a2316",
        },
        field: {
          bg: "#0a1410",
          card: "#10231a",
          border: "#1d3a2b",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
