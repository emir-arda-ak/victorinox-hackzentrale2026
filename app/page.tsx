"use client";

import { useRef, useState } from "react";
import type { MatchResult } from "@/lib/agent/pipeline";
import type { Answers } from "@/lib/agent/schema";
import toolsMeta from "@/data/tools.json";

/** M1 prototype UI: photo -> /api/match -> result, follow-up question -> /api/score. Hainings Design ersetzt das später. */

const TOOL_LABEL = toolsMeta as Record<string, { label: string }>;
const EMPTY: Answers = { tools_yes: [], tools_no: [], length_zone: null, rounds: 0 };

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

const LEVEL = {
  high: { text: "Sehr passend", cls: "bg-green-100 text-green-800" },
  medium: { text: "Wahrscheinlich passend", cls: "bg-amber-100 text-amber-800" },
  low: { text: "Unsicher", cls: "bg-gray-200 text-gray-800" },
} as const;

const STATUS = {
  both: { sym: "✓✓", cls: "text-green-700" },
  only_victorinox: { sym: "＋", cls: "text-blue-700" },
  missing: { sym: "–", cls: "text-red-700" },
  unknown: { sym: "?", cls: "text-gray-500" },
} as const;

export default function Home() {
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<(MatchResult & { error?: string }) | null>(null);
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    setRes(null);
    setAnswers(EMPTY);
    setBusy("Bild wird vorbereitet …");
    try {
      const img = await resize(f);
      setPhoto(img);
      setBusy("Agent analysiert das Foto …");
      const r = await fetch("/api/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: img }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setRes(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  async function answer(next: Answers) {
    if (!res) return;
    setAnswers(next);
    setBusy("Neu berechnen …");
    const r = await fetch("/api/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extraction: res.extraction, answers: next }) });
    const j = await r.json();
    setBusy(null);
    if (!r.ok) return setError(j.error ?? r.statusText);
    setRes({ ...j, model: res.model, timings: { ...res.timings, ...j.timings } });
  }

  const ex = res?.extraction;
  const top = res?.ranking?.candidates ?? [];
  const q = res?.question;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6 text-gray-900">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-red-700">Product Match · Prototyp M1</p>
        <h1 className="text-2xl font-bold">Taschenmesser erkennen</h1>
        <p className="text-sm text-gray-600">
          Messer auf die <a className="underline" href="/messunterlage.pdf" target="_blank">Messunterlage</a> legen, aufklappen, von oben fotografieren.
        </p>
      </header>

      {/* two inputs: "capture" forces the camera on phones, the second one opens gallery / file picker */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
        className={`rounded-2xl ${drag ? "ring-2 ring-red-700 ring-offset-4" : ""}`}
      >
        <button onClick={() => fileRef.current?.click()} disabled={!!busy}
          className="w-full rounded-xl bg-red-700 px-4 py-4 text-lg font-semibold text-white disabled:opacity-50">
          {busy ?? "Messer fotografieren"}
        </button>
        <button onClick={() => galleryRef.current?.click()} disabled={!!busy}
          className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 font-medium text-gray-800 disabled:opacity-50">
          Bild aus Galerie wählen
        </button>
        <p className="mt-2 hidden text-center text-xs text-gray-500 md:block">… oder ein Bild hierher ziehen</p>
      </div>
      {error && <p className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {photo && (
        <section className="mt-6 flex gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="Foto" className="h-28 w-28 rounded-lg object-cover" />
          {ex && (
            <ul className="space-y-1 text-sm">
              <li>✓ Kategorie: <b>{ex.category}</b></li>
              <li>✓ Marke: <b>{ex.brand ?? "unbekannt"}</b>{" "}
                <span className={`rounded px-1.5 py-0.5 text-xs ${ex.is_victorinox ? "bg-red-100 text-red-800" : "bg-gray-200 text-gray-700"}`}>
                  {ex.is_victorinox ? "Victorinox" : ex.is_victorinox === false ? "Konkurrenzprodukt" : "Marke unklar"}
                </span></li>
              <li>✓ Länge: <b>{answers.length_zone ?? ex.length_zone ?? "nicht gemessen"}</b>{ex.length_zone && !answers.length_zone ? ` (${Math.round(ex.length_zone_confidence * 100)} %)` : ""}</li>
              <li>✓ {ex.tools_seen.length} Werkzeuge erkannt</li>
            </ul>
          )}
        </section>
      )}

      {res?.status === "rejected" && (
        <p className="mt-6 rounded-lg bg-gray-100 p-4">Auf dem Foto ist kein Taschenmesser erkennbar. Bitte nochmals fotografieren.</p>
      )}

      {q && (
        <section className="mt-6 rounded-xl border-2 border-red-700 p-4">
          <p className="font-semibold">{q.text}</p>
          <p className="mt-1 text-sm text-gray-600">{q.reason}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {q.type === "photo_open" && (
              <button className="rounded-lg bg-red-700 px-4 py-2 text-white" onClick={() => fileRef.current?.click()}>Neues Foto</button>
            )}
            {q.type === "length" && q.options.map((o) => (
              <button key={o.zone} className="rounded-lg bg-red-700 px-4 py-2 text-white"
                onClick={() => answer({ ...answers, length_zone: o.zone as Answers["length_zone"], rounds: answers.rounds + 1 })}>{o.label}</button>
            ))}
            {q.type === "tool" && (<>
              <button className="rounded-lg bg-red-700 px-4 py-2 text-white" onClick={() => answer({ ...answers, tools_yes: [...answers.tools_yes, q.tool], rounds: answers.rounds + 1 })}>Ja</button>
              <button className="rounded-lg bg-red-700 px-4 py-2 text-white" onClick={() => answer({ ...answers, tools_no: [...answers.tools_no, q.tool], rounds: answers.rounds + 1 })}>Nein</button>
            </>)}
            <button className="rounded-lg border px-4 py-2" onClick={() => answer({ ...answers, rounds: answers.rounds + 1 })}>Überspringen</button>
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
                    <td className={STATUS[t.status].cls}>{STATUS[t.status].sym}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-gray-500">Quelle: {top[0].source.doc}, S. {top[0].source.page_printed}</p>
          </div>

          <h3 className="mt-6 text-sm font-semibold text-gray-600">Alternativen</h3>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {top.slice(1, 3).map((c) => (
              <div key={c.id} className="rounded-lg border p-3 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.image} alt={c.name} className="mx-auto h-20 object-contain" />
                <p className="mt-2 font-semibold">{c.name}</p>
                <p className="font-mono text-xs text-gray-600">{c.id} · {c.length_mm ?? "–"} mm · {c.score}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {res && (
        <details className="mt-8 text-xs">
          <summary className="cursor-pointer text-gray-500">Debug ({res.model ?? "?"}, {JSON.stringify(res.timings)})</summary>
          <p className="mt-2">Erkannte Werkzeuge: {ex?.tools_seen.map((t) => TOOL_LABEL[t]?.label ?? t).join(", ")}</p>
          <pre className="mt-2 overflow-x-auto rounded bg-gray-100 p-2">{JSON.stringify(res, null, 1)}</pre>
        </details>
      )}
    </main>
  );
}
