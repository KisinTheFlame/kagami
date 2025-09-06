import globals from "globals";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
    // Global ignores
    {
        ignores: ["dist/**", "node_modules/**"],
    },

    // Base configs
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,

    // Project-specific configuration
    {
        files: ["src/**/*.{ts,tsx}"],
        languageOptions: {
            globals: {
                ...globals.browser,
            },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            "@stylistic": stylistic,
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh,
        },
        rules: {
            // TypeScript rules
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_" },
            ],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-non-null-assertion": "error",

            // Stylistic rules
            "@stylistic/indent": ["error", 4],
            "@stylistic/quotes": ["error", "double"],
            "@stylistic/semi": ["error", "always"],
            "@stylistic/comma-dangle": ["error", "always-multiline"],
            "@stylistic/object-curly-spacing": ["error", "always"],
            "@stylistic/array-bracket-spacing": ["error", "never"],
            "@stylistic/eol-last": ["error", "always"],
            "@stylistic/arrow-parens": ["error", "as-needed"],

            // React rules
            ...reactHooks.configs.recommended.rules,
            "react-refresh/only-export-components": [
                "warn",
                { allowConstantExport: true },
            ],

            // General rules
            "no-console": "off",
            "prefer-const": "error",
            "no-var": "error",
        },
    },
);
