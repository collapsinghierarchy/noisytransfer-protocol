// eslint.config.mjs
import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import n from "eslint-plugin-n";
import promise from "eslint-plugin-promise";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import prettier from "eslint-config-prettier";
import globals from "globals";
import security from "eslint-plugin-security";
import regexp from "eslint-plugin-regexp";

export default [
  // Ignore junk (now also ignoring scripts/**)
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.changeset/**",
      "scripts/**",
    ],
  },

  // Runtime sources (isomorphic: Node + browser + WebRTC)
  {
    files: ["packages/**/src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.es2021,
        ...globals.node,
        ...globals.browser,
        RTCPeerConnection: "readonly",
        RTCIceCandidate: "readonly",
        RTCSessionDescription: "readonly",
        WebSocket: "readonly",
        Blob: "readonly",
      },
    },
    plugins: {
      import: importPlugin,
      n,
      promise,
      security,
      "no-unsanitized": noUnsanitized,
      regexp,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...n.configs["recommended-module"].rules,
      ...promise.configs.recommended.rules,

      "import/order": [
        "warn",
        {
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
          groups: [["builtin", "external"], "internal", ["parent", "sibling", "index"]],
        },
      ],

      "no-empty": ["warn", { allowEmptyCatch: true }],
      "promise/param-names": "off",
      "n/no-unsupported-features/node-builtins": "off",
      "n/no-missing-import": "off",
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },

  // Tests
  {
    files: ["packages/**/test/**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { "no-console": "off" },
  },

  // Let Prettier own formatting
  prettier,
];
