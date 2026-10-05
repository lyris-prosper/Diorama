"use client";
// The page language, Chinese or English. Every visible string is written in both, side by side:
// t("保存", "Save"). The choice is kept in this browser (a per-viewer convenience); the first visit
// follows the browser's language. The server renders Chinese, and the page switches right after
// hydration if this browser wants English (useSyncExternalStore handles the hand-over).
import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Lang = "zh" | "en";
export type T = (zh: string, en: string) => string;
/** A text in both languages, for tables of labels. */
export type Bi = { zh: string; en: string };

const KEY = "diorama.lang";
const listeners = new Set<() => void>();
let current: Lang | null = null;

function stored(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "zh" || v === "en") return v;
  } catch {}
  return typeof navigator !== "undefined" && navigator.language && !/^zh/i.test(navigator.language) ? "en" : "zh";
}
/** The language now, outside React (request headers, one-off messages). */
export function currentLang(): Lang {
  if (typeof window === "undefined") return "zh";
  return (current ??= stored());
}
export function setLang(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {}
  listeners.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};
export const pick = (lang: Lang): T => (zh, en) => (lang === "en" ? en : zh);
export const bi = (b: Bi | string | undefined, lang: Lang) => (b == null ? "" : typeof b === "string" ? b : b[lang]);

export function useLang() {
  const lang = useSyncExternalStore(subscribe, currentLang, () => "zh" as Lang);
  const t = useCallback<T>((zh, en) => (lang === "en" ? en : zh), [lang]);
  return { lang, setLang, t };
}

/** Keeps <html lang> and the tab title in the page's language. */
export function useDocumentLang(title: Bi) {
  const { lang } = useLang();
  useEffect(() => {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    document.title = title[lang];
  }, [lang, title]);
}
