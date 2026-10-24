"use client";

import { useRef, useState } from "react";
import type { MatchResult } from "@/lib/agent/pipeline";
import type { Answers, Extraction } from "@/lib/agent/schema";
import toolsMeta from "@/data/tools.json";

/** M2 prototype UI: several photos per knife (merged), correctable chips, follow-up questions, feedback.
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

type Res = MatchResult & { photos?: number; photo_extraction?: Extraction; model?: string; prompt_version?: string; error?: string };
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
  high: { text: "Sehr passend", cls: "bg-green-100 text-green-800" },
  medium: { text: "Wahrscheinlich passend", cls: "bg-amber-100 text-amber-800" },
  low: { text: "Unsicher", cls: "bg-gray-200 text-gray-800" },
} as const;

const STATUS = {
  both: { sym: "✓✓", cls: "text-green-700", title: "bei beiden" },
  only_victorinox: { sym: "＋", cls: "text-blue-700", title: "zusätzlich bei Victorinox" },
  missing: { sym: "–", cls: "text-red-700", title: "fehlt im Vorschlag" },
  unknown: { sym: "?", cls: "text-gray-500", title: "auf dem Foto nicht sichtbar" },
} as const;

function Chip({ on, dashed, children, onClick }: { on: boolean; dashed?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${on ? "border-red-700 bg-red-50 text-red-800" : "border-gray-300 text-gray-500"} ${dashed ? "border-dashed" : ""}`}>
      {on ? "✓ " : ""}{children}
    </button>
  );
}

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

  function reset() {
    setPhotos([]); setExtractions([]); setRes(null); setAnswers(EMPTY); setError(null); setFb("idle"); setFbMsg(null); setAddTool(false);
  }

  /** first photo of a new knife, or an additional photo of the same knife (add=true) */
  async function onFile(f: File | undefined, add: boolean) {
    if (!f) return;
    setError(null);
    if (!add) reset();
    setBusy(add ? "Weiteres Foto wird analysiert …" : "Agent analysiert das Foto …");
    try {
      const img = await resize(f);
      const prev = add ? extractions : [];
      setPhotos((p) => (add ? [...p, img] : [img]));
      const j = await postJson<Res>("/api/match", { image: img, previous: prev, answers: add ? answers : EMPTY });
      setExtractions([...prev, j.photo_extraction!]);
      setRes(j);
      setFb("idle"); setFbMsg(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6 text-gray-900">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-red-700">Product Match · Prototyp M2</p>
        <h1 className="text-2xl font-bold">Taschenmesser erkennen</h1>
        <p className="text-sm text-gray-600">
          Messer auf die <a className="underline" href="/messunterlage.pdf" target="_blank">Messunterlage</a> legen, aufklappen, von oben fotografieren.
          Für mehr Sicherheit weitere Fotos mit anderen Werkzeugen hinzufügen.
        </p>
      </header>

      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0], extractions.length > 0)} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0], extractions.length > 0)} />
      {(() => {
        // once a knife is active every new photo is added to it, until "Neues Messer"
        const open = (ref: React.RefObject<HTMLInputElement | null>, _add: boolean) => ref.current?.click();
        const hasKnife = extractions.length > 0;
        return (
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0], hasKnife); }}
            className={`rounded-2xl ${drag ? "ring-2 ring-red-700 ring-offset-4" : ""}`}
          >
            {!hasKnife ? (<>
              <button onClick={() => open(camRef, false)} disabled={!!busy}
                className="w-full rounded-xl bg-red-700 px-4 py-4 text-lg font-semibold text-white disabled:opacity-50">
                {busy ?? "Messer fotografieren"}
              </button>
              <button onClick={() => open(galleryRef, false)} disabled={!!busy}
                className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 font-medium text-gray-800 disabled:opacity-50">
                Bild aus Galerie wählen
              </button>
            </>) : (<>
              <button onClick={() => open(camRef, true)} disabled={!!busy}
                className="w-full rounded-xl bg-red-700 px-4 py-4 text-lg font-semibold text-white disabled:opacity-50">
                {busy ?? "＋ Weiteres Foto dieses Messers"}
              </button>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button onClick={() => open(galleryRef, true)} disabled={!!busy}
                  className="rounded-xl border border-gray-300 px-3 py-3 text-sm font-medium text-gray-800 disabled:opacity-50">＋ Foto aus Galerie</button>
                <button onClick={reset} disabled={!!busy}
                  className="rounded-xl border border-gray-300 px-3 py-3 text-sm font-medium text-gray-800 disabled:opacity-50">Neues Messer</button>
              </div>
            </>)}
            <p className="mt-2 hidden text-center text-xs text-gray-500 md:block">… oder ein Bild hierher ziehen</p>
          </div>
        );
      })()}
      {error && <p className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {photos.length > 0 && (
        <div className="mt-4 flex gap-2 overflow-x-auto">
          {photos.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={p} alt={`Foto ${i + 1}`} className="h-16 w-16 flex-none rounded-lg object-cover" />
          ))}
          {busy && <div className="h-16 w-16 flex-none animate-pulse rounded-lg bg-gray-200" />}
        </div>
      )}

      {ex && (
        <section className="mt-4 rounded-xl bg-gray-50 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Erkannt</span>
            <span className={`rounded px-1.5 py-0.5 text-xs ${isVic ? "bg-red-100 text-red-800" : "bg-gray-200 text-gray-700"}`}>
              {isVic ? "Victorinox" : isVic === false ? "Konkurrenzprodukt" : "Marke unklar"}
            </span>
            <span className="text-gray-600">{ex.brand ?? "Marke unbekannt"} · {res?.photos ?? extractions.length} Foto{(res?.photos ?? extractions.length) > 1 ? "s" : ""}</span>
          </div>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-500">Kategorie</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {Object.entries(CATEGORIES).filter(([k]) => ["SAK", "MULTITOOL", "ONEHAND"].includes(k) || k === ex.category).map(([k, v]) => (
              <Chip key={k} on={(answers.category ?? ex.category) === k} onClick={() => rescore({ ...answers, category: k as Answers["category"] })}>{v}</Chip>
            ))}
          </div>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-500">Länge (Schale)</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {ZONES.map((z) => (
              <Chip key={z} on={(answers.length_zone ?? ex.length_zone) === z} onClick={() => rescore({ ...answers, length_zone: z })}>{z} mm</Chip>
            ))}
          </div>
          {ex.length_estimate_mm && !answers.length_zone && <p className="mt-1 text-xs text-gray-500">gemessen ≈ {Math.round(ex.length_estimate_mm)} mm</p>}
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-500">Werkzeuge · antippen zum Korrigieren</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {shownTools.map((t) => <Chip key={t} on onClick={() => toggleTool(t as ToolKey, true)}>{TOOL_LABEL[t]?.label ?? t}</Chip>)}
            {maybeTools.map((t) => <Chip key={t} on={false} dashed onClick={() => toggleTool(t as ToolKey, false)}>{TOOL_LABEL[t]?.label ?? t}?</Chip>)}
            <button onClick={() => setAddTool((v) => !v)} className="rounded-full border border-dashed border-gray-400 px-3 py-1 text-sm text-gray-600">＋ Werkzeug</button>
          </div>
          {addTool && (
            <select className="mt-2 w-full rounded-lg border p-2" defaultValue=""
              onChange={(e) => { const t = e.target.value as ToolKey; setAddTool(false); if (t) toggleTool(t, false); }}>
              <option value="">Werkzeug hinzufügen …</option>
              {TOOL_IDS.filter((t) => !shownTools.includes(t)).map((t) => <option key={t} value={t}>{TOOL_LABEL[t].label}</option>)}
            </select>
          )}
        </section>
      )}

      {res?.status === "rejected" && (
        <p className="mt-6 rounded-lg bg-gray-100 p-4">Auf dem Foto ist kein Taschenmesser erkennbar. Bitte nochmals fotografieren.</p>
      )}

      {question && (
        <section className="mt-6 rounded-xl border-2 border-red-700 p-4">
          <p className="font-semibold">{question.text}</p>
          <p className="mt-1 text-sm text-gray-600">{question.reason}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {question.type === "photo_open" && (
              <button className="rounded-lg bg-red-700 px-4 py-2 text-white" onClick={() => camRef.current?.click()}>Weiteres Foto</button>
            )}
            {question.type === "length" && question.options.map((o) => (
              <button key={o.zone} className="rounded-lg bg-red-700 px-4 py-2 text-white"
                onClick={() => rescore({ ...answers, length_zone: o.zone as Answers["length_zone"], rounds: answers.rounds + 1 })}>{o.label}</button>
            ))}
            {question.type === "tool" && (<>
              <button className="rounded-lg bg-red-700 px-4 py-2 text-white" onClick={() => rescore({ ...answers, tools_yes: [...answers.tools_yes, question.tool], rounds: answers.rounds + 1 })}>Ja</button>
              <button className="rounded-lg bg-red-700 px-4 py-2 text-white" onClick={() => rescore({ ...answers, tools_no: [...answers.tools_no, question.tool], rounds: answers.rounds + 1 })}>Nein</button>
            </>)}
            <button className="rounded-lg border px-4 py-2" onClick={() => rescore({ ...answers, rounds: answers.rounds + 1 })}>Überspringen</button>
          </div>
        </section>
      )}

      {top.length > 0 && res?.ranking && (
        <section className="mt-6">
          <div className="rounded-xl border p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL[res.ranking.level].cls}`}>
                {LEVEL[res.ranking.level].text} · {Math.round(res.ranking.confidence * 100)} %
              </span>
              <span className="text-xs text-gray-500">Aktuell erhältlich</span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={top[0].image} alt={top[0].name} className="mx-auto my-3 h-44 object-contain" />
            <h2 className="text-xl font-bold">{top[0].name}</h2>
            <p className="font-mono text-sm text-gray-600">{top[0].id} · {top[0].length_mm ? `${top[0].length_mm} mm` : "Länge –"}</p>
            <p className="mt-1 text-xs text-gray-500">{res.ranking.reasons.join(" · ")}</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {top[0].explanation.map((e) => <li key={e}>{e}</li>)}
            </ul>
            <table className="mt-4 w-full text-sm">
              <thead><tr className="text-left text-gray-500"><th className="font-normal">Werkzeug</th><th className="font-normal">Vergleich</th></tr></thead>
              <tbody>
                {top[0].tools.map((t) => (
                  <tr key={t.tool} className="border-t"><td className="py-1">{t.label}</td>
                    <td className={STATUS[t.status].cls} title={STATUS[t.status].title}>{STATUS[t.status].sym}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-gray-500">✓✓ bei beiden · ＋ zusätzlich bei Victorinox · – fehlt im Vorschlag · ? nicht sichtbar</p>
            <p className="mt-1 text-xs text-gray-500">Quelle: {top[0].source.doc}, S. {top[0].source.page_printed}</p>

            {/* feedback */}
            <div className="mt-4 border-t pt-3">
              {fb === "idle" && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Passt der Vorschlag?</span>
                  <button className="rounded-lg border px-3 py-1" onClick={() => sendFeedback(top[0].id, true)}>👍</button>
                  <button className="rounded-lg border px-3 py-1" onClick={() => setFb("pick")}>👎</button>
                </div>
              )}
              {fb === "pick" && (
                <div className="text-sm">
                  <p className="font-medium">Welches Modell wäre richtig?</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {top.slice(1, 4).map((c) => (
                      <button key={c.id} className="rounded-lg border px-3 py-1" onClick={() => sendFeedback(c.id, false)}>{c.name} <span className="font-mono text-xs text-gray-500">{c.id}</span></button>
                    ))}
                  </div>
                  <input value={q} onChange={(e) => search(e.target.value)} placeholder="Im Katalog suchen (Name oder Artikelnummer)"
                    className="mt-3 w-full rounded-lg border p-2" />
                  <div className="mt-2 space-y-1">
                    {hits.map((h) => (
                      <button key={h.id} onClick={() => sendFeedback(h.id, false)} className="flex w-full items-center gap-2 rounded-lg border p-2 text-left">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={h.image} alt="" className="h-8 w-12 object-contain" />
                        <span>{h.name}</span><span className="ml-auto font-mono text-xs text-gray-500">{h.id}</span>
                      </button>
                    ))}
                  </div>
                  <button className="mt-2 text-xs text-gray-500 underline" onClick={() => setFb("idle")}>Abbrechen</button>
                </div>
              )}
              {fb === "done" && fbMsg && <p className="text-sm text-green-800">{fbMsg}</p>}
            </div>
          </div>

          <h3 className="mt-6 text-sm font-semibold text-gray-600">Alternativen</h3>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {top.slice(1, 3).map((c) => (
              <div key={c.id} className="rounded-lg border p-3 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.image} alt={c.name} className="mx-auto h-20 object-contain" />
                <p className="mt-2 font-semibold">{c.name}</p>
                <p className="font-mono text-xs text-gray-600">{c.id} · {c.length_mm ?? "–"} mm</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {res && (
        <details className="mt-8 text-xs">
          <summary className="cursor-pointer text-gray-500">Debug ({res.model ?? "?"}, Prompt {res.prompt_version ?? "?"}, {JSON.stringify(res.timings)})</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-gray-100 p-2">{JSON.stringify({ answers, extraction: res.extraction, ranking: res.ranking?.candidates.slice(0, 5).map((c) => ({ id: c.id, score: c.score, parts: c.parts })) }, null, 1)}</pre>
        </details>
      )}
    </main>
  );
}
