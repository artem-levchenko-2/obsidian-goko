import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * Where a development build lands. Set VAULT_PLUGIN_DIR to a vault's plugin
 * folder and `npm run dev` writes straight into it, hot-reload file included.
 *
 * No default: this used to fall back to one person's vault path, which put
 * their disk layout in a public repository and, after the folder moved, wrote
 * builds somewhere nobody was looking.
 */
const vaultDir = process.env.VAULT_PLUGIN_DIR;
if (!production && !vaultDir) {
  console.log("[goko] VAULT_PLUGIN_DIR is not set - building into dist/ instead.");
}

const outdir = production || !vaultDir ? "dist" : vaultDir;
mkdirSync(outdir, { recursive: true });

function copyStatic() {
  copyFileSync("manifest.json", join(outdir, "manifest.json"));
  copyFileSync("styles.css", join(outdir, "styles.css"));
  if (!production && vaultDir) writeFileSync(join(outdir, ".hotreload"), "");
}

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtinModules],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: join(outdir, "main.js"),
  plugins: [
    {
      name: "copy-static",
      setup(build) {
        build.onEnd(() => copyStatic());
      },
    },
  ],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
