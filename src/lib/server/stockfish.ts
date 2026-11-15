/**
 * Stockfish on the server (Node), for the phone app. Same lite single-threaded
 * WASM build the browser uses. One engine per server instance, reused across
 * requests; searches run one at a time.
 */

import initStockfish from "stockfish";
import { applyInfoLine, emptyAnalysis, parseBestmove, type Analysis } from "@/lib/uci";

type Engine = { processCommand(cmd: string): void };

let engine: Engine | null = null;
const handlers = new Set<(line: string) => void>();
let queue: Promise<unknown> = Promise.resolve();

function getEngine(): Engine {
  if (!engine) {
    engine = initStockfish("lite-single", (line: string) => {
      for (const h of handlers) h(String(line));
    }) as Engine;
    engine.processCommand("uci");
    engine.processCommand("setoption name Hash value 32");
  }
  return engine;
}

export function analyzeOnServer(fen: string, movetimeMs: number): Promise<Analysis> {
  const run = () =>
    new Promise<Analysis>((resolve, reject) => {
      const sf = getEngine();
      const result = emptyAnalysis();
      const timer = setTimeout(() => {
        handlers.delete(onLine);
        reject(new Error("Stockfish timed out"));
      }, movetimeMs + 10_000);
      const onLine = (line: string) => {
        applyInfoLine(result, line);
        if (line.startsWith("bestmove")) {
          clearTimeout(timer);
          handlers.delete(onLine);
          result.bestmove = parseBestmove(line);
          resolve(result);
        }
      };
      handlers.add(onLine);
      sf.processCommand(`position fen ${fen}`);
      sf.processCommand(`go movetime ${Math.round(movetimeMs)}`);
    });
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
