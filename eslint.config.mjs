import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    // The online demo's build output (npm run build:demo) and the git-excluded demo video sources.
    "dist-demo/**",
    "demo-video/**",
  ]),
  {
    rules: {
      // Plain <img>: the app runs on a local dev server without next/image optimisation.
      "@next/next/no-img-element": "off",
      // Request bodies, D1 rows and provider responses arrive as untyped JSON and are checked
      // field by field where they are used; they stay visible as warnings rather than errors.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
