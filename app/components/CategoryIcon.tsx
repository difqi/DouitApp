"use client";

import { createElement, type ComponentType, type SVGProps } from "react";
import {
  ArrowLeftRight,
  BadgeDollarSign,
  Book,
  Box,
  Briefcase,
  Car,
  Coffee,
  Folder,
  Gift,
  Heart,
  Home,
  LayoutGrid,
  PiggyBank,
  Receipt,
  ShoppingBag,
  Smartphone,
  Tags,
  Ticket,
  Utensils,
} from "lucide-react";

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>;

export type CategoryVisualMetadata = {
  name?: string | null;
  icon_name?: string | null;
  color_hex?: string | null;
  type?: string | null;
  is_system?: boolean | null;
};

export const CATEGORY_ICON_OPTIONS = [
  "Folder",
  "ShoppingBag",
  "Coffee",
  "Car",
  "Home",
  "Smartphone",
  "Briefcase",
  "Heart",
  "Book",
  "Box",
  "Tags",
  "Receipt",
] as const;

const iconByKey: Record<string, LucideIcon> = {
  ArrowLeftRight,
  BadgeDollarSign,
  Book,
  Box,
  Briefcase,
  Car,
  Coffee,
  Folder,
  Gift,
  Heart,
  Home,
  LayoutGrid,
  PiggyBank,
  Receipt,
  ShoppingBag,
  Smartphone,
  Tags,
  Ticket,
  Utensils,
};

const systemIconKey = (name?: string | null) => {
  const normalized = (name || "").trim().toLocaleLowerCase("id-ID");

  if (normalized.includes("makanan") || normalized.includes("minuman")) return "Utensils";
  if (normalized.includes("transport")) return "Car";
  if (normalized.includes("belanja")) return "ShoppingBag";
  if (normalized.includes("tagihan") || normalized.includes("biaya admin")) return "Receipt";
  if (normalized.includes("barang digital")) return "Smartphone";
  if (normalized.includes("hiburan")) return "Ticket";
  if (normalized.includes("gaji")) return "BadgeDollarSign";
  if (["transfer", "pindah saldo", "transfer antar rekening"].includes(normalized)) return "ArrowLeftRight";
  if (normalized.includes("jasa") || normalized.includes("freelance")) return "Briefcase";
  if (normalized.includes("bonus")) return "Gift";
  if (normalized.includes("nabung")) return "PiggyBank";
  return "LayoutGrid";
};

export function resolveCategoryIcon(category?: CategoryVisualMetadata | string | null): LucideIcon {
  const metadata = typeof category === "string" ? { name: category } : category;
  const storedIcon = metadata?.icon_name?.trim();
  if (storedIcon && iconByKey[storedIcon]) return iconByKey[storedIcon];
  return iconByKey[systemIconKey(metadata?.name)] || LayoutGrid;
}

export function resolveCategoryColor(category?: CategoryVisualMetadata | string | null) {
  if (typeof category !== "string" && /^#[0-9a-f]{6}$/i.test(category?.color_hex || "")) {
    return category?.color_hex as string;
  }
  return "#16825d";
}

export function CategoryIcon({
  category,
  size = 16,
  className,
}: {
  category?: CategoryVisualMetadata | string | null;
  size?: number;
  className?: string;
}) {
  const Icon = resolveCategoryIcon(category);
  return createElement(Icon, { "aria-hidden": true, className, height: size, width: size });
}
