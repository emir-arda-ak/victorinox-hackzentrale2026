import type { Extraction } from "@/lib/agent/schema";
import type { LearnedRule } from "@/lib/agent/score";

/** Feedback + learned cross-reference rules.
 *  Storage: Redis via Upstash REST (Vercel Marketplace). Env: UPSTASH_REDIS_REST_URL/_TOKEN or KV_REST_API_URL/_TOKEN.
 *  Without Redis everything still works, but only in memory of the running server instance (not persistent). */

const URL_ = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
export const PERSISTENT = !!(URL_ && TOKEN);

const RULES_KEY = "pm:rules";
const FEEDBACK_KEY = "pm:feedback";
const memory: { rules: string[]; feedback: string[] } = { rules: [], feedback: [] };

async function redis(cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(URL_!, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Redis ${res.status}`);
  return ((await res.json()) as { result: unknown }).result;
}

async function push(key: string, value: string) {
  if (PERSISTENT) await redis(["LPUSH", key, value]);
  else (key === RULES_KEY ? memory.rules : memory.feedback).unshift(value);
}

async function range(key: string, n = 500): Promise<string[]> {
  if (PERSISTENT) return ((await redis(["LRANGE", key, 0, n - 1])) as string[]) ?? [];
  return (key === RULES_KEY ? memory.rules : memory.feedback).slice(0, n);
}

/** what identifies "the same knife" for a learned rule */
export function signature(ex: Extraction) {
  return {
    brand: ex.brand,
    model: ex.model_guess,
    category: ex.category,
    zone: ex.length_zone,
    tools: [...ex.tools_seen].sort(),
  };
}

export async function getLearnedRules(): Promise<LearnedRule[]> {
  try {
    const raw = await range(RULES_KEY);
    const agg = new Map<string, LearnedRule>();
    for (const r of raw) {
      const x = JSON.parse(r) as Omit<LearnedRule, "count">;
      const k = JSON.stringify([x.brand, x.model, x.category, x.zone, x.tools, x.victorinox_id]);
      const prev = agg.get(k);
      agg.set(k, prev ? { ...prev, count: prev.count + 1 } : { ...x, count: 1 });
    }
    return [...agg.values()];
  } catch (e) {
    console.error("learned rules unavailable", e);
    return [];
  }
}

export async function saveFeedback(ex: Extraction, suggested: string | null, chosen: string, correct: boolean) {
  const sig = signature(ex);
  const at = new Date().toISOString();
  await push(FEEDBACK_KEY, JSON.stringify({ at, suggested, chosen, correct, ...sig }));
  await push(RULES_KEY, JSON.stringify({ ...sig, victorinox_id: chosen, at }));
  return { persistent: PERSISTENT };
}

export async function listFeedback(n = 100) {
  return (await range(FEEDBACK_KEY, n)).map((r) => JSON.parse(r));
}
