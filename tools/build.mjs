import { build as bundle } from "esbuild";
import { build as viteBuild } from "vite";
await viteBuild();
await bundle({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server/main.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  sourcemap: true,
});
