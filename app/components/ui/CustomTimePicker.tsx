"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Clock, Check } from "lucide-react";

interface CustomTimePickerProps {
  value: string; // Format "HH:mm" (e.g. "08:00")
  onChange: (value: string) => void;
  disabled?: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, "0"));

export function CustomTimePicker({
  value = "08:00",
  onChange,
  disabled = false,
}: CustomTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hoursScrollRef = useRef<HTMLDivElement>(null);
  const minutesScrollRef = useRef<HTMLDivElement>(null);

  const [selectedHour, selectedMinute] = (value || "08:00").split(":");

  useEffect(() => {
    setMounted(true);
  }, []);

  // Calculate Drop-Up coordinates (Above trigger button)
  const updatePosition = () => {
    if (triggerButtonRef.current) {
      const rect = triggerButtonRef.current.getBoundingClientRect();
      const popoverWidth = 288; // 18rem / w-72

      // Position anchor at the top edge of trigger button (shifted upwards with -translate-y-full)
      let top = rect.top - 8;
      let left = rect.left;

      // Adjust horizontal position if overflowing right screen edge
      if (left + popoverWidth > window.innerWidth - 16) {
        left = Math.max(16, rect.right - popoverWidth);
      }

      setCoords({ top, left });
    }
  };

  const handleToggle = () => {
    if (disabled) return;
    if (!isOpen) {
      updatePosition();
    }
    setIsOpen(!isOpen);
  };

  // Reposition on window resize or scroll
  useEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
    }
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerButtonRef.current &&
        !triggerButtonRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Scroll active items into view when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        const activeHourEl = hoursScrollRef.current?.querySelector('[data-selected="true"]');
        const activeMinuteEl = minutesScrollRef.current?.querySelector('[data-selected="true"]');

        activeHourEl?.scrollIntoView({ block: "center", behavior: "smooth" });
        activeMinuteEl?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 50);
    }
  }, [isOpen]);

  const handleHourSelect = (hour: string) => {
    onChange(`${hour}:${selectedMinute || "00"}`);
  };

  const handleMinuteSelect = (minute: string) => {
    onChange(`${selectedHour || "08"}:${minute}`);
  };

  return (
    <>
      {/* Trigger Button inside Modal Form */}
      <button
        ref={triggerButtonRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-all flex items-center justify-between outline-none cursor-pointer ${
          isOpen
            ? "border-emerald-600 ring-2 ring-emerald-600/10 bg-white"
            : "border-slate-200 bg-white hover:border-slate-300"
        } ${disabled ? "opacity-50 cursor-not-allowed bg-slate-50" : ""}`}
      >
        <span className="font-semibold text-slate-800 tracking-wide text-sm sm:text-base">
          {value || "08:00"} <span className="text-xs font-normal text-slate-400 ml-1">WIB</span>
        </span>
        <Clock className="w-4 h-4 text-slate-400 flex-shrink-0" />
      </button>

      {/* Popover Rendered via Portal on document.body (Drop-Up Above Input) */}
      {mounted &&
        isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 9999,
            }}
            className="w-72 max-w-[calc(100vw-2rem)] -translate-y-full bg-[#FAF8F5] border border-emerald-900/15 rounded-2xl shadow-2xl p-3.5 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-emerald-900/10">
              <span className="text-[11px] font-bold text-[#0F2A1D] uppercase tracking-wider">
                Pilih Waktu Pengingat
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                {value} WIB
              </span>
            </div>

            {/* Dual Column Picker */}
            <div className="grid grid-cols-2 gap-2 text-center">
              {/* Column 1: Jam */}
              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1">Jam</div>
                <div
                  ref={hoursScrollRef}
                  className="h-44 overflow-y-auto space-y-1 pr-1 rounded-xl scrollbar-thin scrollbar-thumb-emerald-900/20 scrollbar-track-transparent"
                  style={{ scrollbarWidth: "thin" }}
                >
                  {HOURS.map((hour) => {
                    const isSelected = hour === selectedHour;
                    return (
                      <button
                        key={hour}
                        type="button"
                        data-selected={isSelected}
                        onClick={() => handleHourSelect(hour)}
                        className={`w-full py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                          isSelected
                            ? "bg-gradient-to-r from-[#0F2A1D] to-[#163827] !text-white text-white shadow-sm"
                            : "text-slate-700 hover:bg-emerald-900/10 hover:text-emerald-950"
                        }`}
                      >
                        <span className={isSelected ? "!text-white text-white font-bold" : ""}>
                          {hour}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Column 2: Menit */}
              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1">Menit</div>
                <div
                  ref={minutesScrollRef}
                  className="h-44 overflow-y-auto space-y-1 pr-1 rounded-xl scrollbar-thin scrollbar-thumb-emerald-900/20 scrollbar-track-transparent"
                  style={{ scrollbarWidth: "thin" }}
                >
                  {MINUTES.map((minute) => {
                    const isSelected = minute === selectedMinute;
                    return (
                      <button
                        key={minute}
                        type="button"
                        data-selected={isSelected}
                        onClick={() => handleMinuteSelect(minute)}
                        className={`w-full py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                          isSelected
                            ? "bg-gradient-to-r from-[#0F2A1D] to-[#163827] !text-white text-white shadow-sm"
                            : "text-slate-700 hover:bg-emerald-900/10 hover:text-emerald-950"
                        }`}
                      >
                        <span className={isSelected ? "!text-white text-white font-bold" : ""}>
                          {minute}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer Action */}
            <div className="mt-3 pt-2.5 border-t border-emerald-900/10 flex justify-end">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="w-full py-2 rounded-xl text-xs font-semibold !text-white text-white bg-gradient-to-r from-[#0F2A1D] to-[#163827] hover:from-[#143827] hover:to-[#1c4732] shadow-sm flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer border border-emerald-900/30"
              >
                <Check className="w-3.5 h-3.5 text-white" />
                <span className="text-white font-semibold">Terapkan Waktu</span>
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

export default CustomTimePicker;
