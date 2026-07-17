"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Garment } from "@/components/wardrobe/garment";
import { copy } from "@/content/copy";
import { wardrobeFilterLabels } from "@/domain/taxonomy";
import type { WardrobeItem } from "@/domain/schemas";
import { db, seedWardrobe } from "@/lib/storage/db";
import { demoWardrobe } from "@/mocks/wardrobe";

export default function WardrobePage() {
  const [items, setItems] = useState<WardrobeItem[]>(demoWardrobe);
  const [filter, setFilter] = useState<(typeof wardrobeFilterLabels)[number]>("All");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => { void seedWardrobe(demoWardrobe).then(() => db.wardrobeItems.toArray()).then(setItems); }, []);
  const filterCategory: Partial<Record<(typeof wardrobeFilterLabels)[number], WardrobeItem["category"]>> = { Tops: "top", Bottoms: "bottom", Outerwear: "outerwear", Shoes: "shoes" };
  const shown = items.filter((item) => {
    const filterMatch = filter === "All" || (filter === "Accessories" ? ["bag", "jewelry", "headwear", "scarf", "belt", "eyewear", "hair_accessory", "other_accessory"].includes(item.category) : item.category === filterCategory[filter]);
    return filterMatch && (!query.trim() || `${item.subtype} ${item.primaryColor} ${item.materials.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  });
  return <main className="phone-page"><div className="page-column"><header style={{ display: "flex", alignItems: "center", minHeight: 52 }}><h1 style={{ fontSize: 24, fontWeight: 650, letterSpacing: "-.025em", flex: 1 }}>{copy.wardrobe.title}</h1><button className="icon-button" aria-label="Search wardrobe" onClick={() => { setSearching((value) => !value); setQuery(""); }}><Search size={20} /></button><Link className="icon-button" href="/wardrobe/add" aria-label="Add item"><Plus size={22} /></Link></header>{searching && <input autoFocus className="wardrobe-search" aria-label="Search items" placeholder="Search color, material, or item" value={query} onChange={(event) => setQuery(event.target.value)} />}<div style={{ display: "flex", overflowX: "auto", gap: 6, margin: "4px -20px 16px", padding: "0 20px", scrollbarWidth: "none" }}>{wardrobeFilterLabels.map((label) => <button key={label} className={`chip ${filter === label ? "selected" : ""}`} onClick={() => setFilter(label)}>{label}</button>)}</div>{shown.length ? <div className="wardrobe-grid">{shown.map((item) => <Link href={`/wardrobe/${item.id}`} className="wardrobe-tile" key={item.id}><Garment item={item} />{item.availability !== "available" && <span className="chip" style={{ position: "absolute", left: 4, bottom: 21, minHeight: 22, padding: "0 6px", fontSize: 9 }}>{item.availability === "laundry" ? "In laundry" : "Unavailable"}</span>}<span className="tile-label">{item.subtype}</span></Link>)}</div> : <div className="center-stage"><div><div style={{ fontSize: 56 }}>♧</div><h2>{query ? "No matching items" : copy.wardrobe.empty}</h2><p className="secondary-copy">{query ? "Try another color, material, or category." : copy.wardrobe.emptyBody}</p>{!query && <Link href="/wardrobe/add" className="primary-button">{copy.wardrobe.add}</Link>}</div></div>}<p className="secondary-copy" style={{ textAlign: "center", marginTop: "auto", paddingTop: 20 }}>{shown.length} items</p></div></main>;
}
