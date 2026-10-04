/**
 * Self-contained AAR dossier builder — one HTML file, zero external assets.
 * Every payload field lands somewhere on the page (including the ones the live
 * view does not render as widgets yet: probes, calibration, asymmetry, audit,
 * timeline). Opens in any browser and prints clean to PDF via @page rules.
 */

type Any = any;

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const pct = (x: unknown) => Math.round(Number(x ?? 0) * 100);
const f1 = (n: unknown) => (n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toFixed(1));
const f3 = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? "—" : n.toFixed(3));
const signed = (n: unknown, d: number) =>
  n == null || Number.isNaN(Number(n)) ? "—" : `${Number(n) >= 0 ? "+" : ""}${Number(n).toFixed(d)}`;

const COLORS = ["#9e6f18", "#287834", "#ba6d12", "#b82839", "#1c5b88", "#5c6b73"];

const CSS = `
:root{
  --bg:#f3efe6; --panel:#fbf8f1; --deep:#eee9dc; --line:#e0d9c8; --line-hi:#cdc4ad;
  --ink:#2a2517; --muted:#7a7263; --accent:#9e6f18; --accent-hi:#7c5513;
  --ok:#287834; --warn:#ba6d12; --danger:#b82839; --info:#1c5b88;
  --sans:"Barlow",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  --mono:"IBM Plex Mono","SF Mono","Cascadia Code",Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:13.5px;line-height:1.5}
.doc{max-width:1080px;margin:0 auto;padding:28px 26px 60px}
.head{border-bottom:3px double var(--line-hi);padding-bottom:14px;margin-bottom:18px}
.kicker{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;color:var(--accent);text-transform:uppercase}
h1{font-size:27px;letter-spacing:.04em;text-transform:uppercase;margin:6px 0 10px;font-weight:800}
.meta{display:flex;flex-wrap:wrap;gap:6px 22px;font-family:var(--mono);font-size:11px;color:var(--muted)}
.meta b{color:var(--ink)}
h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 10px;padding-left:9px;border-left:4px solid var(--accent);font-weight:800}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 16px;box-shadow:0 1px 0 #fff inset,0 2px 6px rgba(60,50,30,.05)}
.alert{border-left:4px solid var(--danger);background:#fff5f5}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.card{background:var(--deep);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.card .v{font-family:var(--mono);font-size:26px;font-weight:700;letter-spacing:-.02em}
.card .l{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-top:2px}
.card .s{font-size:11px;color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:12px;background:var(--panel)}
th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
th{background:var(--deep);font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
td.num,th.num{text-align:right;font-family:var(--mono)}
td.mono{font-family:var(--mono)}
.ok{color:var(--ok);font-weight:700}
.bad{color:var(--danger);font-weight:700}
.unk{color:var(--muted)}
.chip{display:inline-block;font-family:var(--mono);font-size:10px;padding:1px 7px;border:1px solid var(--line-hi);border-radius:99px;background:var(--deep);margin-right:6px}
.chart{background:var(--deep);border:1px solid var(--line);border-radius:8px;padding:10px}
.legend{margin-top:6px;font-family:var(--mono);font-size:10.5px}
.legend i{display:inline-block;width:18px;height:3px;vertical-align:middle;margin:0 5px 2px 10px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
ul.notes{margin:4px 0 0 18px;padding:0}
ul.notes li{margin:3px 0}
.block h3{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-hi);margin:0 0 4px}
.flag{padding:6px 10px;border-left:3px solid var(--accent);background:var(--deep);border-radius:4px;margin:6px 0;font-size:12.5px}
.rat{font-style:italic;color:#4a4436}
.muted{color:var(--muted)}
.prose{font-size:13px;color:#4a4436}
textarea.dossier{width:100%;min-height:90px;background:var(--deep);border:1px solid var(--line-hi);border-radius:6px;padding:10px;font-family:var(--sans);font-size:13px;color:var(--ink);resize:vertical}
footer{margin-top:26px;border-top:1px solid var(--line-hi);padding-top:10px;font-family:var(--mono);font-size:10.5px;color:var(--muted)}
@media print{
  @page{margin:12mm}
  body{background:#fff}
  .doc{max-width:none;padding:0}
  .panel{break-inside:avoid;box-shadow:none;background:#fff}
  .cards{break-inside:avoid}
  table{break-inside:auto}
  tr{break-inside:avoid}
  thead{display:table-header-group}
  h2{break-after:avoid}
}
`;

function table(head: string, rows: string): string {
  if (!rows) return "";
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function buildAarHtml(aar: Any, cf: Any, cfMode: string, notes: string): string {
  const h = aar?.header ?? {};
  const seats: string[] = h.seats ?? [];
  const scores = aar?.scores ?? null;
  const narrative = aar?.narrative ?? {};
  const flags: string[] = aar?.flags ?? [];
  const decisions: Any[] = aar?.decisions ?? [];
  const perSeat: Any[] = aar?.perSeat ?? [];
  const probes: Any[] = aar?.probes ?? [];
  const cast: Any[] = aar?.cast ?? [];
  const calib = aar?.calibration ?? {};
  const asymmetry: Any[] = aar?.asymmetry ?? [];
  const entities: Any[] = aar?.entities ?? [];
  const audit = aar?.audit ?? null;
  const timeline: Any[] = aar?.timeline ?? [];
  const series = aar?.iisSeries ?? {};
  const out: string[] = [];

  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const runId = h.runId ?? "—";

  out.push(`<!doctype html><html lang="en"><head><meta charset="utf-8">`);
  out.push(`<meta name="viewport" content="width=device-width,initial-scale=1">`);
  out.push(`<title>AFTER-ACTION REPORT · ${esc(h.scenario)} · ${esc(runId)}</title>`);
  out.push(`<style>${CSS}</style></head><body><div class="doc">`);

  // ---- Header ----
  out.push(`<header class="head">
<div class="kicker">DSSC Multi-Domain Trainer · Exercise Dossier</div>
<h1>After-Action Report — ${esc(String(h.scenario ?? "").toUpperCase())}</h1>
<div class="meta">
<span>RUN <b>${esc(runId)}</b></span>
<span>SEED <b>${esc(h.seed)}</b></span>
<span>STARTED <b>${esc(h.startedAt ?? "—")}</b></span>
<span>SEATS <b>${esc(seats.join(" · "))}</b></span>
<span>GENERATED <b>${stamp}</b></span>
</div></header>`);

  if (h.deceptionObjective) {
    out.push(`<div class="panel alert"><h2>Red Team Deception Vector &amp; Intent</h2><p class="prose" style="margin:0;color:#7f1d1d">${esc(h.deceptionObjective)}</p></div>`);
  }

  // ---- Score matrix ----
  if (scores) {
    out.push(`<div class="panel"><h2>Exercise Performance Indicators — Score Matrix</h2><div class="cards">`);
    out.push(`<div class="card"><div class="v">${esc(scores.adaptation)}</div><div class="l">Adaptation Score</div><div class="s">40–95 doctrinal scale</div></div>`);
    out.push(`<div class="card"><div class="v">${esc(scores.verificationRate)}%</div><div class="l">Verification Rate</div><div class="s">of committed orders</div></div>`);
    out.push(`<div class="card"><div class="v">${Math.round(scores.resilience?.deliveredRate ?? 0)}%</div><div class="l">Net Resilience</div><div class="s">${esc(scores.resilience?.tier ?? "—")} tier</div></div>`);
    out.push(`<div class="card"><div class="v">${esc(scores.contradictionAwareness)}%</div><div class="l">Contradiction Detect</div><div class="s">of decision points</div></div>`);
    out.push(`<div class="card"><div class="v">${esc(scores.uncertaintyBudget)}</div><div class="l">Uncertainty Budget</div><div class="s">${esc(scores.budgetBand)} band</div></div>`);
    out.push(`</div><p class="muted" style="font-size:11.5px;margin:10px 0 0">${esc(scores.disclaimer ?? "Performance indicators reflect cognitive and procedural agility under synthetic warfare degradation.")}</p></div>`);
  }

  // ---- Counterfactual ----
  if (cf) {
    const modeLabel = cfMode === "clean_links" ? "Pristine links baseline" : "Suppress adversary spoofs";
    out.push(`<div class="panel"><h2>Counterfactual Decision Re-Evaluation — ${esc(modeLabel)}</h2>`);
    const rows: string[] = [];
    const act = cf.actual ?? {};
    const ctr = cf.counterfactual ?? {};
    const d = cf.delta ?? {};
    if (cfMode === "clean_links") {
      rows.push(`<tr><td>Picture fidelity — IIS team mean</td><td class="num">${f3(act.iis?.teamMean)}</td><td class="num">${f3(ctr.iis?.teamMean)}</td><td class="num">${signed(d.iis?.teamMean, 3)}</td></tr>`);
      rows.push(`<tr><td>Mean OODA latency (s)</td><td class="num">${f1(act.ooda?.meanS)}</td><td class="num">${f1(ctr.ooda?.meanS)}</td><td class="num">${signed(d.ooda?.meanS, 1)}</td></tr>`);
    } else {
      rows.push(`<tr><td>Conflicted decisions</td><td class="num">${act.conflictedDecisions?.n ?? 0} / ${act.conflictedDecisions?.total ?? 0}</td><td class="num">${ctr.conflictedDecisions?.n ?? 0} / ${ctr.conflictedDecisions?.total ?? 0}</td><td class="num">${signed(d.conflictedDecisions, 0)}</td></tr>`);
      rows.push(`<tr><td>Hot-picture burden (team mean)</td><td class="num">${f1(act.hotBurden?.teamMean)}</td><td class="num">${f1(ctr.hotBurden?.teamMean)}</td><td class="num">${signed(d.hotBurden?.teamMean, 2)}</td></tr>`);
      rows.push(`<tr><td>Uncertainty budget</td><td class="num">${esc(act.uncertaintyBudget ?? "—")}</td><td class="num">${esc(ctr.uncertaintyBudget ?? "—")}</td><td class="num">${signed(d.uncertaintyBudget, 1)}</td></tr>`);
      rows.push(`<tr><td>Spoof-attributable hot ids removed</td><td class="num">—</td><td class="num">—</td><td class="num">${esc(d.spoofAttributableHotIds ?? 0)}</td></tr>`);
    }
    out.push(table(`<th>Metric</th><th class="num">Recorded Run</th><th class="num">Counterfactual</th><th class="num">Delta</th>`, rows.join("")));
    out.push(`<p class="prose" style="margin:10px 0 0">${esc(cf.narrative ?? "")}</p>`);
    out.push(`<p class="muted" style="font-size:11px;margin:4px 0 0">Basis: ${esc(cf.basis)} · confidence: ${esc(cf.confidence)}</p>`);
    if ((cf.variables ?? []).length) {
      out.push(`<ul class="notes muted" style="font-size:11.5px">${cf.variables.map((v: Any) => `<li><b>${esc(v.label)}:</b> ${esc(v.value)}</li>`).join("")}</ul>`);
    }
    out.push(`</div>`);
  }

  // ---- Per-seat ----
  if (perSeat.length) {
    const rows = perSeat.map((p: Any) =>
      `<tr><td class="mono"><b>${esc(String(p.seat).toUpperCase())}</b></td><td class="num">${esc(p.decisions)}</td><td class="num">${esc(p.accuracy)}</td><td class="num">${esc(p.meanConfidence)}</td><td class="num">${esc(p.oodaMean)}s</td><td class="num">${esc(p.rationaleWords)}</td><td class="num">${esc(p.responses)}</td><td class="num">${esc(p.discipline?.sent ?? 0)}</td><td class="num">${esc(p.discipline?.dropped ?? 0)}</td><td class="num">${esc(p.discipline?.verifications ?? 0)}</td></tr>`,
    ).join("");
    out.push(`<div class="panel"><h2>Per-Appointment Performance Metrics</h2>${table(
      `<th>Appointment</th><th class="num">Decisions</th><th class="num">Accuracy</th><th class="num">Mean Conf</th><th class="num">OODA Mean</th><th class="num">Rationale Words</th><th class="num">Responses</th><th class="num">Sent</th><th class="num">Dropped</th><th class="num">Verifications</th>`,
      rows,
    )}</div>`);
  }

  // ---- Decision table (verbatim rationale) ----
  if (decisions.length) {
    const rows = decisions.map((d: Any) =>
      `<tr><td class="num">${Math.round(d.t)}s</td><td class="mono"><b>${esc(String(d.seat).toUpperCase())}</b></td><td class="mono">${esc(d.decisionId)}</td><td><b>${esc(d.choice)}</b></td><td class="${d.correct ? "ok" : "bad"}">${d.correct ? "✓ OPTIMAL" : "✗ MISLEADING"}</td><td class="num">${esc(d.ooda_latency_s)}s</td><td class="num">${pct(d.confidence)}%</td><td class="rat">“${esc(d.rationale)}”</td></tr>`,
    ).join("");
    out.push(`<div class="panel"><h2>Decision Table (Verbatim Rationale at Commitment Time)</h2>${table(
      `<th class="num">Time</th><th>Seat</th><th>Decision ID</th><th>Choice</th><th>Correct</th><th class="num">OODA</th><th class="num">Conf</th><th>Operational Rationale</th>`,
      rows,
    )}</div>`);
  }

  // ---- Probes (SAGAT freezes) ----
  if (probes.length) {
    const rows = probes.map((p: Any) =>
      `<tr><td class="mono"><b>${esc(String(p.seat ?? "").toUpperCase())}</b></td><td class="mono">${esc(p.freezeId)}</td><td class="num"><b>${esc(p.score)} / ${esc(p.total)}</b></td><td>${(p.answers ?? []).map((a: Any) =>
        `<div class="muted" style="font-size:11.5px"><span class="${a.hit ? "ok" : "bad"}">${a.hit ? "✓" : "✗"}</span> <span class="mono">${esc(a.queryId)}</span> — answered “${esc(a.answer)}”${a.correct ? ` (correct: “${esc(a.correct)}”)` : ""}</div>`,
      ).join("")}</td></tr>`,
    ).join("");
    const hit = probes.reduce((s: number, p: Any) => s + (p.score ?? 0), 0);
    const tot = probes.reduce((s: number, p: Any) => s + (p.total ?? 0), 0);
    out.push(`<div class="panel"><h2>Situational Awareness Probes — ${tot ? pct(hit / tot) : 0}% Team Accuracy Across ${probes.length} Freeze${probes.length === 1 ? "" : "s"}</h2>${table(
      `<th>Seat</th><th>Freeze</th><th class="num">Score</th><th>Answers</th>`,
      rows,
    )}</div>`);
  }

  // ---- Calibration ----
  const calibRows = Object.entries(calib).filter(([, c]: any) => (c?.n ?? 0) > 0);
  if (calibRows.length) {
    const rows = calibRows.map(([seat, c]: any) =>
      `<tr><td class="mono"><b>${esc(seat.toUpperCase())}</b></td><td class="num">${esc(c.n)}</td><td class="num">${pct(c.meanConf)}%</td><td class="num">${pct(c.accuracy)}%</td><td class="num ${c.divergence > 0.3 ? "bad" : "ok"}">${signed(c.divergence, 3)}</td><td class="num">${c.brier != null ? esc(c.brier) : "—"}</td></tr>`,
    ).join("");
    const overall = aar?.brier != null ? `<p class="muted" style="font-size:11px;margin:8px 0 0">Team Brier score: <b>${esc(aar.brier)}</b> (0 = perfect confidence, 0.25 = coin flip — lower is better).</p>` : "";
    out.push(`<div class="panel"><h2>Confidence Calibration — Certain-and-Wrong Detector</h2>${table(
      `<th>Seat</th><th class="num">Decisions</th><th class="num">Mean Confidence</th><th class="num">Accuracy</th><th class="num">Divergence (conf − acc)</th><th class="num">Brier ↓</th>`,
      rows,
    )}<p class="muted" style="font-size:11px;margin:8px 0 0">Divergence above +0.30 means the seat trusted itself far beyond what the ground truth rewarded.</p>${overall}</div>`);
  }

  // ---- NASA-TLX workload ----
  const tlxRows = Object.entries(aar?.tlx ?? {});
  if (tlxRows.length) {
    const rows = tlxRows.map(([seat, r]: any) =>
      `<tr><td class="mono"><b>${esc(seat.toUpperCase())}</b></td><td class="num">${esc(r.mental)}</td><td class="num">${esc(r.physical)}</td><td class="num">${esc(r.temporal)}</td><td class="num">${esc(r.performance)}</td><td class="num">${esc(r.effort)}</td><td class="num">${esc(r.frustration)}</td><td class="num"><b>${esc(r.avg)}</b></td></tr>`,
    ).join("");
    out.push(`<div class="panel"><h2>NASA-TLX Post-Exercise Workload (0–100, lower = less strain)</h2>${table(
      `<th>Seat</th><th class="num">Mental</th><th class="num">Physical</th><th class="num">Temporal</th><th class="num">Performance</th><th class="num">Effort</th><th class="num">Frustration</th><th class="num">Mean</th>`,
      rows,
    )}</div>`);
  }

  // ---- CAST ----
  if (cast.length) {
    const rows = cast.map((c: Any) =>
      `<tr><td class="num">${Math.round(c.t)}s</td><td>${c.noticed ? "✓" : "—"}</td><td>${c.discussed ? "✓" : "—"}</td><td>${c.circumvented ? "✓" : "—"}</td><td>${c.overcame ? "✓" : "—"}</td><td class="num"><b>${esc(c.score)}/4</b></td></tr>`,
    ).join("");
    out.push(`<div class="panel"><h2>CAST — Adaptation Under Stress (/4)</h2>${table(
      `<th class="num">Time</th><th>Noticed</th><th>Discussed</th><th>Circumvented</th><th>Overcame</th><th class="num">Score</th>`,
      rows,
    )}</div>`);
  }

  // ---- Asymmetry matrix ----
  if (asymmetry.length && entities.length) {
    const head = `<th>Seat</th>${entities.map((e: Any) => `<th title="${esc(e.id)} (${esc(e.kind)})">${esc(e.label)}</th>`).join("")}`;
    const rows = asymmetry.map((a: Any) =>
      `<tr><td class="mono"><b>${esc(String(a.seat).toUpperCase())}</b></td>${entities.map((e: Any) => {
        const v = a.cells?.[e.id] ?? "?";
        const cls = v === "✓" ? "ok" : v === "✗" ? "bad" : "unk";
        return `<td class="num ${cls}">${esc(v)}</td>`;
      }).join("")}</tr>`,
    ).join("");
    out.push(`<div class="panel"><h2>Information Asymmetry Matrix — Final Seat Picture vs Truth</h2>${table(head, rows)}<p class="muted" style="font-size:11px;margin:8px 0 0">✓ matches truth · ✗ diverged (status or position beyond 15 m) · ? never observed. Hidden OPFOR excluded — a seat cannot report what it was never given.</p></div>`);
  }

  // ---- IIS chart ----
  const tMax = Math.max(1, ...Object.values(series).flatMap((s: any) => (s ?? []).map((p: any) => p.t)));
  const W = 680, H = 190;
  const iisPath = (pts: any[]) => pts.map((p, i) => `${i ? "L" : "M"}${((p.t / tMax) * W).toFixed(1)},${(H - p.iis * H).toFixed(1)}`).join(" ");
  const hasIis = seats.some((s) => (series[s] ?? []).length > 1);
  if (hasIis) {
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">`;
    [0.25, 0.5, 0.75].forEach((g) => { svg += `<line x1="0" x2="${W}" y1="${H - g * H}" y2="${H - g * H}" stroke="rgba(135,120,95,.25)" stroke-width="1"/>`; });
    (aar.injects ?? []).forEach((inj: Any, i: number) => {
      const x = (inj.t / tMax) * W;
      svg += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${H}" stroke="#9e6f18" stroke-width="1.5" stroke-dasharray="4 3" opacity=".85"/>`;
      svg += `<text x="${(x + 4).toFixed(1)}" y="${12 + (i % 3) * 11}" fill="#7c5513" font-size="9.5" font-family="monospace">${esc(inj.label)}</text>`;
    });
    seats.forEach((s, i) => { svg += `<path d="${iisPath(series[s] ?? [])}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="2.5"/>`; });
    svg += `</svg>`;
    const legend = seats.map((s, i) => `<i style="background:${COLORS[i % COLORS.length]}"></i>${esc(s.toUpperCase())}`).join("");
    out.push(`<div class="panel"><h2>Information Integrity Score (IIS) Timeline Curves</h2><div class="chart">${svg}<div class="legend">${legend}</div></div></div>`);
  }

  // ---- Confidence-vs-accuracy divergence chart ----
  if (decisions.length) {
    const bySeat = new Map<string, { t: number; div: number }[]>();
    const run = new Map<string, { c: number; k: number; n: number }>();
    [...decisions].sort((a, b) => a.t - b.t).forEach((d) => {
      const s = run.get(d.seat) ?? { c: 0, k: 0, n: 0 };
      s.n += 1; s.c += Number(d.confidence ?? 0); s.k += d.correct ? 1 : 0;
      run.set(d.seat, s);
      const arr = bySeat.get(d.seat) ?? [];
      arr.push({ t: d.t, div: s.c / s.n - s.k / s.n });
      bySeat.set(d.seat, arr);
    });
    const dMaxT = Math.max(1, ...[...bySeat.values()].flat().map((p) => p.t));
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">`;
    svg += `<rect x="0" y="0" width="${W}" height="${H / 2}" fill="rgba(184,40,57,.07)"/>`;
    svg += `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="rgba(135,120,95,.45)" stroke-width="1.5"/>`;
    svg += `<text x="6" y="13" font-size="9.5" font-family="monospace" fill="#b82839" font-weight="700">OVERCONFIDENT / SPOOF DRIFT ↑</text>`;
    svg += `<text x="6" y="${H - 6}" font-size="9.5" font-family="monospace" fill="#7a7263">CALIBRATED ACCURACY ↓</text>`;
    let li = 0;
    for (const [seat, pts] of bySeat) {
      const color = COLORS[seats.indexOf(seat) >= 0 ? seats.indexOf(seat) : li % COLORS.length];
      li += 1;
      svg += `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${((p.t / dMaxT) * (W - 8) + 4).toFixed(1)},${(H / 2 - p.div * (H / 2 - 14)).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2"/>`;
    }
    svg += `</svg>`;
    out.push(`<div class="panel"><h2>Running Confidence vs Accuracy (Divergence)</h2><div class="chart">${svg}<div class="legend muted" style="font-size:11px">Each line is a seat’s cumulative mean confidence minus its cumulative accuracy. Above zero = certain-and-wrong drift.</div></div></div>`);
  }

  // ---- Flags + narrative ----
  if (flags.length) {
    out.push(`<div class="panel"><h2>Critical Debrief Moments (Auto-Flagged)</h2>${flags.map((f) => `<div class="flag">${esc(f)}</div>`).join("")}</div>`);
  }
  const blocks: [string, string[]][] = [
    ["Observed Strengths", narrative.strengths ?? []],
    ["Observed Challenges", narrative.challenges ?? []],
    ["Decision Patterns", narrative.patterns ?? []],
    ["Recommended Training Focus", narrative.focus ?? []],
  ];
  if (blocks.some(([, items]) => items.length)) {
    out.push(`<div class="panel"><h2>Doctrinal Observations &amp; Patterns</h2><div class="grid2">`);
    blocks.forEach(([title, items]) => {
      out.push(`<div class="block"><h3>${esc(title)}</h3><ul class="notes">${items.length ? items.map((s) => `<li>${esc(s)}</li>`).join("") : `<li class="muted">No entries for this run.</li>`}</ul></div>`);
    });
    out.push(`</div></div>`);
  }

  // ---- Audit log ----
  if (audit?.entries?.length) {
    const s = audit.summary ?? {};
    const rows = audit.entries.map((e: Any) =>
      `<tr><td class="num">${Math.round(e.detectedAt)}s</td><td><span class="chip">${esc(e.kind)}</span></td><td>${esc(e.topic)}</td><td>${esc(e.claim)}</td><td class="mono">${esc(e.source)} <span class="muted">vs</span> ${esc(e.conflictingSource)}</td><td>${(e.seats ?? []).map((x: string) => `<span class="chip">${esc(x)}</span>`).join("")}</td><td class="${e.status === "OPEN" ? "bad" : "ok"}">${esc(e.status)}${e.resolutionNote ? `<div class="muted" style="font-size:11px">${esc(e.resolutionNote)}</div>` : ""}</td></tr>`,
    ).join("");
    out.push(`<div class="panel"><h2>Contradiction &amp; Conflict Audit — ${esc(s.total ?? audit.entries.length)} entries · ${esc(s.open ?? 0)} open · ${esc(s.resolved ?? 0)} resolved</h2>${table(
      `<th class="num">Detected</th><th>Kind</th><th>Topic</th><th>Claim</th><th>Sources</th><th>Seats</th><th>Status</th>`,
      rows,
    )}</div>`);
  }

  // ---- Full event timeline ----
  if (timeline.length) {
    const rows = timeline.map((e: Any) =>
      `<tr><td class="num">${esc(e.seq)}</td><td class="num">${Math.round(e.t)}s</td><td class="mono">${esc(e.type)}</td><td class="mono">${esc(e.actor)}</td><td>${esc(e.summary)}</td></tr>`,
    ).join("");
    out.push(`<div class="panel"><h2>Full Event Timeline — ${timeline.length} Events</h2>${table(
      `<th class="num">Seq</th><th class="num">Time</th><th>Type</th><th>Actor</th><th>Summary</th>`,
      rows,
    )}</div>`);
  }

  // ---- Instructor notes ----
  out.push(`<div class="panel"><h2>EXCON Instructor Debrief Notes</h2>`);
  out.push(notes.trim()
    ? `<div class="prose" style="white-space:pre-wrap">${esc(notes)}</div>`
    : `<p class="muted" style="margin:0">No instructor notes recorded for this run.</p>`);
  out.push(`</div>`);

  out.push(`<footer>Synthetic training scenario — not operational data. Generated by the DSSC Multi-Domain Decision-Making Trainer · source payload <span class="mono">/api/runs/${esc(runId)}/aar</span> · ${stamp}<br>Print this document (Ctrl+P) to file it as PDF.</footer>`);
  out.push(`</div></body></html>`);
  return out.join("\n");
}

/** Trigger a browser download of the dossier built above. */
export function downloadAarHtml(aar: Any, cf: Any, cfMode: string, notes: string): void {
  const html = buildAarHtml(aar, cf, cfMode, notes);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `AAR-${String(aar?.header?.runId ?? "run")}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
