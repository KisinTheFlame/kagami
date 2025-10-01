import globals from "globals";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";

export default tseslint.config(
    // Global ignores
    {
        ignores: ["dist/**", "node_modules/**", "src/generated/**"],
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
                ...globals.node,
            },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            "@stylistic": stylistic,
        },
        rules: {
            // TypeScript rules
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_" },
            ],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-non-null-assertion": "error",
            "@typescript-eslint/consistent-type-definitions": ["error", "type"],

            // Stylistic rules - Basic formatting
            "@stylistic/no-trailing-spaces": "error",
            "@stylistic/indent": ["error", 4],
            "@stylistic/quotes": ["error", "double"],
            "@stylistic/semi": ["error", "always"],
            "@stylistic/comma-dangle": ["error", "always-multiline"],
            "@stylistic/object-curly-spacing": ["error", "always"],
            "@stylistic/array-bracket-spacing": ["error", "never"],
            "@stylistic/eol-last": ["error", "always"],
            "@stylistic/arrow-parens": ["error", "as-needed"],
            "@stylistic/member-delimiter-style": ["error", {
                "multiline": {
                    "delimiter": "comma",
                    "requireLast": true
                },
                "singleline": {
                    "delimiter": "comma",
                    "requireLast": false
                }
            }],

            // Stylistic rules - Spacing
            "@stylistic/keyword-spacing": ["error", { "before": true, "after": true }],
            "@stylistic/key-spacing": ["error", { "beforeColon": false, "afterColon": true }],
            "@stylistic/comma-spacing": ["error", { "before": false, "after": true }],
            "@stylistic/space-before-blocks": ["error", "always"],
            "@stylistic/arrow-spacing": ["error", { "before": true, "after": true }],
            "@stylistic/space-infix-ops": "error",
            "@stylistic/type-annotation-spacing": ["error", {
                "before": false,
                "after": true,
                "overrides": { "arrow": { "before": true, "after": true } }
            }],
            "@stylistic/function-call-spacing": ["error", "never"],
            "@stylistic/space-in-parens": ["error", "never"],
            "@stylistic/semi-spacing": ["error", { "before": false, "after": true }],

            // Stylistic rules - Lines and blocks
            "@stylistic/brace-style": ["error", "1tbs"],
            "@stylistic/spaced-comment": ["error", "always"],
            "@stylistic/max-len": ["error", {
                "code": 120,
                "tabWidth": 4,
                "ignoreUrls": true,
                "ignoreStrings": true,
                "ignoreTemplateLiterals": true,
                "ignoreRegExpLiterals": true,
                "ignoreComments": false,
            }],

            // General rules
            "no-console": "off",
            "prefer-const": "error",
            "no-var": "error",
        },
    },
);