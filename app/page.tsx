"use client";

import { useRef, useState } from "react";
import type { MatchResult } from "@/lib/agent/pipeline";
import type { AgentEvent, AgentCheck, StepEvent } from "@/lib/agent/orchestrator";
import type { Answers, Extraction } from "@/lib/agent/schema";
import toolsMeta from "@/data/tools.json";

/** M3 prototype UI: several photos at once, live agent steps, correctable chips, follow-up questions, feedback.
 *  Hainings Design ersetzt das Styling später; Logik und Datenfluss bleiben. */

type ToolKey = keyof typeof toolsMeta;
const TOOL_LABEL = toolsMeta as Record<string, { label: string; visibility: string }>;
const TOOL_IDS = Object.keys(toolsMeta).filter((t) => t !== "other") as ToolKey[];
const ZONES = ["58", "65", "84", "91/93", "100", "111", "130"] as const;
const CATEGORIES: Record<string, string> = {
  SAK: "Taschenmesser", MULTITOOL: "Multitool", ONEHAND: "Einhandmesser", SWISSCARD: "SwissCard",
  FIXED: "Feststehend", GARDEN: "Garten", OTHER_KNIFE: "anderes Messer",
};
const EMPTY: Answers = { tools_yes: [], tools_no: [], length_zone: null, category: null, rounds: 0 };

type Res = MatchResult & { photos?: number; model?: string; prompt_version?: string; agent_checks?: AgentCheck[]; error?: string };
const MAX_PHOTOS = 6;
type CatItem = { id: string; name: string; length_mm: number | null; image: string };

/** decode via createImageBitmap (respects EXIF rotation), fall back to <img> for formats it can't read */
async function decode(file: File): Promise<{ src: CanvasImageSource; w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { src: bmp, w: bmp.width, h: bmp.height };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { src: img, w: img.naturalWidth, h: img.naturalHeight };
    } catch {
      throw new Error("Dieses Bildformat kann der Browser nicht lesen. Bitte als JPEG/PNG speichern oder direkt fotografieren.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function resize(file: File, max = 1280): Promise<string> {
  const { src, w, h } = await decode(file);
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as T;
}

const LEVEL = {
  high: { text: "Hoch" },
  medium: { text: "Mittel" },
  low: { text: "Niedrig" },
} as const;

const STATUS = {
  both: { sym: "✓", cls: "text-vx-ink", title: "bei beiden" },
  only_victorinox: { sym: "＋", cls: "text-vx-red", title: "zusätzlich bei Victorinox" },
  missing: { sym: "–", cls: "text-vx-muted", title: "fehlt im Vorschlag" },
  unknown: { sym: "?", cls: "text-vx-muted", title: "auf dem Foto nicht sichtbar" },
} as const;

/** every agent has its own knife drawing (public/agents, by Haining); it spins while the agent works */
const AGENTS = [
  { name: "Orchestrator", short: "Orchestrator", icon: "/agents/knife-04.svg", role: "plant & fragt nach" },
  { name: "Vision-Agent", short: "Vision", icon: "/agents/knife-01.svg", role: "sieht die Fotos" },
  { name: "Product-Data-Agent", short: "Produktdaten", icon: "/agents/knife-06.svg", role: "kennt den Katalog" },
  { name: "Recommendation-Agent", short: "Empfehlung", icon: "/agents/knife-09.svg", role: "wählt das Modell" },
] as const;
const ICON = Object.fromEntries(AGENTS.map((a) => [a.name, a.icon])) as Record<string, string>;

function KnifeAvatar({ agent, state, size = 36 }: { agent: string; state: "run" | "done" | "skip" | "idle"; size?: number }) {
  const url = `url(${ICON[agent] ?? AGENTS[0].icon})`;
  const color = state === "run" ? "bg-vx-red" : state === "skip" ? "bg-amber-500" : state === "done" ? "bg-vx-ink" : "bg-[#c8c8c8]";
  return (
    <span className={`relative inline-flex flex-none items-center justify-center rounded-full border bg-white ${state === "run" ? "border-vx-red" : "border-vx-border"}`}
      style={{ width: size, height: size }} aria-hidden>
      <span className={`block ${color} ${state === "run" ? "animate-[spin_1.4s_linear_infinite]" : ""}`}
        style={{ width: size * 0.78, height: size * 0.78, WebkitMask: `${url} center / contain no-repeat`, mask: `${url} center / contain no-repeat` }} />
      {state === "done" && size >= 40 && <span className="absolute -bottom-0.5 -right-0.5 flex size-[15px] items-center justify-center rounded-full bg-vx-ink text-[9px] text-white">✓</span>}
      {state === "skip" && size >= 40 && <span className="absolute -bottom-0.5 -right-0.5 flex size-[15px] items-center justify-center rounded-full bg-amber-500 text-[9px] text-white">!</span>}
    </span>
  );
}

function Chip({ on, dashed, children, onClick }: { on: boolean; dashed?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`rounded-[2px] border px-3 py-1.5 text-[14px] ${on ? "border-vx-ink bg-vx-ink text-white" : "border-vx-border bg-white text-vx-muted"} ${dashed ? "border-dashed" : ""}`}>
      {on ? "✓ " : ""}{children}
    </button>
  );
}

/* simple line icons (Figma icons are not downloadable from this environment) */
const Ico = {
  camera: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-3l-2.5-3z" /><circle cx="12" cy="13" r="3.5" /></svg>,
  image: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="1" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>,
  ruler: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="2" y="8" width="20" height="8" rx="1" /><path d="M6 8v3M10 8v3M14 8v3M18 8v3" /></svg>,
  chevron: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>,
  check: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>,
  arrowDown: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>,
  close: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>,
  warn: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>,
  thumbUp: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v11M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18.4 21H7V10l4-8a3 3 0 0 1 4 3.9z" /></svg>,
  thumbDown: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V3M9 18.1 10 14H4.2a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 5.6 3H17v11l-4 8a3 3 0 0 1-4-3.9z" /></svg>,
  code: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></svg>,
};

const Section = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <section className={`px-5 pt-6 ${className}`}>{children}</section>
);

export default function Home() {
  const camRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [extractions, setExtractions] = useState<Extraction[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<Res | null>(null);
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [addTool, setAddTool] = useState(false);
  const [fb, setFb] = useState<"idle" | "pick" | "done">("idle");
  const [fbMsg, setFbMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatItem[]>([]);
  const [steps, setSteps] = useState<StepEvent[]>([]);

  function reset() {
    setPhotos([]); setExtractions([]); setRes(null); setAnswers(EMPTY); setError(null); setFb("idle"); setFbMsg(null); setAddTool(false); setSteps([]);
  }

  /** one or several photos; added to the current knife (add=true) or starting a new one */
  async function onFiles(list: FileList | File[] | null | undefined, add: boolean) {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!files.length) return;
    setError(null);
    const prevPhotos = add ? photos : [];
    const prevEx = add ? extractions : [];
    const room = MAX_PHOTOS - prevPhotos.length;
    if (room <= 0) return setError(`Maximal ${MAX_PHOTOS} Fotos pro Messer. Für ein anderes Messer „Neues Messer" wählen.`);
    if (!add) reset();
    const use = files.slice(0, room);
    setBusy(use.length > 1 ? `${use.length} Fotos werden vorbereitet …` : "Foto wird vorbereitet …");
    try {
      const imgs = await Promise.all(use.map((f) => resize(f)));
      const all = [...prevPhotos, ...imgs];
      setPhotos(all);
      setSteps([]);
      setBusy("Agent arbeitet …");
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: all, previous: prevEx, answers: add ? answers : EMPTY }),
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? r.statusText);
      }
      const exs: Extraction[] = [...prevEx];
      let gotResult = false;
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as AgentEvent;
          if (ev.type === "step") {
            setSteps((st) => { const i = st.findIndex((x) => x.id === ev.id); return i >= 0 ? st.map((x, k) => (k === i ? ev : x)) : [...st, ev]; });
            if (ev.status === "run") setBusy(ev.text);
          } else if (ev.type === "photo") exs[ev.index] = ev.extraction;
          else if (ev.type === "error") throw new Error(ev.error);
          else if (ev.type === "result") {
            gotResult = true;
            setExtractions(exs);
            setAnswers(ev.result.answers);
            setRes(ev.result);
            setFb("idle"); setFbMsg(null);
          }
        }
        if (done) break;
      }
      if (!gotResult) throw new Error("Verbindung zum Agenten abgebrochen. Bitte nochmals versuchen.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (!add) setPhotos([]);
      else setPhotos(prevPhotos);
    } finally {
      setBusy(null);
      if (camRef.current) camRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  async function rescore(next: Answers) {
    if (!extractions.length) return;
    setAnswers(next);
    setBusy("Neu berechnen …");
    try {
      const j = await postJson<Res>("/api/score", { extractions, answers: next });
      setRes((r) => ({ ...j, model: r?.model, prompt_version: r?.prompt_version, timings: { ...r?.timings, ...j.timings } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  // ----- chips: what the agent understood, correctable -----
  const ex = res?.extraction;
  const shownTools = ex ? [...new Set([...ex.tools_seen, ...answers.tools_yes])].filter((t) => !answers.tools_no.includes(t)) : [];
  const maybeTools = ex ? ex.tools_maybe.filter((t) => !shownTools.includes(t) && !answers.tools_no.includes(t)) : [];
  function toggleTool(t: ToolKey, isOn: boolean) {
    const yes = answers.tools_yes.filter((x) => x !== t);
    const no = answers.tools_no.filter((x) => x !== t);
    rescore(isOn ? { ...answers, tools_yes: yes, tools_no: [...no, t] } : { ...answers, tools_yes: [...yes, t], tools_no: no });
  }

  // ----- feedback -----
  async function sendFeedback(chosen: string, correct: boolean) {
    const suggested = res?.ranking?.candidates[0]?.id ?? null;
    try {
      const j = await postJson<{ persistent: boolean }>("/api/feedback", { extractions, suggested, chosen, correct });
      setFb("done");
      setFbMsg(correct ? "Danke! Bestätigung gespeichert." : `Danke! Gelernt: dieses Messer → ${chosen}.`);
      if (!j.persistent) setFbMsg((m) => `${m} (Hinweis: ohne Datenbank nur temporär gespeichert)`);
      if (!correct) rescore(answers);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function search(v: string) {
    setQ(v);
    if (v.trim().length < 2) return setHits([]);
    const r = await fetch(`/api/catalog?q=${encodeURIComponent(v)}`);
    setHits(((await r.json()) as { items: CatItem[] }).items);
  }

  const top = res?.ranking?.candidates ?? [];
  const question = res?.question;
  const isVic = ex?.is_victorinox;
  const hasKnife = extractions.length > 0 || photos.length > 0;
  const working = !!busy;
  const stage: "start" | "analyse" | "result" = !hasKnife && !working ? "start" : working && !res ? "analyse" : "result";
  const doneSteps = steps.filter((s) => s.status !== "run").length;
  const progress = steps.length ? Math.min(0.95, doneSteps / Math.max(steps.length + 2, 8)) : 0.08;
  const best = top[0];
  const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)} %`);

  return (
    <main className="mx-auto min-h-screen max-w-[480px] bg-white pb-10 text-vx-ink">
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFiles(e.target.files, extractions.length > 0)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files, extractions.length > 0)} />

      {/* header */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-vx-line bg-white pl-4 pr-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/victorinox-logo.png" alt="Victorinox" width={148} height={30} className="h-[30px] w-auto" />
        {stage !== "start" && (
          <div className="flex items-center gap-3">
            <span className="font-cond text-[18px] font-semibold uppercase tracking-[0.06em]">{stage === "analyse" ? "Analyse" : "Ergebnis"}</span>
            <button onClick={reset} disabled={working} aria-label="Neues Messer" className="flex size-10 items-center justify-center disabled:opacity-40">{Ico.close}</button>
          </div>
        )}
      </header>

      {/* ---------- start ---------- */}
      {stage === "start" && (<>
        <div className="flex h-[200px] items-center justify-center bg-[#f7f7f7]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/hero-knife.png" alt="" width={310} height={141} />
        </div>
        <Section>
          <p className="vx-eyebrow">Product Match Agent</p>
          <h1 className="vx-h1 mt-1.5 text-[38px] leading-[38px]">Foto aufnehmen.<br />Victorinox finden.</h1>
          <p className="mt-3.5 text-[17px] font-light leading-[24.65px] text-vx-text">
            Erkennt Taschenmesser von Victorinox und Mitbewerbern und schlägt das passende Victorinox-Produkt vor – mit Begründung, Konfidenz und technischen Daten.
          </p>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files, false); }}
            className={`mt-6 flex flex-col gap-3 ${drag ? "outline-2 outline-offset-4 outline-vx-red" : ""}`}>
            <button onClick={() => camRef.current?.click()} className="vx-btn vx-btn-primary">{Ico.camera} Foto aufnehmen</button>
            <button onClick={() => galleryRef.current?.click()} className="vx-btn vx-btn-outline">{Ico.image} Aus Galerie wählen</button>
            <p className="hidden text-center text-[14px] text-vx-muted md:block">… oder mehrere Bilder hierher ziehen</p>
          </div>
          {error && <p className="mt-4 border-l-[3px] border-vx-red bg-vx-panel p-3 text-[15px]">{error}</p>}
        </Section>
        <Section>
          <div className="flex gap-3.5 border-l-[3px] border-vx-red bg-vx-panel p-[18px]">
            <span className="text-vx-red">{Ico.ruler}</span>
            <div>
              <p className="text-[16px] font-semibold">Tipp: Messunterlage verwenden</p>
              <p className="mt-1 text-[15px] font-light leading-[21px] text-vx-text">Messer aufgeklappt auf die Unterlage legen – so misst der Agent die Länge exakt. Mehrere Fotos mit je anderen Werkzeugen erhöhen die Sicherheit.</p>
              <a href="/messunterlage.pdf" target="_blank" className="mt-2.5 inline-flex items-center gap-1 text-[15px] font-semibold text-vx-red">Messunterlage öffnen {Ico.chevron}</a>
            </div>
          </div>
        </Section>
      </>)}

      {/* ---------- photos + agent ---------- */}
      {stage !== "start" && (<>
        {photos.length > 0 && (
          <Section className="pt-5">
            <div className="flex gap-2 overflow-x-auto">
              {photos.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={p} alt={`Foto ${i + 1}`}
                  className={`size-16 flex-none border border-vx-border object-cover ${working && i >= extractions.length ? "animate-pulse opacity-60" : ""}`} />
              ))}
            </div>
          </Section>
        )}

        {steps.length > 0 && (
          <Section>
            {working ? (<>
              <p className="vx-eyebrow">Agent arbeitet</p>
              <h2 className="vx-h1 mt-1 text-[28px] leading-[30px]">{busy}</h2>
              <div className="mt-3 h-1 w-full bg-[#ececec]"><div className="h-1 bg-vx-red transition-all duration-500" style={{ width: `${progress * 100}%` }} /></div>
            </>) : null}
            <details open={working} className="group mt-3">
              <summary className="flex cursor-pointer list-none items-center justify-between border-y border-vx-line py-3">
                <span className="vx-section">Agent-Schritte · {steps.length}{res?.agent_checks?.length ? ` · ${res.agent_checks.length} Selbstprüfung${res.agent_checks.length > 1 ? "en" : ""}` : ""}</span>
                <span className="rotate-90 transition group-open:-rotate-90">{Ico.chevron}</span>
              </summary>
              <div className="mt-4 grid grid-cols-4 gap-1 text-center">
                {AGENTS.map((a) => {
                  const mine = steps.filter((s) => s.agent === a.name);
                  const state = mine.some((s) => s.status === "run") ? "run" : mine.length ? "done" : "idle";
                  return (
                    <div key={a.name} className="flex flex-col items-center gap-1">
                      <KnifeAvatar agent={a.name} state={state} size={48} />
                      <span className={`font-cond text-[13px] font-semibold uppercase leading-tight tracking-[0.04em] ${state === "run" ? "text-vx-red" : state === "idle" ? "text-[#b5b5b5]" : "text-vx-ink"}`}>{a.short}</span>
                      <span className="text-[11px] leading-tight text-vx-muted">{a.role}</span>
                    </div>
                  );
                })}
              </div>
              <ol className="mt-4 space-y-3">
                {steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-3">
                    <KnifeAvatar agent={s.agent} state={s.status} size={26} />
                    <span className="text-[15px] leading-[20px]">
                      <span className="font-semibold">{s.agent}</span>
                      <span className="block text-[13px] leading-[18px] text-vx-muted">{s.text}{s.ms != null && ` · ${(s.ms / 1000).toFixed(1)} s`}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          </Section>
        )}
        {error && <Section><p className="border-l-[3px] border-vx-red bg-vx-panel p-3 text-[15px]">{error}</p></Section>}
      </>)}

      {res?.status === "rejected" && (
        <Section><p className="border-l-[3px] border-vx-red bg-vx-panel p-4">Auf dem Foto ist kein Taschenmesser erkennbar. Bitte nochmals fotografieren.</p></Section>
      )}

      {/* ---------- recognised (correctable) ---------- */}
      {ex && res?.status !== "rejected" && (
        <Section>
          <p className="vx-section">Erkannt</p>
          <div className="mt-3 flex items-center gap-3.5 bg-vx-panel p-3.5">
            <div className="flex size-16 flex-none items-center justify-center bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {photos[0] && <img src={photos[0]} alt="" className="size-[60px] object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <span className={`inline-block px-[7px] py-[2px] font-cond text-[12px] font-semibold uppercase tracking-[0.1em] text-white ${isVic ? "bg-vx-red" : "bg-vx-muted"}`}>
                {isVic ? "Victorinox" : isVic === false ? "Konkurrenzprodukt" : "Marke unklar"}
              </span>
              <p className="vx-h1 mt-1.5 truncate text-[22px] leading-[22px]">{ex.brand ?? "Unbekannte Marke"}</p>
              <p className="mt-0.5 text-[14px] text-vx-muted">
                {CATEGORIES[answers.category ?? ex.category] ?? ex.category}
                {ex.length_estimate_mm ? ` · ≈ ${Math.round(ex.length_estimate_mm)} mm` : ""}
                {` · ${res?.photos ?? extractions.length} Foto${(res?.photos ?? extractions.length) > 1 ? "s" : ""}`}
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button onClick={() => camRef.current?.click()} disabled={working} className="vx-btn vx-btn-outline h-[46px] text-[16px]">{Ico.camera} Weiteres Foto</button>
            <button onClick={() => galleryRef.current?.click()} disabled={working} className="vx-btn vx-btn-outline h-[46px] text-[16px]">{Ico.image} Galerie</button>
          </div>
          <details className="group mt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between border-y border-vx-line py-3">
              <span className="text-[16px] font-semibold">Erkannte Merkmale korrigieren</span>
              <span className="rotate-90 transition group-open:-rotate-90">{Ico.chevron}</span>
            </summary>
            <p className="mt-3 font-cond text-[14px] font-semibold uppercase tracking-[0.1em] text-vx-muted">Kategorie</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {Object.entries(CATEGORIES).filter(([k]) => ["SAK", "MULTITOOL", "ONEHAND"].includes(k) || k === ex.category).map(([k, v]) => (
                <Chip key={k} on={(answers.category ?? ex.category) === k} onClick={() => rescore({ ...answers, category: k as Answers["category"] })}>{v}</Chip>
              ))}
            </div>
            <p className="mt-3 font-cond text-[14px] font-semibold uppercase tracking-[0.1em] text-vx-muted">Länge (Schale)</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {ZONES.map((z) => (
                <Chip key={z} on={(answers.length_zone ?? ex.length_zone) === z} onClick={() => rescore({ ...answers, length_zone: z })}>{z} mm</Chip>
              ))}
            </div>
            <p className="mt-3 font-cond text-[14px] font-semibold uppercase tracking-[0.1em] text-vx-muted">Werkzeuge · antippen zum Korrigieren</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {shownTools.map((t) => <Chip key={t} on onClick={() => toggleTool(t as ToolKey, true)}>{TOOL_LABEL[t]?.label ?? t}</Chip>)}
              {maybeTools.map((t) => <Chip key={t} on={false} dashed onClick={() => toggleTool(t as ToolKey, false)}>{TOOL_LABEL[t]?.label ?? t}?</Chip>)}
              <button onClick={() => setAddTool((v) => !v)} className="rounded-[2px] border border-dashed border-vx-muted px-3 py-1.5 text-[14px] text-vx-muted">＋ Werkzeug</button>
            </div>
            {addTool && (
              <select className="mt-2 w-full rounded-[2px] border border-vx-border p-2" defaultValue=""
                onChange={(e) => { const t = e.target.value as ToolKey; setAddTool(false); if (t) toggleTool(t, false); }}>
                <option value="">Werkzeug hinzufügen …</option>
                {TOOL_IDS.filter((t) => !shownTools.includes(t)).map((t) => <option key={t} value={t}>{TOOL_LABEL[t].label}</option>)}
              </select>
            )}
          </details>
        </Section>
      )}

      {/* ---------- follow-up question (Rückfrage) ---------- */}
      {question && !working && (
        <Section>
          <div className="flex gap-3 border-l-[3px] border-[#d4a017] bg-[#fdf6e3] p-4">
            <span className="text-[#8a6100]">{Ico.warn}</span>
            <div>
              <p className="text-[16px] font-semibold">Erkennung unsicher{res?.ranking ? ` · Zuverlässigkeit ${Math.round(res.ranking.confidence * 100)}/100` : ""}</p>
              <p className="text-[15px] leading-[21px] text-vx-text">{question.reason}</p>
            </div>
          </div>
          <p className="vx-eyebrow mt-5">Eine Angabe fehlt noch</p>
          <h2 className="vx-h1 mt-1 text-[26px] leading-[28px]">{question.type === "photo_open" ? "Wie möchten Sie fortfahren?" : question.text}</h2>
          {question.type === "photo_open" && (
            <button onClick={() => camRef.current?.click()} className="mt-3 flex w-full items-center gap-3.5 border-2 border-vx-red p-4 text-left">
              <span className="flex size-10 flex-none items-center justify-center bg-vx-panel text-vx-red">{Ico.camera}</span>
              <span className="flex-1"><span className="block text-[16px] font-semibold">Neues Foto, Werkzeuge aufgeklappt</span>
                <span className="text-[14px] text-vx-muted">{question.text}</span></span>
              {Ico.chevron}
            </button>
          )}
          {question.type === "length" && (
            <div className="mt-3 grid border border-vx-ink" style={{ gridTemplateColumns: `repeat(${question.options.length}, minmax(0,1fr))` }}>
              {question.options.map((o, i) => (
                <button key={o.zone} className={`h-[46px] font-cond text-[16px] font-semibold uppercase ${i ? "border-l border-vx-ink" : ""}`}
                  onClick={() => rescore({ ...answers, length_zone: o.zone as Answers["length_zone"], rounds: answers.rounds + 1 })}>{o.label}</button>
              ))}
            </div>
          )}
          {question.type === "tool" && (
            <div className="mt-3 grid grid-cols-3 border border-vx-ink">
              <button className="h-[46px] font-cond text-[16px] font-semibold uppercase" onClick={() => rescore({ ...answers, tools_yes: [...answers.tools_yes, question.tool], rounds: answers.rounds + 1 })}>Ja</button>
              <button className="h-[46px] border-l border-vx-ink font-cond text-[16px] font-semibold uppercase" onClick={() => rescore({ ...answers, tools_no: [...answers.tools_no, question.tool], rounds: answers.rounds + 1 })}>Nein</button>
              <button className="h-[46px] border-l border-vx-ink font-cond text-[16px] font-semibold uppercase" onClick={() => rescore({ ...answers, rounds: answers.rounds + 1 })}>Weiss nicht</button>
            </div>
          )}
          <button className="mt-4 w-full text-center text-[15px] text-vx-muted underline" onClick={() => rescore({ ...answers, rounds: answers.rounds + 1 })}>Trotzdem Ergebnis anzeigen</button>
        </Section>
      )}

      {/* ---------- result ---------- */}
      {best && res?.ranking && (<>
        <Section className="pt-5">
          <p className="flex items-center justify-center gap-2 font-cond text-[15px] font-semibold uppercase tracking-[0.1em] text-vx-red">
            {Ico.arrowDown} {isVic ? "Passendes Victorinox-Modell" : "Bester Victorinox-Ersatz"}
          </p>
          <div className="mt-4 border border-vx-border">
            <div className="relative flex h-[260px] items-center justify-center bg-vx-stage">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={best.image} alt={best.name} className="max-h-[230px] max-w-[85%] object-contain" />
              {best.functional?.coverage != null && (
                <span className="absolute left-3 top-3 bg-vx-ink px-[9px] py-[5px] font-cond text-[13px] font-semibold uppercase tracking-[0.1em] text-white">
                  {pct(best.functional.coverage)} Funktionen abgedeckt
                </span>
              )}
              <span className="absolute right-3 top-3 flex items-center gap-1.5 bg-white px-[9px] py-[5px] text-[13px] font-semibold">
                <span className="size-2 rounded-full bg-vx-green" /> Katalog 2026
              </span>
            </div>
            <div className="px-[18px] pb-5 pt-[18px]">
              <p className="vx-eyebrow">Victorinox · Empfehlung</p>
              <h2 className="vx-h1 mt-1.5 text-[34px] leading-[34px]">{best.name}</h2>
              <p className="mt-1.5 text-[15px] text-vx-muted">Art.-Nr. <span className="font-semibold text-vx-ink">{best.id}</span>{best.length_mm ? ` · ${best.length_mm} mm` : ""}</p>
              <div className="mt-4 flex justify-between text-[14px]">
                <span className="text-vx-muted">Zuverlässigkeit</span>
                <span className="font-semibold">{LEVEL[res.ranking.level].text} · {Math.round(res.ranking.confidence * 100)}/100</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full bg-[#ececec]"><div className="h-1.5 bg-vx-red" style={{ width: `${res.ranking.confidence * 100}%` }} /></div>
              <p className="mt-2 text-[13px] text-vx-muted">Heuristischer Wert, keine kalibrierte Wahrscheinlichkeit. {res.ranking.reasons.join(" · ")}</p>
            </div>
          </div>
        </Section>

        <Section>
          <p className="vx-section">Warum dieses Produkt?</p>
          <ul className="mt-3 space-y-1">
            {best.explanation.map((e) => (
              <li key={e} className="flex gap-2.5 py-1.5 text-[16px] leading-[22.4px]"><span className="mt-0.5 flex-none text-vx-red">{Ico.check}</span>{e}</li>
            ))}
          </ul>
        </Section>

        <Section>
          <p className="vx-section">Technischer Vergleich</p>
          <div className="mt-3 grid grid-cols-2 border-l border-t border-vx-border">
            {[
              ["Länge", best.length_mm ? `${best.length_mm} mm` : "–"],
              ["Kategorie", CATEGORIES[best.category] ?? best.category],
              ["Werkzeuge (Katalog)", String(best.tools.filter((t) => t.status !== "missing").length)],
              ["Gemeinsam mit Foto", String(best.tools.filter((t) => t.status === "both").length)],
            ].map(([k, v]) => (
              <div key={k} className="border-b border-r border-vx-border px-3.5 py-3">
                <p className="text-[13px] text-vx-muted">{k}</p>
                <p className="mt-0.5 text-[17px] font-semibold">{v}</p>
              </div>
            ))}
          </div>
          <table className="mt-4 w-full text-[15px]">
            <thead><tr className="text-left text-[13px] text-vx-muted"><th className="pb-1 font-normal">Werkzeug</th><th className="pb-1 text-center font-normal">Foto</th><th className="pb-1 text-center font-normal">Victorinox</th></tr></thead>
            <tbody>
              {best.tools.map((t) => (
                <tr key={t.tool} className="border-t border-vx-line">
                  <td className="py-1.5">{t.label}</td>
                  <td className="text-center">{t.status === "both" || t.status === "missing" ? "✓" : t.status === "unknown" ? "?" : "–"}</td>
                  <td className={`text-center font-semibold ${STATUS[t.status].cls}`} title={STATUS[t.status].title}>{t.status === "missing" ? "–" : "✓"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2.5 text-[13px] italic text-vx-muted">Quelle: {best.source.doc}, S. {best.source.page_printed} · ? = auf dem Foto nicht sichtbar</p>
        </Section>

        {top.length > 1 && (
          <Section>
            <p className="vx-section">Weitere Kandidaten</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {top.slice(1, 3).map((c) => (
                <div key={c.id} className="border border-vx-border pb-3">
                  <div className="flex h-[120px] items-center justify-center bg-vx-stage">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.image} alt={c.name} className="max-h-[104px] max-w-[90%] object-contain" />
                  </div>
                  <p className="vx-h1 px-3 pt-2.5 text-[19px] leading-[22px]">{c.name}</p>
                  <p className="px-3 pt-0.5 text-[14px] text-vx-muted">{c.id} · {c.length_mm ?? "–"} mm</p>
                  {c.functional?.coverage != null && <p className="px-3 pt-1.5 text-[13px] font-semibold">{pct(c.functional.coverage)} Funktionen</p>}
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section>
          <div className="bg-vx-panel p-[18px]">
            {fb !== "done" && (<>
              <p className="vx-h1 text-[20px]">Ist die Empfehlung korrekt?</p>
              <p className="mt-0.5 text-[14px] text-vx-muted">Ihr Feedback verbessert den Agenten laufend.</p>
            </>)}
            {fb === "idle" && (
              <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                <button className="vx-btn vx-btn-outline h-[46px] text-[16px]" onClick={() => sendFeedback(best.id, true)}>{Ico.thumbUp} Korrekt</button>
                <button className="vx-btn vx-btn-outline h-[46px] text-[16px]" onClick={() => setFb("pick")}>{Ico.thumbDown} Nicht korrekt</button>
              </div>
            )}
            {fb === "pick" && (
              <div className="mt-3.5">
                <p className="font-cond text-[14px] font-semibold uppercase tracking-[0.1em] text-vx-muted">Besseren Treffer wählen</p>
                <div className="mt-2 space-y-2">
                  {top.slice(1, 4).map((c) => (
                    <button key={c.id} onClick={() => sendFeedback(c.id, false)} className="flex w-full items-center gap-3 border border-vx-border bg-white p-2 text-left">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.image} alt="" className="h-9 w-12 object-contain" />
                      <span className="flex-1 font-semibold">{c.name}</span><span className="text-[13px] text-vx-muted">{c.id}</span>
                    </button>
                  ))}
                </div>
                <input value={q} onChange={(e) => search(e.target.value)} placeholder="Produktname oder Art.-Nr. suchen"
                  className="mt-3 w-full rounded-[2px] border border-vx-border bg-white p-2.5" />
                <div className="mt-2 space-y-2">
                  {hits.map((h) => (
                    <button key={h.id} onClick={() => sendFeedback(h.id, false)} className="flex w-full items-center gap-3 border border-vx-border bg-white p-2 text-left">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={h.image} alt="" className="h-9 w-12 object-contain" />
                      <span className="flex-1">{h.name}</span><span className="text-[13px] text-vx-muted">{h.id}</span>
                    </button>
                  ))}
                </div>
                <button className="mt-2 text-[14px] text-vx-muted underline" onClick={() => setFb("idle")}>Abbrechen</button>
              </div>
            )}
            {fb === "done" && fbMsg && <p className="text-[16px] font-semibold text-vx-green">{fbMsg}</p>}
          </div>
        </Section>

        <Section>
          <button onClick={reset} className="vx-btn vx-btn-primary">{Ico.camera} Neues Messer</button>
        </Section>
      </>)}

      {res && (
        <Section>
          <details className="group border-y border-vx-line">
            <summary className="flex cursor-pointer list-none items-center gap-3.5 py-3"><span>{Ico.code}</span><span className="flex-1 text-[16px] font-semibold">Agent-Details & Quellen</span><span className="rotate-90 transition group-open:-rotate-90">{Ico.chevron}</span></summary>
            <p className="text-[12px] text-vx-muted">{res.model ?? "?"} · Prompt {res.prompt_version ?? "?"} · {JSON.stringify(res.timings)}</p>
            <pre className="mt-2 overflow-x-auto bg-vx-ink p-3 text-[11px] text-white">{JSON.stringify({ answers, extraction: res.extraction, ranking: res.ranking?.candidates.slice(0, 5).map((c) => ({ id: c.id, score: c.score, parts: c.parts })) }, null, 1)}</pre>
          </details>
        </Section>
      )}
    </main>
  );
}
