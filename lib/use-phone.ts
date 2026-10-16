"use client";
// Phones get their own home screen and a bottom sheet in the workbench (app/globals.css, ≤700px).
import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 700px)";
const subscribe = (f: () => void) => {
  const m = matchMedia(QUERY);
  m.addEventListener("change", f);
  return () => m.removeEventListener("change", f);
};
/** True on a phone-width screen, false otherwise; null while the page is rendered on the server. */
export const usePhone = () => useSyncExternalStore(subscribe, () => matchMedia(QUERY).matches, () => null);
