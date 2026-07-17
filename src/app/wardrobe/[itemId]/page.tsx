"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronLeft } from "lucide-react";
import { Garment } from "@/components/wardrobe/garment";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { colorHex, colorLabels } from "@/domain/taxonomy";
import { db } from "@/lib/storage/db";

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams<{ itemId: string }>();
  const item = useLiveQuery(() => db.wardrobeItems.get(params.itemId), [params.itemId]);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    await db.transaction("rw", db.wardrobeItems, db.itemImages, async () => {
      await db.wardrobeItems.delete(item.id);
      await db.itemImages.delete(item.id);
    });
    router.replace("/wardrobe");
  }

  return <main className="phone-page"><div className="page-column"><header className="topbar"><Link href="/wardrobe" className="icon-button" aria-label="Back"><ChevronLeft /></Link><span /><span /></header><div className="item-detail-visual"><Garment item={item} /></div><div className="item-detail-dots">● <span>•••</span></div><div>{rows.map(([label, value]) => <div className="attribute-row" key={label}><span>{label}</span><span className={label === "Availability" ? "availability-value" : "attribute-value"}>{label === "Color" && <i style={{ width: 10, height: 10, borderRadius: "50%", background: colorHex[item.primaryColor] }} />}{value}{label === "Availability" && <Check size={14} />}</span></div>)}</div><div className="item-detail-actions"><SecondaryButton onClick={() => void toggleAvailability()}>{item.availability === "available" ? "Mark as unavailable" : "Mark as available"}</SecondaryButton>{confirmDelete ? <div className="delete-confirm"><p>Delete this item and its local images?</p><div><SecondaryButton onClick={() => setConfirmDelete(false)}>Keep item</SecondaryButton><PrimaryButton onClick={() => void deleteItem()}>Delete</PrimaryButton></div></div> : <button className="secondary-button danger-button" onClick={() => setConfirmDelete(true)}>Delete item</button>}</div></div></main>;
}
