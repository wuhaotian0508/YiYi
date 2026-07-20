"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Plus, Search } from "lucide-react";
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from "motion/react";
import { YiYiMark } from "@/components/brand/yiyi-mark";
import { Garment } from "@/components/wardrobe/garment";
import { copy } from "@/content/copy";
import type { WardrobeItem } from "@/domain/schemas";
import { wardrobeFilterLabels } from "@/domain/taxonomy";
import { db, seedWardrobe } from "@/lib/storage/db";
import { demoWardrobe } from "@/mocks/wardrobe";

export function WardrobePanel({ embedded = false, onBack }: { embedded?: boolean; onBack?: () => void }) {
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [filter, setFilter] = useState<(typeof wardrobeFilterLabels)[number]>("All");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => { void seedWardrobe(demoWardrobe).then(() => db.wardrobeItems.toArray()).then(setItems); }, []);
  const filterCategory: Partial<Record<(typeof wardrobeFilterLabels)[number], WardrobeItem["category"]>> = { Tops: "top", Bottoms: "bottom", Outerwear: "outerwear", Shoes: "shoes" };
  const shown = items.filter((item) => {
    const filterMatch = filter === "All" || (filter === "Accessories" ? ["bag", "jewelry", "headwear", "scarf", "belt", "eyewear", "hair_accessory", "other_accessory"].includes(item.category) : item.category === filterCategory[filter]);
    return filterMatch && (!query.trim() || `${item.subtype} ${item.primaryColor} ${item.materials.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  });
  const content = <div className="page-column">
      <header className="wardrobe-header">{embedded ? <button className="icon-button wardrobe-back" type="button" onClick={onBack} aria-label="Back to Today"><ChevronLeft size={21} /></button> : <Link className="icon-button wardrobe-back" href="/today" aria-label="Back to Today"><ChevronLeft size={21} /></Link>}<h1>{copy.wardrobe.title}</h1><button className="icon-button" aria-label="Search wardrobe" onClick={() => { setSearching((value) => !value); setQuery(""); }}><Search size={20} /></button><Link className="icon-button" href="/wardrobe/add" aria-label="Add item"><Plus size={22} /></Link></header>
      <motion.div className="wardrobe-search-region" layout><AnimatePresence initial={false}>{searching && <motion.input autoFocus className="wardrobe-search" aria-label="Search items" placeholder="Search color, material, or item" value={query} onChange={(event) => setQuery(event.target.value)} initial={{ opacity: 0, transform: "translateY(-4px)" }} animate={{ opacity: 1, transform: "translateY(0)" }} exit={{ opacity: 0, transform: "translateY(-3px)" }} transition={{ duration: .18, ease: [.23, 1, .32, 1] }} />}</AnimatePresence></motion.div>
      <motion.div className="wardrobe-filter-rail" layout="position">{wardrobeFilterLabels.map((label) => <button key={label} className={`chip ${filter === label ? "selected" : ""}`} onClick={() => setFilter(label)}>{label}</button>)}</motion.div>
      {shown.length ? <motion.div className="wardrobe-grid" layout="position"><AnimatePresence initial={false} mode="popLayout">{shown.map((item) => <WardrobeTile item={item} key={item.id} />)}</AnimatePresence></motion.div> : <div className="center-stage wardrobe-empty"><div><YiYiMark size={62} /><h2>{query ? "No matching items" : copy.wardrobe.empty}</h2><p className="secondary-copy">{query ? "Try another color, material, or category." : copy.wardrobe.emptyBody}</p>{!query && <Link href="/wardrobe/add" className="primary-button">{copy.wardrobe.add}</Link>}</div></div>}
      <p className="secondary-copy wardrobe-count">{shown.length} items</p>
    </div>;
  return embedded ? <section className="wardrobe-page wardrobe-slide-panel" aria-label="Wardrobe page">{content}</section> : <main className="phone-page wardrobe-page">{content}</main>;
}

function WardrobeTile({ item }: { item: WardrobeItem }) {
  const isPresent = useIsPresent();
  const reduceMotion = useReducedMotionConfig();
  return <motion.div
    layout
    aria-hidden={!isPresent}
    inert={!isPresent ? true : undefined}
    style={{ pointerEvents: isPresent ? "auto" : "none" }}
    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "scale(.985)" }}
    animate={{ opacity: 1, transform: "scale(1)" }}
    exit={{ opacity: 0, transform: "scale(.985)" }}
    transition={{ duration: reduceMotion ? .1 : .17, ease: [.23, 1, .32, 1] }}
  ><Link href={`/wardrobe/${item.id}`} className="wardrobe-tile"><Garment item={item} />{item.availability !== "available" && <span className="chip wardrobe-status">{item.availability === "laundry" ? "In laundry" : "Unavailable"}</span>}<span className="tile-label">{item.subtype}</span></Link></motion.div>;
}

export default function WardrobePage() { return <WardrobePanel />; }
