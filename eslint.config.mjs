import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/prisma/generated/**",
      "**/src/generated/prisma/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // 类型感知 linting：仅作用于各包 src（都在各自 tsconfig include 内）。测试 / 配置
  // 文件不在 program 里，不进此 scope，避免 "file not in project" 报错。
  // 所有需要类型信息的规则配置都必须留在本块（src），不能下放到下面的全局块，
  // 否则会对无类型信息的文件报致命错。
  {
    files: ["apps/server/src/**/*.ts", "apps/web/src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // require-await 噪声大（多为满足接口契约而声明的 async），关闭。
      "@typescript-eslint/require-await": "off",
      // no-unsafe-* 多来自 LLM / 外部无类型边界，先以 warn 做棘轮：可见但不阻塞，
      // 后续逐步收紧为 error。
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
    },
  },
  // JSX 事件处理器用 async 是常态（React 不 await 其返回值，是预期行为），关闭
  // attributes 维度的 void-return 检查，避免 onClick={async ...} 误报。仅 web src
  // （类型感知已开启处）配置该 type-aware 规则。
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportAllDeclaration",
          message: "禁止使用 re-export，请直接导入真实实现路径。",
        },
        {
          selector: "ExportNamedDeclaration[source!=null]",
          message: "禁止使用 re-export，请直接导入真实实现路径。",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: ["buttonVariants"],
        },
      ],
    },
  },
  // .cjs 是 CommonJS（如 PM2 ecosystem 配置），require 是其原生模块系统，
  // no-require-imports 不适用——在配置层关闭，取代文件内 disable。
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  prettierConfig,
);
