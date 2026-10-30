import { describe, expect, it } from "vitest";
import { buildStepChart } from "./chart";

describe("buildStepChart", () => {
  const box = { width: 116, height: 56, padding: 8 }; // inner area 100 × 40

  it("returns null without points", () => {
    expect(buildStepChart([], box)).toBeNull();
  });

  it("draws a step line scaled to the box", () => {
    const chart = buildStepChart(
      [
        { t: 0, v: 100 },
        { t: 50, v: 80 },
      ],
      { ...box, endT: 100 },
    );
    expect(chart).toEqual({ path: "M 8 8 H 58 V 48 H 108", min: 80, max: 100 });
  });

  it("sorts points by time", () => {
    const a = buildStepChart(
      [
        { t: 10, v: 1 },
        { t: 0, v: 2 },
      ],
      box,
    );
    const b = buildStepChart(
      [
        { t: 0, v: 2 },
        { t: 10, v: 1 },
      ],
      box,
    );
    expect(a).toEqual(b);
  });

  it("draws a flat line through the middle for a constant price or a single point", () => {
    expect(
      buildStepChart(
        [
          { t: 0, v: 5 },
          { t: 10, v: 5 },
        ],
        box,
      )?.path,
    ).toBe("M 8 28 H 108 V 28 H 108");
    expect(buildStepChart([{ t: 0, v: 5 }], box)?.path).toBe("M 8 28 H 108");
  });

  it("never ends before the last point", () => {
    expect(
      buildStepChart(
        [
          { t: 0, v: 1 },
          { t: 10, v: 2 },
        ],
        { ...box, endT: 5 },
      )?.path,
    ).toBe("M 8 48 H 108 V 8 H 108");
  });

  it("uses 8px padding by default", () => {
    expect(buildStepChart([{ t: 0, v: 5 }], { width: 116, height: 56 })?.path).toBe("M 8 28 H 108");
  });
});
