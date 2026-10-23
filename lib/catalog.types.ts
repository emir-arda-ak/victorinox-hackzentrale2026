// Generated from data/tools.json + data/catalog.json — do not edit by hand

export const TOOL_IDS = [
  "blade_serrated",
  "blade_hook",
  "blade_gutting",
  "blade_cheese",
  "blade_cable",
  "blade_small",
  "blade_large",
  "scissors",
  "saw_wood",
  "saw_metal",
  "saw_glass",
  "pliers",
  "corkscrew",
  "corkscrew_coupling",
  "can_opener",
  "bottle_opener",
  "phillips",
  "ratchet",
  "bits",
  "screwdriver",
  "awl",
  "marlinspike",
  "hook",
  "chisel",
  "fish_scaler",
  "letter_opener",
  "fork",
  "peeler",
  "magnifier",
  "ruler",
  "nail_file",
  "nail_cleaner",
  "nail_clipper",
  "wire_stripper",
  "wire_cutter",
  "wire_bender",
  "crimper",
  "scraper",
  "crate_opener",
  "seatbelt_cutter",
  "glass_breaker",
  "shackle_opener",
  "hoof_cleaner",
  "bark_lifter",
  "pen",
  "led",
  "tweezers",
  "toothpick",
  "pin",
  "key_ring",
  "clip",
  "thumb_stud",
  "lanyard_hole",
  "fire",
  "foil_cutter",
  "other",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export type Visibility = "prominent" | "normal" | "hidden";

export const CATEGORIES = ["FIXED", "GARDEN", "MULTITOOL", "ONEHAND", "OTHER", "SAK", "SWISSCARD"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Variant {
  sku: string;
  blister: boolean; // .B1 = Blisterverpackung
  color: { hex: string; name: string } | null; // aus dem Farbfeld im Katalog gemessen
}

export interface CatalogModel {
  id: string; // Modell-Artikelnummer
  name: string;
  name_catalog: string;
  category: Category;
  segment: string;
  length_mm: number | null; // fehlt bei Multitools, Einhandmessern, Swiss Cards
  function_count: number;
  tools_raw: string[]; // Katalog-Wortlaut, "– " = Teilfunktion des vorherigen Werkzeugs
  tools: ToolId[]; // kanonisch, Hauptwerkzeuge
  subtools: ToolId[]; // kanonisch, nur als Teilfunktion vorhanden
  scale_material: string | null;
  notes: string[];
  variants: Variant[];
  status: "active";
  source: { doc: string; page_printed: number; page_pdf: number };
  image: string; // Pfad unter /public
}

export type ToolMeta = Record<ToolId, { label: string; visibility: Visibility }>;
