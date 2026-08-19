import React from "react";
import { Wallet } from "lucide-react";

export function BankLogo({ bankName, className = "" }: { bankName: string; className?: string }) {
  const nameLower = (bankName || "").toLowerCase();

  if (nameLower.includes("bri")) {
    // BRImo logo: Blue background with orange/white text
    return (
      <div className={`flex items-center justify-center bg-[#00529C] rounded overflow-hidden font-bold tracking-tighter ${className}`}>
        <span className="text-white text-[10px]">BRI</span><span className="text-[#F37021] text-[10px]">mo</span>
      </div>
    );
  }
  
  if (nameLower.includes("bca")) {
    // myBCA logo: Dark blue background with white/blue text
    return (
      <div className={`flex items-center justify-center bg-[#005EAA] rounded overflow-hidden font-bold italic tracking-tighter ${className}`}>
        <span className="text-white text-[10px]">my</span><span className="text-[#F37021] text-[10px] ml-[1px]">BCA</span>
      </div>
    );
  }

  if (nameLower.includes("mandiri")) {
    // Livin' logo: Gold background with blue text
    return (
      <div className={`flex items-center justify-center bg-[#FBB040] rounded overflow-hidden font-bold italic tracking-tighter ${className}`}>
        <span className="text-[#002855] text-[10px]">Livin'</span>
      </div>
    );
  }

  if (nameLower.includes("bni")) {
    // Wondr logo: Orange/teal gradient or just orange with white text
    return (
      <div className={`flex items-center justify-center bg-[#005E6A] rounded overflow-hidden font-bold tracking-tighter ${className}`}>
        <span className="text-white text-[9px] mr-[1px]">wondr</span><span className="text-[#F26522] text-[10px]">.</span>
      </div>
    );
  }

  if (nameLower.includes("btn")) {
    // bale / BTN logo: Yellow and blue
    return (
      <div className={`flex items-center justify-center bg-[#00478F] rounded overflow-hidden font-bold tracking-tighter ${className}`}>
        <span className="text-[#FFCD00] text-[10px]">bale</span>
      </div>
    );
  }

  if (nameLower.includes("bsi")) {
    // BSI logo: Green and yellow
    return (
      <div className={`flex items-center justify-center bg-[#00A39D] rounded overflow-hidden font-bold tracking-tighter ${className}`}>
        <span className="text-white text-[10px]">BSI</span>
      </div>
    );
  }

  if (nameLower.includes("gopay") || nameLower.includes("go-pay")) {
    return (
      <div className={`flex items-center justify-center bg-[#00AED6] rounded overflow-hidden font-bold tracking-tighter ${className}`}>
        <span className="text-white text-[10px]">gopay</span>
      </div>
    );
  }

  if (nameLower.includes("shopee") || nameLower.includes("spay")) {
    return (
      <div className={`flex items-center justify-center bg-[#EE4D2D] rounded overflow-hidden font-bold tracking-tighter ${className}`}>
        <span className="text-white text-[10px]">Shopee</span>
      </div>
    );
  }

  if (nameLower.includes("ovo")) {
    return (
      <div className={`flex items-center justify-center bg-[#4C3494] rounded overflow-hidden font-black tracking-widest ${className}`}>
        <span className="text-white text-[9px]">OVO</span>
      </div>
    );
  }

  if (nameLower.includes("dana")) {
    return (
      <div className={`flex items-center justify-center bg-[#118EE9] rounded overflow-hidden font-black tracking-widest ${className}`}>
        <span className="text-white text-[9px]">DANA</span>
      </div>
    );
  }

  if (nameLower.includes("linkaja")) {
    return (
      <div className={`flex items-center justify-center bg-[#E31837] rounded overflow-hidden font-bold tracking-tighter ${className}`}>
        <span className="text-white text-[9px]">LinkAja</span>
      </div>
    );
  }

  // Fallback
  return (
    <div className={`flex items-center justify-center bg-slate-100 text-slate-500 rounded ${className}`}>
      <Wallet className="w-3/4 h-3/4" />
    </div>
  );
}
