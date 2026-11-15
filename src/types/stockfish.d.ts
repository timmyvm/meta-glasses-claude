declare module "stockfish" {
  type StockfishEngine = { processCommand(cmd: string): void; terminate?: () => void };
  function initStockfish(enginePath: string, onMessage: (line: string) => void): StockfishEngine;
  export default initStockfish;
}
