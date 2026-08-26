module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true, jest: true },
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint", "react"],
  settings: { react: { version: "detect" } },
  ignorePatterns: [
    "dist",
    "coverage",
    "node_modules",
    "src/supabase/archive",
    "supabase/functions/**", // Deno runtime, not Node/browser -- linted separately
    "android", // Capacitor-generated native project + Gradle build output (gitignored, but not glob-excluded here -- ESLint doesn't read .gitignore on its own)
    "ios", // Capacitor-generated native project (Swift Package Manager artifacts)
    "test-results",
    "playwright-report",
  ],
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      extends: ["plugin:@typescript-eslint/recommended"],
    },
  ],
  rules: {
    "react/prop-types": "off", // migrating to TypeScript for prop typing instead
    "react/react-in-jsx-scope": "off", // React 18 automatic JSX runtime
    "no-unused-vars": "warn",
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-explicit-any": "off",
  },
};
