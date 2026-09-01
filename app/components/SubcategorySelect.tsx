"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CustomSelect } from "@/app/components/ui/CustomSelect";
import { listSubcategoriesForParent } from "@/lib/categories";
import { createClient } from "@/lib/supabase/client";
import type { SubcategoryRecord } from "@/types";

type SubcategorySelectProps = {
  categoryId: string;
  userId: string;
  value: string | null;
  onChange: (subcategoryId: string | null) => void;
  disabled?: boolean;
};

export function SubcategorySelect({
  categoryId,
  userId,
  value,
  onChange,
  disabled = false,
}: SubcategorySelectProps) {
  const [subcategories, setSubcategories] = useState<SubcategoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let active = true;

    setSubcategories([]);
    setLoadError(null);
    if (!categoryId || !userId) {
      setIsLoading(false);
      return () => {
        active = false;
      };
    }

    setIsLoading(true);
    const supabase = createClient();
    void listSubcategoriesForParent(supabase, categoryId, userId)
      .then((rows) => {
        if (!active || requestId !== requestIdRef.current) return;
        setSubcategories(rows);
        setIsLoading(false);
        if (value && !rows.some((subcategory) => subcategory.id === value)) {
          onChange(null);
        }
      })
      .catch(() => {
        if (!active || requestId !== requestIdRef.current) return;
        setSubcategories([]);
        setLoadError("Subkategori belum dapat dimuat.");
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [categoryId, userId]);

  const options = useMemo(() => [
    { value: "", label: "Tanpa subkategori" },
    ...subcategories.map((subcategory) => ({
      value: subcategory.id,
      label: subcategory.name,
    })),
  ], [subcategories]);

  if (!categoryId) return null;
  if (!isLoading && !loadError && subcategories.length === 0) return null;

  return (
    <div className="transaction-subcategory-field" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={{ fontSize: "13px", fontWeight: 500, color: "#475569" }}>
        Subkategori <small style={{ fontWeight: 400 }}>(opsional)</small>
      </span>
      <CustomSelect
        name="subcategory_id"
        value={value || ""}
        onChange={(nextValue) => onChange(nextValue || null)}
        options={options}
        placeholder={value ? "Subkategori tersimpan" : "Tanpa subkategori"}
        disabled={disabled || isLoading}
        ariaLabel="Subkategori opsional"
        ariaBusy={isLoading}
        responsiveOverlay
        selectionTitle="Pilih subkategori"
      />
      {isLoading && <small role="status">Memuat subkategori...</small>}
      {loadError && <small role="alert" style={{ color: "#b91c1c" }}>{loadError}</small>}
    </div>
  );
}
