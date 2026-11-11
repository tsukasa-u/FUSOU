import { describe, expect, it } from "vitest";
import {
  canScrollHorizontally,
  getHorizontalWheelDelta,
  normalizeWheelDeltaY,
  scrollElementHorizontally,
} from "./scroll";

describe("scroll utilities", () => {
  it("detects whether an element can scroll horizontally", () => {
    expect(
      canScrollHorizontally({
        scrollWidth: 1000,
        clientWidth: 400,
      } as HTMLElement),
    ).toBe(true);
    expect(
      canScrollHorizontally({
        scrollWidth: 400,
        clientWidth: 400,
      } as HTMLElement),
    ).toBe(false);
    expect(canScrollHorizontally(null)).toBe(false);
  });
  it("normalizes pixel, line, and page wheel deltaY modes", () => {
    expect(
      normalizeWheelDeltaY({ deltaY: 120, deltaMode: 0 } as WheelEvent),
    ).toBe(120);
    expect(
      normalizeWheelDeltaY({ deltaY: 3, deltaMode: 1 } as WheelEvent),
    ).toBe(120);
    expect(
      normalizeWheelDeltaY({ deltaY: -1, deltaMode: 2 } as WheelEvent),
    ).toBe(-320);
    expect(
      getHorizontalWheelDelta({
        deltaX: 80,
        deltaY: 10,
        deltaMode: 0,
      } as WheelEvent),
    ).toBe(80);
    expect(
      getHorizontalWheelDelta({
        deltaX: 0,
        deltaY: 120,
        deltaMode: 0,
      } as WheelEvent),
    ).toBe(120);
  });

  it("scrolls horizontally and clamps within [0, scrollWidth - clientWidth]", () => {
    const el = {
      scrollLeft: 0,
      scrollWidth: 1000,
      clientWidth: 400,
    } as unknown as HTMLElement;

    expect(scrollElementHorizontally(el, -100)).toBe(false);
    expect(el.scrollLeft).toBe(0);

    expect(scrollElementHorizontally(el, 160)).toBe(true);
    expect(el.scrollLeft).toBe(160);

    expect(scrollElementHorizontally(el, 1000)).toBe(true);
    expect(el.scrollLeft).toBe(600);

    expect(scrollElementHorizontally(el, 100)).toBe(false);
    expect(el.scrollLeft).toBe(600);

    expect(scrollElementHorizontally(el, -200)).toBe(true);
    expect(el.scrollLeft).toBe(400);
  });

  it("returns false when container does not overflow", () => {
    const el = {
      scrollLeft: 0,
      scrollWidth: 400,
      clientWidth: 400,
    } as unknown as HTMLElement;

    expect(scrollElementHorizontally(el, 120)).toBe(false);
  });
});
