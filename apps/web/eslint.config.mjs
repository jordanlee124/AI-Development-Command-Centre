import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Layer boundaries (ARCHITECTURE.md): domain is pure; UI reaches the database only through services.
const domainRule = {
  group: [
    "@/server/*",
    "@/app/*",
    "@/components/*",
    "@/generated/*",
    "@prisma/*",
    "next",
    "next/*",
    "react",
  ],
  message: "src/domain is pure: no I/O, framework or database imports.",
};
const uiRule = {
  group: ["@/server/db/*", "@/generated/*", "@prisma/*"],
  message: "UI calls services in src/server/services, never the database directly.",
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    files: ["src/domain/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [domainRule] }] },
  },
  {
    files: ["src/app/**", "src/components/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [uiRule] }] },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
