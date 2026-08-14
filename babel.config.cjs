// Used by Jest only -- Vite compiles the app itself via esbuild/@vitejs/plugin-react
// and never reads this file. `transform-vite-meta-env` rewrites
// `import.meta.env.X` to `process.env.X` so modules written for Vite (which
// use import.meta.env) can still be required by Jest's CommonJS transform.
module.exports = {
  presets: [
    ["@babel/preset-env", { targets: { node: "current" } }],
    ["@babel/preset-react", { runtime: "automatic" }],
    "@babel/preset-typescript",
  ],
  plugins: [
    process.env.NODE_ENV === "test" ? "transform-vite-meta-env" : null,
  ].filter(Boolean),
};
