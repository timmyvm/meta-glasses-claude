import { describe, expect, it } from "vitest";
import { cropScale } from "../src/lib/frames";

describe("cropScale", () => {
  it("enlarges tiny crops so the long side is 1024", () => {
    expect(cropScale(150, 350)).toBeCloseTo(1024 / 350);
  });
  it("leaves mid-size crops alone", () => {
    expect(cropScale(1280, 720)).toBe(1);
  });
  it("shrinks huge captures to 1920 on the long side", () => {
    expect(cropScale(3840, 2160)).toBe(0.5);
  });
});
