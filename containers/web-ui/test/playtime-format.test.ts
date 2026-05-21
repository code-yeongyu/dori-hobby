import { describe, expect, it } from "vitest";

import { formatPlaytime } from "../src/client/lib/playtime-format.js";

describe("formatPlaytime", () => {
  it("formats zero seconds as 0h 00m", () => {
    expect(formatPlaytime(0)).toBe("0h 00m");
  });

  it("formats 3661 seconds as 1h 01m", () => {
    expect(formatPlaytime(3_661)).toBe("1h 01m");
  });

  it("clamps negative input to 0h 00m", () => {
    expect(formatPlaytime(-30)).toBe("0h 00m");
  });
});
