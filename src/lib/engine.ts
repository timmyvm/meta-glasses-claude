/**
 * Minimal UCI wrapper around the Stockfish WASM build running in a Web Worker.
 * The engine files are copied into /public/stockfish by scripts/copy-stockfish.mjs.
 */

import { applyInfoLine, emptyAnalysis, parseBestmove, type Analysis } from "./uci";

export type { Analysis } from "./uci";

export const ENGINE_URL = "/stockfish/stockfish-19-lite-single.js";

type LineHandler = (line: string) => void;

export class Engine {
  private worker: Worker;
  private handlers = new Set<LineHandler>();
  private queue: Promise<unknown> = Promise.resolve();
  private searching = false;

  constructor(url: string = ENGINE_URL) {
    this.worker = new Worker(url);
    this.worker.onmessage = (e: MessageEvent) => {
      const line = String(e.data);
      for (const h of this.handlers) h(line);
    };
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  private waitFor(match: (line: string) => boolean, onLine?: LineHandler): Promise<string> {
    return new Promise((resolve) => {
      const h: LineHandler = (line) => {
        onLine?.(line);
        if (match(line)) {
          this.handlers.delete(h);
          resolve(line);
        }
      };
      this.handlers.add(h);
    });
  }

  async init(): Promise<void> {
    this.send("uci");
    await this.waitFor((l) => l === "uciok");
    this.send("setoption name Hash value 64");
    this.send("isready");
    await this.waitFor((l) => l === "readyok");
  }

  /**
   * Search a position. If a search is already running it is stopped first;
   * the stopped search still resolves, so callers should ignore stale results.
   */
  analyze(fen: string, movetimeMs: number): Promise<Analysis> {
    if (this.searching) this.send("stop");

    const run = async (): Promise<Analysis> => {
      this.searching = true;
      const result = emptyAnalysis();
      this.send(`position fen ${fen}`);
      this.send(`go movetime ${Math.round(movetimeMs)}`);
      const done = await this.waitFor(
        (l) => l.startsWith("bestmove"),
        (l) => applyInfoLine(result, l),
      );
      this.searching = false;
      result.bestmove = parseBestmove(done);
      return result;
    };

    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  terminate() {
    this.handlers.clear();
    this.worker.terminate();
  }
}
