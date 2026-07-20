"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronLeft } from "lucide-react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { Garment } from "@/components/wardrobe/garment";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { colorHex, colorLabels } from "@/domain/taxonomy";
import { db, setExperienceMode } from "@/lib/storage/db";
import { calmSpring } from "@/lib/motion/tokens";

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams<{ itemId: string }>();
  const item = useLiveQuery(() => db.wardrobeItems.get(params.itemId), [params.itemId]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const reduceMotion = useReducedMotionConfig();
  if (item === undefined) return <main className="phone-page"><div className="page-column"><div className="center-stage"><p className="secondary-copy">Loading item…</p></div></div></main>;
  if (!item) return <main className="phone-page"><div className="page-column"><div className="center-stage"><div><h1 className="page-title">Item not found</h1><Link className="primary-button" href="/wardrobe">Back to wardrobe</Link></div></div></div></main>;
  const rows = [
    ["Category", item.subtype],
    ["Color", colorLabels[item.primaryColor]],
    ["Material", item.materials.join(", ")],
    ["Fit", item.fit[0].toUpperCase() + item.fit.slice(1)],
    ["Warmth", `${item.warmth} / 5`],
    ["Formality", `${item.formality} / 5`],
    ["Style", item.styleTags.slice(0, 2).map((tag) => tag[0].toUpperCase() + tag.slice(1)).join(", ")],
    ["Availability", item.availability === "available" ? "In wardrobe" : item.availability === "laundry" ? "In laundry" : "Unavailable"],
  ];

  async function toggleAvailability() {
    if (!item) return;
    const availability = item.availability === "available" ? "unavailable" : "available";
    await db.wardrobeItems.update(item.id, { availability, unavailableReason: availability === "available" ? undefined : "Marked manually", updatedAt: Date.now() });
  }

  async function deleteItem() {
    if (!item) return;
    await setExperienceMode("personal");
    await db.transaction("rw", db.wardrobeItems, db.itemImages, async () => {
      await db.wardrobeItems.delete(item.id);
      await db.itemImages.delete(item.id);
    });
    router.replace("/wardrobe");
  }

  return <main className="phone-page"><div className="page-column"><header className="topbar"><Link href="/wardrobe" className="icon-button" aria-label="Back"><ChevronLeft /></Link><span /><span /></header><motion.div className="item-detail-visual" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(7px) scale(.96)" }} animate={{ opacity: 1, transform: "translateY(0) scale(1)" }} transition={reduceMotion ? { duration: .12 } : calmSpring}><Garment item={item} /></motion.div><motion.div className="item-detail-information" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px)" }} animate={{ opacity: 1, transform: "translateY(0)" }} transition={{ duration: reduceMotion ? .1 : .22, ease: [.23, 1, .32, 1] }}><header className="item-detail-heading"><h1>{item.subtype}</h1><p>{item.category.replaceAll("_", " ")}</p></header><div className="item-detail-attributes">{rows.map(([label, value]) => <div className="attribute-row" key={label}><span>{label}</span><span className={label === "Availability" ? "availability-value" : "attribute-value"}>{label === "Color" && <i style={{ width: 10, height: 10, borderRadius: "50%", background: colorHex[item.primaryColor] }} />}{value}{label === "Availability" && <Check size={14} />}</span></div>)}</div></motion.div><div className="item-detail-actions"><SecondaryButton onClick={() => void toggleAvailability()}>{item.availability === "available" ? "Mark as unavailable" : "Mark as available"}</SecondaryButton><AnimatePresence mode="wait" initial={false}>{confirmDelete ? <motion.div className="delete-confirm" key="confirm" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(5px)" }} animate={{ opacity: 1, transform: "translateY(0)" }} exit={{ opacity: 0 }}><p>Delete this item and its local images?</p><div><SecondaryButton onClick={() => setConfirmDelete(false)}>Keep item</SecondaryButton><PrimaryButton onClick={() => void deleteItem()}>Delete</PrimaryButton></div></motion.div> : <motion.button key="delete" className="secondary-button danger-button" onClick={() => setConfirmDelete(true)} initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Delete item</motion.button>}</AnimatePresence></div></div></main>;
}
