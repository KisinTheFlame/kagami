import tailwindcssAnimate from "tailwindcss-animate";
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // 正文 / UI：拉丁 Literata（纸本感）+ 中文思源黑体
        sans: ['"Literata"', '"Noto Sans SC"', "ui-sans-serif", "system-ui", "sans-serif"],
        // 标题 / display：Fraunces（文艺复兴刻字）+ 中文思源宋体
        serif: ['"Fraunces"', '"Noto Serif SC"', "ui-serif", "Georgia", "serif"],
        // 数据 / ID / token / 时间戳
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      borderWidth: {
        // 蒙德里安硬线：结构边界一律 2px 暖近黑
        DEFAULT: "2px",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        // 语义颜料色（配给制，只落在「活着 / 有语义」的数据上）
        signal: {
          DEFAULT: "hsl(var(--signal))",
          foreground: "hsl(var(--signal-foreground))",
        },
        llm: {
          DEFAULT: "hsl(var(--llm))",
          foreground: "hsl(var(--llm-foreground))",
        },
        scheduler: {
          DEFAULT: "hsl(var(--scheduler))",
          foreground: "hsl(var(--scheduler-foreground))",
        },
        story: {
          DEFAULT: "hsl(var(--story))",
          foreground: "hsl(var(--story-foreground))",
        },
        cost: {
          DEFAULT: "hsl(var(--cost))",
          foreground: "hsl(var(--cost-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          brand: "hsl(var(--sidebar-brand))",
          active: "hsl(var(--sidebar-active))",
          "active-foreground": "hsl(var(--sidebar-active-foreground))",
          border: "hsl(var(--sidebar-border))",
        },
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
