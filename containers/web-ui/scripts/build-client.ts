import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(process.cwd());
const distDir = resolve(root, "dist");

const copy = async (
  sourceRelativePath: string,
  destinationRelativePath: string,
): Promise<void> => {
  const source = resolve(root, sourceRelativePath);
  const destination = resolve(root, destinationRelativePath);
  const content = await Bun.file(source).text();
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf-8");
};

await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [resolve(root, "src/client/main.tsx")],
  outfile: resolve(distDir, "main.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  sourcemap: false,
});

await copy("src/client/index.html", "dist/index.html");
await copy("src/client/styles.css", "dist/styles.css");
