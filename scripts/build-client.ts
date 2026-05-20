import { build } from "esbuild";

await build({
  entryPoints: ["src/client/app.tsx"],
  outfile: "dist/app.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  jsx: "automatic",
  minify: false,
  platform: "browser",
});
