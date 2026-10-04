// Inject providers. Canned (YAML timeline) always works. The LLM variant layer
// rewrites report wording for freshness — same facts, schedule, routing, targets.
// Server-side only; any failure (no key, timeout, bad JSON, exhausted credits)
// falls back to canned silently. Variants are cosmetic: the recorded event log
// stays the replay source of truth, and each inject is tagged with its provider.
import type { InjectDef } from "../shared/types.js";

export interface InjectProvider {
  /** Injects with t <= uptoT that have not been returned before. */
  due(uptoT: number): InjectDef[];
}

export class CannedProvider implements InjectProvider {
  private cursor = 0;
  constructor(private readonly injects: InjectDef[]) {}
  due(uptoT: number): InjectDef[] {
    const out: InjectDef[] = [];
    while (this.cursor < this.injects.length && this.injects[this.cursor].t <= uptoT) {
      out.push(this.injects[this.cursor]);
      this.cursor += 1;
    }
    return out;
  }
}

export interface LlmOpts {
  baseUrl: string;
  apiKey: string;
  model: string;
  scenario: string;
}

const SYSTEM = [
  "You are an EXCON scriptwriter for a staff-college communications-degradation exercise.",
  'Rewrite each report "text" as terse military radio / staff language: same facts, same meaning, different wording.',
  "Keep every callsign, place name, number and asset id EXACT — change only phrasing.",
  'Return JSON only: {"variants": ["...", ...]} with exactly one string per input report, in the same order.',
].join(" ");

export class LlmVariantProvider implements InjectProvider {
  private filling = false;
  private disabledUntil = 0;
  private variants = new Map<string, string>();
  private loggedFallback = false;

  constructor(
    private readonly fallback: CannedProvider,
    all: InjectDef[],
    private readonly opts: LlmOpts,
  ) {
    // Prefetch at run start: variants are ready long before the first report fires.
    void this.fill(all.filter((i) => i.type === "report" && typeof i.payload?.text === "string"));
  }

  private keyOf(inj: InjectDef): string {
    return `${this.opts.scenario}|${inj.t}|${inj.type}|${inj.from ?? ""}|${inj.to ?? ""}|${String(inj.payload?.text ?? "").slice(0, 40)}`;
  }

  due(uptoT: number): InjectDef[] {
    return this.fallback.due(uptoT).map((c) => {
      const v = this.variants.get(this.keyOf(c));
      if (v === undefined) return c;
      return {
        ...c,
        provider: "llm" as const,
        payload: { ...c.payload, text: v, originalText: c.payload.text },
      };
    });
  }

  private async fill(items: InjectDef[]): Promise<void> {
    if (!items.length || Date.now() < this.disabledUntil || this.filling) return;
    this.filling = true;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      let res: Response;
      try {
        res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
          body: JSON.stringify({
            model: this.opts.model,
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: JSON.stringify({ reports: items.map((r) => ({ text: r.payload.text })) }) },
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
            max_tokens: 600,
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as any;
      const text: string = body.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.variants) || parsed.variants.length !== items.length) {
        throw new Error("variant shape mismatch");
      }
      items.forEach((item, i) => {
        const s = String(parsed.variants[i] ?? "").trim();
        if (s) this.variants.set(this.keyOf(item), s);
      });
      console.log(`[injects] llm variants ready (${items.length} reports, ${this.opts.model})`);
    } catch (e) {
      // Cooldown, then retry on the next run — canned carries this one.
      this.disabledUntil = Date.now() + 5 * 60 * 1000;
      if (!this.loggedFallback) {
        this.loggedFallback = true;
        console.warn(`[injects] LLM unavailable (${(e as Error).message}) — canned injects only`);
      }
    } finally {
      this.filling = false;
    }
  }
}
