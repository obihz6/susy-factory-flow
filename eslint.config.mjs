import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  prettier,
  {
    rules: {
      // eslint-plugin-react-hooks v7 (via eslint-config-next 16) enables the
      // React Compiler-era rules. This codebase predates them and uses the
      // ref-box pattern on purpose: board-motion.tsx and InspectorPanel.tsx
      // keep animation state in a stable ref mutated during render so tweens
      // never re-render the whole board, and several effects deliberately
      // read localStorage after mount so the server render matches the first
      // client paint (see WhatsNewGate, PlanIdentityDrawer, HeaderLinks).
      // Rewriting those for the compiler is its own project; the classic
      // hooks rules (exhaustive-deps etc.) stay enforced.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      // Underscore-prefixed bindings are deliberate placeholders.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
