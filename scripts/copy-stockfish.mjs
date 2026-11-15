// Copies the single-threaded "lite" Stockfish WASM build into /public so the
// browser can load it as a Web Worker. Runs automatically on `npm install`.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const src = join("node_modules", "stockfish", "bin");
const dest = join("public", "stockfish");
const files = ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"];

if (!existsSync(src)) {
  console.warn("[copy-stockfish] stockfish package not installed yet, skipping");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(join(src, f), join(dest, f));
console.log(`[copy-stockfish] copied ${files.length} files to ${dest}`);
