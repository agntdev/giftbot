// The single clock seam for giveaway eligibility and event timestamps.
let clock: () => number = () => Date.now();

export function now(): number {
  return clock();
}

/** Test hook. Application code must use now(), never Date.now() directly. */
export function setClockForTests(next?: () => number): void {
  clock = next ?? (() => Date.now());
}
