// Hindi/English toggle. Server strings and military acronyms stay as-is; chrome translates.
import { useSyncExternalStore } from "react";

export type Lang = "en" | "hi";

const KEY = "excon-lang";
let lang: Lang = (() => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "hi" || v === "en") return v;
  } catch { /* ignore */ }
  return "en";
})();
const subs = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}
export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
function subscribe(f: () => void) {
  subs.add(f);
  return () => { subs.delete(f); };
}
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang);
}

type Entry = { en: string; hi: string };

const DICT: Record<string, Entry> = {
  // ---- shared chrome ----
  "nav.home": { en: "HOME", hi: "मुख्य" },
  "nav.lobby": { en: "LOBBY", hi: "लॉबी" },
  "nav.analytics": { en: "ANALYTICS", hi: "विश्लेषण" },
  "nav.excon": { en: "EXCON CONSOLE", hi: "EXCON कंसोल" },
  "sim.server": { en: "SIM SERVER:", hi: "सिम सर्वर:" },
  "sim.online": { en: "ONLINE", hi: "ऑनलाइन" },
  "sim.off": { en: "DISCONNECTED", hi: "डिस्कनेक्टेड" },
  "gov.on": { en: "SIM ENGINE ACTIVE", hi: "सिम इंजन सक्रिय" },
  "gov.off": { en: "SIM OFFLINE", hi: "सिम ऑफ़लाइन" },

  // ---- home ----
  "home.kicker": { en: "SIH26248 · MINISTRY OF DEFENCE · DEFENCE SERVICES STAFF COLLEGE", hi: "SIH26248 · रक्षा मंत्रालय · रक्षा सेवा स्टाफ कॉलेज" },
  "home.title": { en: "Train the decision, not the network.", hi: "नेटवर्क नहीं — निर्णय का अभ्यास कराएँ।" },
  "home.sub": {
    en: "A multi-domain staff exercise where the radio lies, the feeds disagree and the picture is wrong on purpose. Five appointments, one ground truth, and an after-action review that shows the exact tick each seat lost it.",
    hi: "बहु-क्षेत्रीय स्टाफ अभ्यास जहाँ रेडियो झूठ बोलता है, फ़ीड असहमत हैं और चित्र जानबूझकर गलत है। पाँच पद, एक सत्य, और आफ्टर-एक्शन समीक्षा जो हर सीट के बिगड़ने का सही क्षण दिखाती है।",
  },
  "home.demo": { en: "1-CLICK JURY DEMO", hi: "1-क्लिक जज डेमो" },
  "home.lobby": { en: "OPEN EXERCISE LOBBY", hi: "व्यायाम लॉबी खोलें" },
  "home.demoHint": {
    en: "Demo spawns scripted staff seats & runs the full exercise to a scored AAR — no setup.",
    hi: "डेमो स्क्रिप्टेड सीटें बनाकर पूरा अभ्यास स्कोर्ड AAR तक चलाता है — कोई सेटअप नहीं।",
  },
  "home.stat.decks": { en: "SCENARIO DECKS", hi: "परिदृश्य डेक" },
  "home.stat.decksV": { en: "{n} live · YAML, deception objectives", hi: "{n} सक्रिय · YAML, छल-उद्देश्य" },
  "home.stat.appts": { en: "APPOINTMENTS", hi: "पदस्थान" },
  "home.stat.apptsV": { en: "5 crew seats + EXCON + demo bots", hi: "5 क्रू सीट + EXCON + डेमो बॉट" },
  "home.stat.scoring": { en: "SCORING", hi: "स्कोरिंग" },
  "home.stat.scoringV": { en: "SAGAT · CAST · IIS · OODA · calibration", hi: "SAGAT · CAST · IIS · OODA · कैलिब्रेशन" },
  "home.stat.replay": { en: "REPLAY", hi: "रीप्ले" },
  "home.stat.replayV": { en: "Seeded, tick-exact, deterministic", hi: "सीडेड, टिक-एक्सैक्ट, निर्धारित" },
  "home.takeSeat": { en: "TAKE A SEAT", hi: "अपना पद संभालें" },
  "home.takeSeatHint": { en: "opens in a new tab · deck: {deck} · pick any deck from the LOBBY", hi: "नई टैब में खुलता है · डेक: {deck} · LOBBY से कोई भी डेक चुनें" },

  // ---- seat cards ----
  "seat.cdr.name": { en: "Commander", hi: "कमांडर" },
  "seat.cdr.duty": { en: "Commits the COA. Decides what to trust when the nets disagree.", hi: "COA तय करता है। नेट्स के असहमत होने पर किस पर भरोसा करना है, यह निर्णय लेता है।" },
  "seat.ops.name": { en: "Operations / 2iC", hi: "संचालन / 2i-C" },
  "seat.ops.duty": { en: "Owns the operational picture and the movement plan.", hi: "संचालन चित्र और गतिविधि योजना का उत्तरदायित्व।" },
  "seat.intel.name": { en: "Intelligence", hi: "खुफिया" },
  "seat.intel.duty": { en: "ISR vs HUMINT. Says which feed to believe when they conflict.", hi: "ISR बनाम HUMINT। फ़ीड टकराने पर किस पर विश्वास करना है यह बताता है।" },
  "seat.comms.name": { en: "Communications", hi: "संचार" },
  "seat.comms.duty": { en: "The only seat that sees every link — and who dropped off it.", hi: "हर लिंक देखने वाला एकमात्र पद — और कौन ड्रॉप हुआ।" },
  "seat.log.name": { en: "Logistics", hi: "रसद" },
  "seat.log.duty": { en: "Fuel, spares, confirmations. The feed everyone forgets until it hurts.", hi: "ईंधन, स्पेयर, पुष्टि। सब भूल जाते हैं जब तक दर्द नहीं होता।" },
  "seat.excon.name": { en: "Exercise Control", hi: "व्यायाम नियंत्रण" },
  "seat.excon.duty": { en: "God's-eye console: injects, freeze, notices, live scoring.", hi: "गॉड-आई कंसोल: इंजेक्ट, फ्रीज, सूचनाएँ, लाइव स्कोरिंग।" },

  // ---- capabilities ----
  "cap.one.title": { en: "ONE TRUTH, FIVE BROKEN VIEWS", hi: "एक सत्य, पाँच बिगड़े दृश्य" },
  "cap.one.body": {
    en: "A single authoritative simulation projects a deliberately degraded slice of itself to each seat — latency, dropouts and spoofed feeds, derived from the scenario deck.",
    hi: "एक अधिकृत सिमुलेशन हर सीट को जानबूझकर बिगड़ा हुआ स्लाइस भेजता है — विलंब, ड्रॉपआउट और स्पूफ्ड फ़ीड, परिदृश्य डेक से व्युत्पन्न।",
  },
  "cap.score.title": { en: "SCORED, NOT JUDGED BY EYE", hi: "स्कोर्ड — आँख से नहीं आँका गया" },
  "cap.score.body": {
    en: "SAGAT probes, CAST checks, per-seat Information Integrity Score, OODA latency and confidence-vs-accuracy calibration — computed from the run, not from opinion.",
    hi: "SAGAT प्रोब, CAST जाँच, प्रति-सीट सूचना-सत्यता स्कोर, OODA विलंब और विश्वास-बनाम-सटीकता कैलिब्रेशन — रन से गणना, राय से नहीं।",
  },
  "cap.replay.title": { en: "TICK-EXACT REPLAY", hi: "टिक-एक्सैक्ट रीप्ले" },
  "cap.replay.body": {
    en: "Seeded, fixed-tick, deterministic. Scrub back to the exact second each seat's picture diverged from ground truth — with divergence computed from the deck itself.",
    hi: "सीडेड, फिक्स्ड-टिक, निर्धारित। उसी सेकंड तक स्क्रब करें जब हर सीट का चित्र सत्य से भटका — विचलन डेक से गणना।",
  },
  "cap.cf.title": { en: "COUNTERFACTUAL RE-SCORING", hi: "काउंटरफैक्टुअल पुनर्स्कोरिंग" },
  "cap.cf.body": {
    en: "Re-score the recorded run with the failure modes patched out: pristine links, zero spoofs. Shows what the decision would have cost without the EW.",
    hi: "रिकॉर्डेड रन को विफलता-मोड हटाकर फिर से स्कोर करें: साफ़ लिंक, शून्य स्पूफ। बिना EW के निर्णय की कीमत दिखती है।",
  },

  // ---- lobby ----
  "lobby.heroTitle": { en: "SIH26248 · DECISION-MAKING UNDER DEGRADED COMMS", hi: "SIH26248 · बिगड़े संचार में निर्णय-निर्माण" },
  "lobby.heroBody": {
    en: "One authoritative multi-domain simulation projecting deliberately degraded, asynchronous views to each staff appointment. Evaluates cognitive resistance to adversarial spoofing, latency spikes, and communication blackouts via SAGAT situational awareness probes and automated CAST scoring.",
    hi: "एक अधिकृत बहु-क्षेत्रीय सिमुलेशन जो हर स्टाफ-पद को जानबूझकर बिगड़े, असममित दृश्य भेजता है। SAGAT प्रोब और स्वचालित CAST स्कोरिंग से विरोधी स्पूफिंग, विलंब-स्पाइक और संचार-ब्लैकआउट के प्रति संज्ञानात्मक प्रतिरोध मापता है।",
  },
  "lobby.demo": { en: "🚀 1-CLICK JURY DEMO RUN", hi: "🚀 1-क्लिक जज डेमो रन" },
  "lobby.demoSub": { en: "Spawns scripted AI staff seats & live injects", hi: "स्क्रिप्टेड AI स्टाफ सीट और लाइव इंजेक्ट बनाता है" },
  "lobby.dir": { en: "MISSION SCENARIO DIRECTORY", hi: "मिशन परिदृश्य निर्देशिका" },
  "lobby.search": { en: "Search operational scenarios…", hi: "संचालन परिदृश्य खोजें…" },
  "lobby.select": { en: "SELECT APPOINTMENT STATION:", hi: "पदस्थान चुनें:" },
  "lobby.loading": { en: "Loading scenario profiles from server...", hi: "सर्वर से परिदृश्य प्रोफ़ाइल लोड हो रही हैं…" },
  "lobby.custom": { en: "CUSTOM SCENARIO INGESTION", hi: "कस्टम परिदृश्य आयात" },
  "lobby.customBody": {
    en: "Upload custom military scenario decks in YAML format to test custom troop movements, deception injects, and EW link timelines.",
    hi: "अपने सैन्य परिदृश्य YAML में अपलोड करें — इकाई-गतिविधि, छल-इंजेक्ट और EW लिंक-टाइमलाइन परीक्षण के लिए।",
  },
  "lobby.selectYaml": { en: "📂 SELECT YAML FILE", hi: "📂 YAML फ़ाइल चुनें" },
  "lobby.archive": { en: "RECENT EXERCISE ARCHIVE", hi: "हाल के व्यायाम संग्रह" },
  "lobby.noRuns": { en: "No past runs recorded yet. Launch a demo or live exercise above.", hi: "अभी कोई रन दर्ज नहीं। ऊपर से डेमो या लाइव अभ्यास चलाएँ।" },
  "lobby.aarBtn": { en: "AAR DOSSIER", hi: "AAR दस्तावेज़" },
  "lobby.replayBtn": { en: "DVR REPLAY", hi: "DVR रीप्ले" },
  "lobby.meta": { en: "⏱️ {min} min · 🎯 {dec} decisions · 🧠 {q} SA probes", hi: "⏱️ {min} मिनट · 🎯 {dec} निर्णय · 🧠 {q} SA प्रोब" },
  "lobby.geo": { en: "📍 {area}", hi: "📍 {area}" },

  // ---- seat chrome ----
  "view.cop": { en: "COMMON OPERATING PICTURE (PERCEIVED THEATER VIEW)", hi: "सामान्य संचालन चित्र (अनुमानित रण-दृश्य)" },
  "view.radio": { en: "TACTICAL RADIO DISPATCH (MULTI-CHANNEL TRANSCEIVER)", hi: "रणनीतिक रेडियो डिस्पैच (बहु-चैनल ट्रांसीवर)" },
  "view.inbox": { en: "RADIO TRAFFIC INBOX", hi: "रेडियो ट्रैफ़िक इनबॉक्स" },
  "view.probeBlank": { en: "⚡ COGNITIVE SA PROBE ACTIVE — ALL MAPS & TELEMETRY BLANKED", hi: "⚡ SA प्रोब सक्रिय — सभी नक्शे व टेलीमेट्री ब्लॉक" },
  "view.probeBlankSub": {
    en: "Answer situational questions from operational memory · Nets are silenced during freeze",
    hi: "संचालन-स्मृति से स्थिति प्रश्नों के उत्तर दें · फ्रीज के दौरान नेट्स मौन",
  },

  // ---- NASA-TLX workload prompt ----
  "tlx.title": { en: "NASA-TLX COGNITIVE WORKLOAD RATING", hi: "NASA-TLX संज्ञानात्मक कार्यभार रेटिंग" },
  "tlx.prompt": {
    en: "EXCON requests a workload rating before debrief — six scales, 0–100. Honest numbers feed the AAR.",
    hi: "डिब्रीफ़ से पहले EXCON कार्यभार रेटिंग माँगता है — छह स्केल, 0–100। ईमानदार आँकड़े AAR में जाते हैं।",
  },
  "tlx.mental": { en: "Mental Demand", hi: "मानसिक माँग" },
  "tlx.physical": { en: "Physical Demand", hi: "शारीरिक माँग" },
  "tlx.temporal": { en: "Temporal Demand", hi: "समय-माँग" },
  "tlx.performance": { en: "Performance", hi: "प्रदर्शन" },
  "tlx.effort": { en: "Effort", hi: "प्रयास" },
  "tlx.frustration": { en: "Frustration", hi: "निराशा" },
  "tlx.perfHint": { en: "0 = flawless, 100 = failure", hi: "0 = निर्दोष, 100 = विफलता" },
  "tlx.low": { en: "minimal", hi: "न्यूनतम" },
  "tlx.high": { en: "extreme", hi: "अत्यधिक" },
  "tlx.submit": { en: "SUBMIT RATING", hi: "रेटिंग भेजें" },
  "tlx.later": { en: "LATER", hi: "बाद में" },
  "tlx.request": { en: "REQUEST TLX", hi: "TLX माँगें" },
  "tlx.aarTitle": { en: "NASA-TLX POST-EXERCISE WORKLOAD", hi: "NASA-TLX अभ्यास-पश्चात कार्यभार" },
  "tlx.avg": { en: "MEAN", hi: "औसत" },
};

/** Translate `key` at the current language, substituting {param} placeholders. */
export function t(key: string, params?: Record<string, string | number>): string {
  const entry = DICT[key];
  let s = entry ? (lang === "hi" ? entry.hi : entry.en) : key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Reactive translate hook — re-renders the component when the language flips. */
export function useT(): typeof t {
  useLang();
  return t;
}
