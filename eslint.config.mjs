import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This rule flags React's own documented fetch-on-mount idiom
      // (calling an async loader inside useEffect) as an error. Every
      // flagged site in this app is a genuine fetch-then-setState after
      // an await, not a synchronous state derivation - downgraded to a
      // warning so it stays visible without blocking builds or forcing
      // risky rewrites of live money-critical data-loading code.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
