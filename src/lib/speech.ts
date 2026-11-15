const PIECE_NAMES: Record<string, string> = {
  K: "King",
  Q: "Queen",
  R: "Rook",
  B: "Bishop",
  N: "Knight",
};

/** Uppercase squares read more reliably in TTS ("A4" vs the article "a"). */
function square(sq: string): string {
  return sq.toUpperCase();
}

/**
 * Turn SAN into something a text-to-speech voice says clearly.
 *   Nf3     -> "Knight F3"
 *   exd5    -> "E takes D5"
 *   Nbd2    -> "Knight B, D2"
 *   O-O     -> "Castle kingside"
 *   e8=Q+   -> "E8, promote to Queen, check"
 */
export function sanToSpeech(san: string): string {
  const check = san.endsWith("#") ? ", checkmate" : san.endsWith("+") ? ", check" : "";
  const core = san.replace(/[+#!?]+$/, "");

  if (core === "O-O" || core === "0-0") return `Castle kingside${check}`;
  if (core === "O-O-O" || core === "0-0-0") return `Castle queenside${check}`;

  const m = core.match(/^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([QRBN]))?$/);
  if (!m) return san;
  const [, piece, fromFile, fromRank, capture, dest, promo] = m;

  const parts: string[] = [];
  if (piece) {
    parts.push(PIECE_NAMES[piece]);
    const disambig = `${fromFile ?? ""}${fromRank ?? ""}`;
    if (disambig) parts.push(`${disambig.toUpperCase()},`);
  } else if (fromFile) {
    // pawn capture: "exd5"
    parts.push(fromFile.toUpperCase());
  }
  if (capture) parts.push("takes");
  parts.push(square(dest));

  let text = parts.join(" ");
  if (promo) text += `, promote to ${PIECE_NAMES[promo]}`;
  return text + check;
}

export function describeScore(scoreCp: number | undefined, mate: number | undefined): string {
  if (mate !== undefined) {
    return mate > 0 ? `Mate in ${mate}` : `Getting mated in ${-mate}`;
  }
  if (scoreCp === undefined) return "";
  const pawns = scoreCp / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

export type SpeakOptions = {
  voiceURI?: string;
  rate?: number;
  volume?: number;
};

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Speak text, cutting off whatever was being said before. */
export function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (!speechSupported()) return Promise.resolve();
  const synth = window.speechSynthesis;
  synth.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (opts.voiceURI) {
      const v = synth.getVoices().find((voice) => voice.voiceURI === opts.voiceURI);
      if (v) u.voice = v;
    }
    u.rate = opts.rate ?? 1;
    u.volume = opts.volume ?? 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}
