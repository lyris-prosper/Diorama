// “帮我布置” on the server: DeepSeek picks the pieces and their places (lib/arrange.ts says what is
// asked and what is accepted); the rules answer whenever the model can't, so the button always works.
import { checkPlan, prompt, rulePlan, type Plan, type Spot } from "../arrange";
import { DEMO_ROOM } from "../demo-room";
import type { Lang } from "../i18n";
import type { Project } from "../types";
import { outbound } from "./outbound";
import { bindings } from "./storage";

const ENDPOINT = "https://api.deepseek.com/chat/completions";
/** A short JSON answer takes about 3 s; past this the rules answer instead. */
const TIMEOUT = 9000;

/** The hand-set places of the room, when it is a known one, without those a piece already stands on. */
function spotsOf(p: Project): { spots: Spot[] | null; taken: Set<string>; room: string } {
  if (p.room?.preset !== DEMO_ROOM.id)
    return { spots: null, taken: new Set(), room: "a real room scanned from one photo; the pieces go where the zone says." };
  const placed = p.items.filter((i) => i.status === "placed");
  const taken = new Set(
    DEMO_ROOM.spots.filter((s) => placed.some((i) => Math.hypot(i.position[0] - s.position[0], i.position[2] - s.position[2]) < 0.35 && Math.abs(i.position[1] - s.position[1]) < 0.3)).map((s) => s.id),
  );
  return { spots: DEMO_ROOM.spots, taken, room: DEMO_ROOM.description };
}

async function ask(messages: ReturnType<typeof prompt>, key: string, model: string) {
  const res = await outbound(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    // Thinking off: the flash model otherwise spends its tokens (and seconds) reasoning first.
    body: JSON.stringify({ model, messages, response_format: { type: "json_object" }, thinking: { type: "disabled" }, max_tokens: 900, temperature: 0.5, stream: false }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return JSON.parse(j.choices?.[0]?.message?.content || "null");
}

/** A plan for this sentence in this room; never throws for the model's sake. */
export async function planLayout(p: Project, sentence: string, lang: Lang): Promise<Plan> {
  const { spots, taken, room } = spotsOf(p);
  const free = spots?.filter((s) => !taken.has(s.id)) ?? null;
  const secrets = bindings().secrets as Record<string, string | undefined>;
  const key = secrets.DEEPSEEK_API_KEY;
  if (key && free?.length !== 0)
    try {
      const plan = checkPlan(await ask(prompt(sentence, free, lang, room), key, secrets.DEEPSEEK_MODEL || "deepseek-flash"), sentence, free);
      if (plan) return plan;
    } catch (e) {
      console.warn("Arrange: DeepSeek unavailable, using the rules:", (e as Error).message);
    }
  return rulePlan(sentence, free, lang);
}
