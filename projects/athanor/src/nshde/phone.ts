import { windowSize } from "nsh";

/**
 * DockArea presents docks as drawers and a sheet below 600 points of its own
 * width. The phone shell takes over at the same threshold, using the window
 * because the area is not mounted there.
 */
export const PHONE_BREAKPOINT = 600;

export function isPhoneWidth(): boolean {
  return windowSize().width < PHONE_BREAKPOINT;
}
