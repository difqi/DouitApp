"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Calendar as CalendarIcon } from "lucide-react";

interface CustomDatePickerProps {
  value?: string; // Format: YYYY-MM-DD
  onChange: (dateString: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  label?: string;
  disabled?: boolean;
  name?: string;
  min?: string;
  align?: "left" | "right";
  position?: "bottom" | "top";
}

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

const DAY_NAMES = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

function parseLocalDate(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split("T")[0].split("-");
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m, d);
    }
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatToYYYYMMDD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function CustomDatePicker({
  value,
  onChange,
  placeholder = "dd/mm/yyyy",
  className = "",
  buttonClassName = "",
  label,
  disabled = false,
  name,
  min,
  align = "left",
  position = "bottom",
}: CustomDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse initial date
  const parsedDate = parseLocalDate(value);
  const initialValidDate = parsedDate || new Date();

  const [currentMonth, setCurrentMonth] = useState(initialValidDate.getMonth());
  const [currentYear, setCurrentYear] = useState(initialValidDate.getFullYear());
  const [tempSelectedDate, setTempSelectedDate] = useState<Date | null>(parsedDate);

  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [isYearPickerOpen, setIsYearPickerOpen] = useState(false);

  // Sync internal state when value prop changes
  useEffect(() => {
    const d = parseLocalDate(value);
    if (d) {
      setTempSelectedDate(d);
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
    } else {
      setTempSelectedDate(null);
    }
  }, [value]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsMonthPickerOpen(false);
        setIsYearPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Calendar calculations
  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
  const totalDaysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const totalDaysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((prev) => prev - 1);
    } else {
      setCurrentMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((prev) => prev + 1);
    } else {
      setCurrentMonth((prev) => prev + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    const selected = new Date(currentYear, currentMonth, day);
    setTempSelectedDate(selected);
  };

  const handleConfirmDate = () => {
    if (tempSelectedDate) {
      onChange(formatToYYYYMMDD(tempSelectedDate));
    }
    setIsOpen(false);
    setIsMonthPickerOpen(false);
    setIsYearPickerOpen(false);
  };

  const formatDisplayDate = (dateString?: string) => {
    const d = parseLocalDate(dateString);
    if (!d) return "";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  return (
    <div className={`relative w-full ${className}`} ref={containerRef}>
      {/* Hidden input for form data serialization */}
      {name && <input type="hidden" name={name} value={value || ""} />}

      {label && (
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
          {label}
        </label>
      )}

      {/* Trigger Input Display */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev);
            setIsMonthPickerOpen(false);
            setIsYearPickerOpen(false);
          }
        }}
        className={`w-full flex items-center justify-between px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 shadow-xs transition-all hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 cursor-pointer ${
          disabled ? "opacity-50 cursor-not-allowed bg-slate-50" : ""
        } ${buttonClassName}`}
      >
        <span className={!value ? "text-slate-400 font-normal truncate" : "text-slate-900 font-medium truncate"}>
          {value ? formatDisplayDate(value) : placeholder}
        </span>
        <CalendarIcon className="w-4 h-4 text-emerald-600/80 shrink-0 ml-2" />
      </button>

      {/* Date Picker Popover */}
      {isOpen && (
        <div
          className={`absolute z-50 w-72 bg-[#FAF9F5] border border-amber-950/10 rounded-2xl p-4 shadow-2xl shadow-slate-900/15 animate-in fade-in-0 zoom-in-95 duration-150 ${
            position === "top" ? "bottom-full mb-2" : "top-full mt-2"
          } ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {/* Header Month / Year & Chevrons */}
          <div className="flex items-center justify-between mb-3 relative">
            <div className="flex items-center gap-1">
              {/* Month Dropdown Trigger */}
              <button
                type="button"
                onClick={() => {
                  setIsMonthPickerOpen((prev) => !prev);
                  setIsYearPickerOpen(false);
                }}
                className="text-xs font-bold text-slate-800 hover:bg-emerald-600/10 hover:text-emerald-900 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
              >
                {MONTH_NAMES[currentMonth]}
                <ChevronDown className={`w-3 h-3 text-slate-500 transition-transform ${isMonthPickerOpen ? "rotate-180 text-emerald-600" : ""}`} />
              </button>

              {/* Year Dropdown Trigger */}
              <button
                type="button"
                onClick={() => {
                  setIsYearPickerOpen((prev) => !prev);
                  setIsMonthPickerOpen(false);
                }}
                className="text-xs font-bold text-slate-800 hover:bg-emerald-600/10 hover:text-emerald-900 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
              >
                {currentYear}
                <ChevronDown className={`w-3 h-3 text-slate-500 transition-transform ${isYearPickerOpen ? "rotate-180 text-emerald-600" : ""}`} />
              </button>
            </div>

            {/* Prev / Next Buttons */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1 text-slate-500 hover:text-slate-900 hover:bg-emerald-600/10 rounded-lg transition-colors cursor-pointer"
                title="Bulan Sebelumnya"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1 text-slate-500 hover:text-slate-900 hover:bg-emerald-600/10 rounded-lg transition-colors cursor-pointer"
                title="Bulan Berikutnya"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Month Picker Dropdown List */}
            {isMonthPickerOpen && (
              <div className="absolute left-0 top-8 z-50 w-36 bg-white border border-slate-200 rounded-xl p-1 shadow-lg max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                {MONTH_NAMES.map((m, idx) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setCurrentMonth(idx);
                      setIsMonthPickerOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors cursor-pointer ${
                      currentMonth === idx
                        ? "bg-[#DCF0DE] text-[#0F2A1D] font-semibold"
                        : "text-slate-700 hover:bg-emerald-600/10 hover:text-emerald-950"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}

            {/* Quick Year Picker Dropdown List */}
            {isYearPickerOpen && (
              <div className="absolute left-16 top-8 z-50 w-24 bg-white border border-slate-200 rounded-xl p-1 shadow-lg max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                {Array.from({ length: 15 }, (_, i) => currentYear - 7 + i).map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => {
                      setCurrentYear(y);
                      setIsYearPickerOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors cursor-pointer ${
                      currentYear === y
                        ? "bg-[#DCF0DE] text-[#0F2A1D] font-semibold"
                        : "text-slate-700 hover:bg-emerald-600/10 hover:text-emerald-950"
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Weekday Names Header */}
          <div className="grid grid-cols-7 gap-1 text-center mb-1">
            {DAY_NAMES.map((day) => (
              <span key={day} className="text-[10px] font-semibold text-slate-400 uppercase">
                {day}
              </span>
            ))}
          </div>

          {/* Days Number Grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Previous month padding days */}
            {Array.from({ length: firstDayIndex }).map((_, idx) => (
              <span
                key={`prev-${idx}`}
                className="text-[11px] text-slate-300 flex items-center justify-center h-7 w-7 mx-auto pointer-events-none"
              >
                {totalDaysInPrevMonth - firstDayIndex + idx + 1}
              </span>
            ))}

            {/* Current month days */}
            {Array.from({ length: totalDaysInMonth }).map((_, idx) => {
              const day = idx + 1;
              const isSelected =
                tempSelectedDate &&
                tempSelectedDate.getDate() === day &&
                tempSelectedDate.getMonth() === currentMonth &&
                tempSelectedDate.getFullYear() === currentYear;

              return (
                <button
                  key={`day-${day}`}
                  type="button"
                  onClick={() => handleSelectDay(day)}
                  className={`text-xs flex items-center justify-center h-8 w-8 rounded-xl mx-auto transition-all cursor-pointer ${
                    isSelected
                      ? "bg-gradient-to-r from-[#0F2A1D] to-[#163827] !text-white text-white font-bold shadow-sm"
                      : "text-slate-800 hover:bg-emerald-600/10 hover:text-emerald-950 font-medium"
                  }`}
                >
                  <span className={isSelected ? "!text-white text-white font-bold" : "text-slate-800"}>
                    {day}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Footer Action Buttons */}
          <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-amber-950/10">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setIsMonthPickerOpen(false);
                setIsYearPickerOpen(false);
              }}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleConfirmDate}
              className="px-5 py-2 text-xs font-semibold !text-white text-white bg-gradient-to-r from-[#0F2A1D] to-[#163827] hover:from-[#133525] hover:to-[#1a4430] rounded-xl shadow-sm transition-all active:scale-[0.98] cursor-pointer"
            >
              <span className="!text-white text-white font-semibold">Pilih</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
