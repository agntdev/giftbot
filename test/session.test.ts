import { describe, expect, it } from "vitest";
import { MemorySessionStorage } from "../src/toolkit/session/memory";

describe("MemorySessionStorage", () => {
  it("reads back what was written", () => {
    const s = new MemorySessionStorage<{ n: number }>();
    expect(s.read("u1")).toBeUndefined();
    s.write("u1", { n: 5 });
    expect(s.read("u1")).toEqual({ n: 5 });
  });

  it("deletes a key", () => {
    const s = new MemorySessionStorage<number>();
    s.write("k", 1);
    s.delete("k");
    expect(s.read("k")).toBeUndefined();
  });
});
