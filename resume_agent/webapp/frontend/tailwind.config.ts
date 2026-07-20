import type { Config } from "tailwindcss";

/**
 * Geist 设计系统 → Tailwind 主题映射。
 *
 * 颜色一律引用 tokens.css 里的 CSS 变量（var(--…)），因此 Light/Dark 切换只需
 * 在 <html> 上加/去 `.dark` 类，无需重编译。强调色的 P3 广色域升级也在
 * tokens.css 的 @media (color-gamut: p3) 里自动生效。
 *
 * 配套文件：src/styles/tokens.css（必须在应用入口 import）。
 */

/** 生成某个强调色 100–1000 的完整 scale，值指向 CSS 变量 */
const scale = (name: string) =>
  Object.fromEntries(
    [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((step) => [
      step,
      `var(--${name}-${step})`,
    ]),
  );

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // 断点对齐 Geist：sm 401 / md 601 / lg 961 / xl 1200 / 2xl 1400
    screens: {
      sm: "401px",
      md: "601px",
      lg: "961px",
      xl: "1200px",
      "2xl": "1400px",
    },
    extend: {
      // ⚠️ 透明度修饰符：下面颜色存的是「完整色值」（hex / oklch），Tailwind v3 无法对其
      // 应用 `/90`、`hover:bg-primary/80` 这类 opacity modifier（只有拆成颜色通道才行）。
      // 这是 Geist 广色域方案的取舍——Geist 交互态本就靠色阶步进（100→200→300）而非
      // alpha。落 shadcn 组件后，把默认皮肤里的 `bg-primary/90` 换成对应 hover 色阶
      //（如 `hover:bg-accent`）。若某个组件确需 alpha，可单独把该色写成：
      //   primary: 'color-mix(in oklab, var(--primary) calc(<alpha-value> * 100%), transparent)'
      colors: {
        // —— Geist 原始 scale —— //
        background: {
          100: "var(--background-100)",
          200: "var(--background-200)",
          // 裸 `background` 供 shadcn 语义使用（= background-100）
          DEFAULT: "var(--background)",
        },
        gray: {
          ...scale("gray"),
          alpha: Object.fromEntries(
            [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((s) => [
              s,
              `var(--gray-alpha-${s})`,
            ]),
          ),
        },
        blue: scale("blue"),
        red: scale("red"),
        amber: scale("amber"),
        green: scale("green"),
        teal: scale("teal"),
        purple: scale("purple"),
        pink: scale("pink"),

        // —— shadcn 语义 token —— //
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
          hover: "var(--destructive-hover)", // → bg-destructive-hover（a11y 安全的暗化 hover）
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        overlay: "var(--overlay)",
        "resume-canvas": "var(--resume-canvas)",
        "primary-subtle": "var(--primary-subtle)",
        // 中栏画布悬浮缩放控件（Figma 1004:981）
        "canvas-control": {
          DEFAULT: "var(--canvas-control)",
          foreground: "var(--canvas-control-foreground)",
          border: "var(--canvas-control-border)",
          hover: "var(--canvas-control-hover)",
        },
        gallery: {
          DEFAULT: "var(--gallery-background)",
          surface: "var(--gallery-surface)",
          preview: "var(--gallery-preview)",
          foreground: "var(--gallery-foreground)",
          muted: "var(--gallery-muted)",
          control: "var(--gallery-control)",
          active: "var(--gallery-active)",
          "active-foreground": "var(--gallery-active-foreground)",
          border: "var(--gallery-border)",
          card: "var(--gallery-card)",
        },
        editor: {
          "header-border": "var(--editor-header-border)",
          switch: "var(--editor-header-switch)",
          "switch-border": "var(--editor-header-switch-border)",
          title: "var(--editor-header-title)",
          muted: "var(--editor-header-muted)",
        },
      },

      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
      },

      // Geist 排版 token：[fontSize, { lineHeight, letterSpacing, fontWeight }]
      fontSize: {
        "heading-72": ["72px", { lineHeight: "72px", letterSpacing: "-4.32px", fontWeight: "600" }],
        "heading-64": ["64px", { lineHeight: "64px", letterSpacing: "-3.84px", fontWeight: "600" }],
        "heading-56": ["56px", { lineHeight: "56px", letterSpacing: "-3.36px", fontWeight: "600" }],
        "heading-48": ["48px", { lineHeight: "56px", letterSpacing: "-2.88px", fontWeight: "600" }],
        "heading-40": ["40px", { lineHeight: "48px", letterSpacing: "-2.4px", fontWeight: "600" }],
        "heading-32": ["32px", { lineHeight: "40px", letterSpacing: "-1.28px", fontWeight: "600" }],
        "heading-24": ["24px", { lineHeight: "32px", letterSpacing: "-0.96px", fontWeight: "600" }],
        "heading-20": ["20px", { lineHeight: "26px", letterSpacing: "-0.4px", fontWeight: "600" }],
        "heading-16": ["16px", { lineHeight: "24px", letterSpacing: "-0.32px", fontWeight: "600" }],
        "heading-14": ["14px", { lineHeight: "20px", letterSpacing: "-0.28px", fontWeight: "600" }],

        "button-16": ["16px", { lineHeight: "20px", fontWeight: "500" }],
        "button-14": ["14px", { lineHeight: "20px", fontWeight: "500" }],
        "button-12": ["12px", { lineHeight: "16px", fontWeight: "500" }],

        "label-20": ["20px", { lineHeight: "32px", fontWeight: "400" }],
        "label-18": ["18px", { lineHeight: "20px", fontWeight: "400" }],
        "label-16": ["16px", { lineHeight: "20px", fontWeight: "400" }],
        "label-14": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "label-14-mono": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "label-13": ["13px", { lineHeight: "16px", fontWeight: "400" }],
        "label-13-mono": ["13px", { lineHeight: "20px", fontWeight: "400" }],
        "label-12": ["12px", { lineHeight: "16px", fontWeight: "400" }],
        "label-12-mono": ["12px", { lineHeight: "16px", fontWeight: "400" }],

        "copy-24": ["24px", { lineHeight: "36px", fontWeight: "400" }],
        "copy-20": ["20px", { lineHeight: "36px", fontWeight: "400" }],
        "copy-18": ["18px", { lineHeight: "28px", fontWeight: "400" }],
        "copy-16": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "copy-14": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "copy-14-mono": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "copy-13": ["13px", { lineHeight: "18px", fontWeight: "400" }],
        "copy-13-mono": ["13px", { lineHeight: "18px", fontWeight: "400" }],
      },

      // 4px 基准间距（补充 Tailwind 默认之外的 Geist 语义步进）
      spacing: {
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        6: "24px",
        8: "32px",
        10: "40px",
        16: "64px",
        24: "96px",
        "gallery-gap": "1.3125rem",
        "gallery-copy-gap": "0.5625rem",
      },

      width: {
        "editor-left": "27.5rem",
        "editor-left-compact": "22.5rem",
        "editor-right": "22.5rem",
        "editor-right-compact": "20rem",
        "resume-mobile": "24.375rem",
        "month-picker": "15.5rem",
        "dialog-mobile": "calc(100% - 2rem)",
      },

      maxWidth: {
        content: "75rem",
        prose: "65ch",
        "mobile-panel": "calc(100vw - 3rem)",
      },

      height: {
        "app-header": "3.25rem",
        "resume-thumbnail": "10.0625rem",
        "thumb-document": "35rem",
        "gallery-preview-document": "8.125rem",
      },

      minHeight: {
        "page-fallback": "50dvh",
        dropzone: "8.125rem",
      },

      maxHeight: {
        dialog: "80dvh",
        "dialog-list": "50dvh",
        select: "17.5rem",
        dropdown: "var(--radix-dropdown-menu-content-available-height)",
      },

      minWidth: {
        "select-trigger": "var(--radix-select-trigger-width)",
      },

      gridTemplateColumns: {
        import: "1fr auto 1fr",
        gallery: "repeat(4, 17.75rem)",
      },

      scale: {
        press: "0.97",
      },

      borderRadius: {
        sm: "6px",
        header: "8px",
        control: "10px",
        md: "12px",
        lg: "16px",
        full: "9999px",
        gallery: "2rem",
        DEFAULT: "var(--radius)",
      },

      boxShadow: {
        card: "var(--shadow-card)",
        popover: "var(--shadow-popover)",
        modal: "var(--shadow-modal)",
        "canvas-control": "var(--shadow-canvas-control)",
        // 两层聚焦环
        focus: "0 0 0 2px var(--background-100), 0 0 0 4px var(--ring)",
      },

      transitionTimingFunction: {
        geist: "cubic-bezier(0.175, 0.885, 0.32, 1.1)",
      },
      transitionDuration: {
        state: "150ms",
        popover: "200ms",
        overlay: "300ms",
      },
      transitionProperty: {
        progress: "width",
      },
    },
  },
  plugins: [],
} satisfies Config;
