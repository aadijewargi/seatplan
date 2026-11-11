// Build script: bundles the web app (page + Web Worker) into dist/site and
// the command-line tool into dist/cli.js. Zero runtime dependencies.
//
//   node scripts/build.mjs             build everything
//   node scripts/build.mjs --cli-only  build only dist/cli.js (used by `prepare`)
//   node scripts/build.mjs --serve     build the site and serve it on :8000
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const cliOnly = args.has("--cli-only");
const serve = args.has("--serve");

async function buildCli() {
  mkdirSync("dist", { recursive: true });
  await build({
    entryPoints: ["src/cli.ts"],
    outfile: "dist/cli.js",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
  });
}

const siteOptions = {
  entryPoints: { app: "src/app/main.ts", worker: "src/app/worker.ts" },
  outdir: "dist/site",
  bundle: true,
  format: "esm",
  target: "es2020",
  minify: !serve,
  sourcemap: serve,
};

function copyStatic() {
  mkdirSync("dist/site", { recursive: true });
  cpSync("public", "dist/site", { recursive: true });
}

if (cliOnly) {
  await buildCli();
} else if (serve) {
  copyStatic();
  const ctx = await context(siteOptions);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: "dist/site", port: 8000 });
  console.log(`seatplan dev server: http://localhost:${port}/`);
} else {
  rmSync("dist", { recursive: true, force: true });
  copyStatic();
  await build(siteOptions);
  await buildCli();
  console.log("built dist/site and dist/cli.js");
}
