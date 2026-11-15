import { describe, expect, it } from "vitest";
import { describeScore, sanToSpeech } from "../src/lib/speech";

describe("sanToSpeech", () => {
  it.each([
    ["e4", "E4"],
    ["Nf3", "Knight F3"],
    ["exd5", "E takes D5"],
    ["Bxe7+", "Bishop takes E7, check"],
    ["Nbd2", "Knight B, D2"],
    ["R1e2", "Rook 1, E2"],
    ["Qh4xe1#", "Queen H4, takes E1, checkmate"],
    ["O-O", "Castle kingside"],
    ["O-O-O+", "Castle queenside, check"],
    ["e8=Q", "E8, promote to Queen"],
    ["dxc1=N+", "D takes C1, promote to Knight, check"],
  ])("%s -> %s", (san, spoken) => {
    expect(sanToSpeech(san)).toBe(spoken);
  });
});

describe("describeScore", () => {
  it("formats centipawns and mates", () => {
    expect(describeScore(34, undefined)).toBe("+0.3");
    expect(describeScore(-150, undefined)).toBe("-1.5");
    expect(describeScore(undefined, 3)).toBe("Mate in 3");
    expect(describeScore(undefined, -2)).toBe("Getting mated in 2");
  });
});
