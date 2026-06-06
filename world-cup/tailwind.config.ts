import type { Config } from "tailwindcss";

// The World Cup theme is pitch-green. To reuse the proven UI primitives
// from the hockey app verbatim, we keep their semantic token NAMES
// (`ice` for the accent ramp, `puck` for surfaces) but point them at the
// green palette. `pitch`/`field` are exposed as friendlier aliases for
// any new components.
const green = {
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
};

const surface = {
  bg: "#0a1410",
  card: "#10231a",
  border: "#1d3a2b",
};

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ice: green,
        pitch: green,
        puck: surface,
        field: surface,
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
