// Messages for the person in both languages. `message` stays Chinese (logs, tests); `en` is shown
// when the page asks for English (the x-lang request header).
export type Lang = "zh" | "en";
export type Said = Error & { en?: string };
export function say(zh: string, en: string): Said {
  return Object.assign(new Error(zh), { en });
}
export const langOf = (req: Request): Lang => (req.headers.get("x-lang") === "en" ? "en" : "zh");
/** The error in the request's language; an error without an English text keeps its own. */
export function spoken(e: unknown, lang: Lang) {
  const err = e as Said | undefined;
  return lang === "en" && err?.en ? err.en : (err?.message ?? String(e));
}
/** Both texts of an error, for messages stored and shown later (a generation task's error). */
export const both = (e: unknown) => ({ zh: (e as Error)?.message ?? String(e), en: (e as Said)?.en ?? (e as Error)?.message ?? String(e) });
