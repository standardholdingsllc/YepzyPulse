import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dark theme base colors
        dark: {
          bg: "#0f0f0f",
          "bg-secondary": "#1a1a1a",
          "bg-tertiary": "#242424",
          border: "#2e2e2e",
          "border-hover": "#404040",
        },
        // Accent color - teal
        accent: {
          DEFAULT: "#14b8a6",
          hover: "#0d9488",
          muted: "rgba(20, 184, 166, 0.15)",
          light: "#2dd4bf",
        },
        // Muted text
        muted: {
          DEFAULT: "#a1a1aa",
          light: "#d4d4d8",
        },
        // Legacy brand colors (mapped to accent)
        brand: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'glow': '0 0 20px rgba(20, 184, 166, 0.3)',
        'glow-sm': '0 0 10px rgba(20, 184, 166, 0.2)',
      },
    },
  },
  plugins: [],
};

export default config;
