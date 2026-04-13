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
        ice: {
          50: "#f4f9ff",
          100: "#e6f1fb",
          200: "#cfe2f5",
          300: "#a7c9ea",
          400: "#6fa4d6",
          500: "#3e7fbf",
          600: "#2c62a3",
          700: "#254f83",
          800: "#21426a",
          900: "#1d3757",
          950: "#101f33",
        },
        puck: {
          bg: "#0b1220",
          card: "#101a2e",
          border: "#1f2d47",
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
