import { NextResponse } from "next/server";
import { CATALOG } from "@/lib/catalog";

/** GET ?q=spartan or ?q=1.3603 -> up to 12 catalog models (for "better match" search in the feedback sheet) */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ items: [] });
  const items = CATALOG.filter(
    (m) => m.category !== "OTHER" && (m.name.toLowerCase().includes(q) || m.id.toLowerCase().startsWith(q) || m.variants.some((v) => v.sku.toLowerCase().startsWith(q))),
  )
    .slice(0, 12)
    .map((m) => ({ id: m.id, name: m.name, length_mm: m.length_mm, image: m.image, category: m.category }));
  return NextResponse.json({ items });
}
