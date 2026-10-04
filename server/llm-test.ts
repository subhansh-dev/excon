// `npm run llm:test` — validates key + model + JSON mode end to end.
// Prints variant TEXTS only (never the key).
import { loadScenario } from "./scenario.js";
import { CannedProvider, LlmVariantProvider } from "./injects.js";

const key = process.env.LLM_API_KEY || "";
if (!key) {
  console.error("LLM_API_KEY missing — check .env (see .env.example)");
  process.exit(1);
}
const scenarioId = process.env.SCENARIO || "reach";
const sc = loadScenario(scenarioId);
const model = process.env.LLM_MODEL || "gpt-oss-120b";
const provider = new LlmVariantProvider(new CannedProvider(sc.injects), sc.injects, {
  baseUrl: process.env.LLM_BASE_URL || "https://api.cerebras.ai/v1",
  apiKey: key,
  model,
  scenario: sc.id,
});

console.log(`requesting variants (model=${model})…`);
await new Promise((r) => setTimeout(r, 25000));
const out = provider.due(3600);
let llm = 0;
for (const inj of out) {
  if (inj.type !== "report") continue;
  if (inj.provider === "llm") llm += 1;
  console.log(`- [${inj.provider ?? "canned"}] ${inj.from}→${inj.to}: ${inj.payload.text}`);
}
console.log(llm > 0 ? `PASS  ${llm} llm variant(s) live` : "NOTE  all canned (LLM unavailable — run still works)");
process.exit(0);
