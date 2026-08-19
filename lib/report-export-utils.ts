import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

export interface MonthlyReportData {
  businessName: string;
  userName: string;
  periodLabel: string; // e.g. "Agustus 2026"
  monthName: string;
  year: number;
  accountFilter: string; // e.g. "Semua Rekening" or "BCA"
  totalIncome: number;
  totalExpense: number;
  netSurplus: number;
  allocationStatus: string;
  categories: {
    name: string;
    income: number;
    expense: number;
    net: number;
    count: number;
    budget: number;
    percentage: string;
  }[];
  accounts: {
    name: string;
    isPrimary?: boolean;
    initialBalance: number;
    income: number;
    expense: number;
    finalBalance: number;
  }[];
  aiInsight: string;
}

export interface AnnualReportData {
  businessName: string;
  userName: string;
  year: number;
  accountFilter: string;
  annualStats: {
    month: number;
    monthName: string;
    income: number;
    expense: number;
    net: number;
  }[];
  totalIncome: number;
  totalExpense: number;
  totalNet: number;
  heatmapData: {
    name: string;
    months: number[];
    total: number;
    percentage: string;
  }[];
  topCategories: {
    name: string;
    total: number;
    percentage: string;
  }[];
}

export interface MultiYearReportData {
  businessName: string;
  userName: string;
  yearRangeLabel: string; // e.g. "2024 - 2026" or "2026"
  accountFilter: string;
  lifetimeNet: number;
  avgAnnualExpense: number;
  bestYear: number;
  bestYearMargin: number;
  yearlyStats: {
    year: number;
    income: number;
    expense: number;
    net: number;
    marginPct: number;
  }[];
  selectedYear: number;
  selectedYearCategories: {
    name: string;
    currentVal: number;
    prevVal: number | null;
    yoyPct: number | null;
    percentage: string;
  }[];
  selectedYearTotal: number;
  aiInsight: string;
}

const formatRupiah = (val: number): string => {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(val);
};

const formatNumberId = (val: number): string => {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(val);
};

const getGeneratedTimestamp = (): string => {
  const now = new Date();
  const dateStr = now.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeStr = now
    .toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta",
    })
    .replace(".", ":");
  return `Dicetak pada ${dateStr} pukul ${timeStr} WIB`;
};

/**
 * Universal browser file downloader that preserves custom filename and file extension
 * in modern Chromium, Edge, Chrome, Safari, and Firefox without triggering SPA router interception.
 */
export function downloadBlob(blob: Blob, fileName: string) {
  if (typeof window === "undefined" || !blob) return;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  link.download = fileName;
  link.rel = "noopener";
  link.target = "_self";
  link.style.display = "none";
  link.style.position = "fixed";
  link.style.top = "-9999px";
  link.style.left = "-9999px";
  document.body.appendChild(link);
  
  // Use non-bubbling synthetic click to prevent Next.js client router link interception
  const clickEvent = new MouseEvent("click", {
    view: window,
    bubbles: false,
    cancelable: true,
  });
  link.dispatchEvent(clickEvent);
  
  setTimeout(() => {
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
  }, 200);

  // Defer URL revocation (30s) so browser download manager finishes saving file metadata
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, 30000);
}

export function exportCsv(csvContent: string, fileName: string) {
  let content = csvContent;
  if (content.startsWith("\uFEFF")) {
    content = content.slice(1);
  }
  if (!content.startsWith("sep=,")) {
    content = "sep=,\r\n" + content;
  }
  const finalContent = "\uFEFF" + content;
  const blob = new Blob([finalContent], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, fileName);
}

// ----------------------------------------------------
// PDF HELPER FUNCTIONS
// ----------------------------------------------------

function drawCorporateHeader(
  doc: jsPDF,
  title: string,
  subtitle: string,
  businessName: string,
  accountFilter: string
) {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Dark Forest Header Banner
  doc.setFillColor(19, 42, 30); // #132A1E
  doc.rect(0, 0, pageWidth, 28, "F");

  // Accent Line (Lime/Mint)
  doc.setFillColor(16, 185, 129); // #10B981
  doc.rect(0, 28, pageWidth, 1.5, "F");

  // Douit Brand Mark & Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text("DOUIT AI", 14, 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(168, 201, 185); // #A8C9B9
  doc.text("Financial Intelligence & Management", 14, 19);

  // Right Side - Report Title & Period
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(title, pageWidth - 14, 12, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(163, 230, 53); // #A3E635 (Lime)
  doc.text(subtitle, pageWidth - 14, 19, { align: "right" });

  // Meta bar right below header
  doc.setFillColor(248, 250, 252); // #F8FAFC
  doc.rect(0, 29.5, pageWidth, 9, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105); // #475569

  const profileText = `Profil: ${businessName || "aarmo Finance"}`;
  const accText = `Filter Rekening: ${accountFilter || "Semua Rekening"}`;
  const timeText = getGeneratedTimestamp();

  doc.text(profileText, 14, 35.5);
  doc.text(accText, pageWidth / 2, 35.5, { align: "center" });
  doc.text(timeText, pageWidth - 14, 35.5, { align: "right" });

  // Border bottom of meta bar
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(0, 38.5, pageWidth, 38.5);
}

function drawKpiCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  valueColor: [number, number, number] = [15, 23, 42],
  subText?: string
) {
  // Background Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 2, 2, "FD");

  // Label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139); // #64748B
  doc.text(label.toUpperCase(), x + 4, y + 6);

  // Value
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...valueColor);
  doc.text(value, x + 4, y + 13);

  // Subtext if any
  if (subText) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(subText, x + 4, y + 17.5);
  }
}

function drawAiInsightBox(doc: jsPDF, y: number, text: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const boxWidth = pageWidth - 28;
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const splitText = doc.splitTextToSize(text, boxWidth - 12);
  const boxHeight = 12 + splitText.length * 4.2;

  // Background box with soft green tint
  doc.setFillColor(240, 253, 244); // #F0FDF4
  doc.setDrawColor(187, 247, 208); // #BBF7D0
  doc.setLineWidth(0.4);
  doc.roundedRect(14, y, boxWidth, boxHeight, 2, 2, "FD");

  // Left vertical accent bar
  doc.setFillColor(16, 185, 129); // #10B981
  doc.rect(14, y, 2.5, boxHeight, "F");

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(6, 95, 70); // #065F46
  doc.text("Douit AI Insight", 20, y + 5.5);

  // Text
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(21, 128, 61); // #15803D
  doc.text(splitText, 20, y + 10);

  return y + boxHeight + 6;
}

function addPageFooters(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184); // #94A3B8
    doc.text(
      "Laporan Keuangan Douit AI - Dokumen Resmi & Rahasia",
      14,
      pageHeight - 7.5
    );
    doc.text(
      `Halaman ${i} dari ${pageCount}`,
      pageWidth - 14,
      pageHeight - 7.5,
      { align: "right" }
    );
  }
}

// ----------------------------------------------------
// 1. MONTHLY FINANCIAL STATEMENT (TAB 1)
// ----------------------------------------------------

export function exportMonthlyPdf(data: MonthlyReportData) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const title = "Laporan Arus Kas Bulanan";
  const subtitle = `Periode: ${data.periodLabel}`;
  drawCorporateHeader(doc, title, subtitle, data.businessName, data.accountFilter);

  // Executive Summary - 4 KPI Cards
  const kpiY = 43;
  const cardW = 42;
  const cardH = 20;
  const cardGap = 4.6;

  // 1. Pemasukan
  drawKpiCard(
    doc,
    14,
    kpiY,
    cardW,
    cardH,
    "Total Pemasukan",
    formatRupiah(data.totalIncome),
    [16, 185, 129] // Green
  );

  // 2. Pengeluaran
  drawKpiCard(
    doc,
    14 + cardW + cardGap,
    kpiY,
    cardW,
    cardH,
    "Total Pengeluaran",
    formatRupiah(data.totalExpense),
    [225, 29, 72] // Rose
  );

  // 3. Arus Kas Bersih (Surplus/Defisit)
  const surplusColor: [number, number, number] =
    data.netSurplus >= 0 ? [16, 185, 129] : [225, 29, 72];
  drawKpiCard(
    doc,
    14 + (cardW + cardGap) * 2,
    kpiY,
    cardW,
    cardH,
    "Arus Kas Bersih",
    `${data.netSurplus > 0 ? "+" : ""}${formatRupiah(data.netSurplus)}`,
    surplusColor
  );

  // 4. Status Alokasi
  drawKpiCard(
    doc,
    14 + (cardW + cardGap) * 3,
    kpiY,
    cardW,
    cardH,
    "Status Alokasi",
    data.allocationStatus || "Terkendali",
    [79, 70, 229] // Indigo
  );

  // Section 1: Rincian Pengeluaran per Kategori
  let currentY = kpiY + cardH + 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("1. Rincian Pengeluaran Berdasarkan Kategori", 14, currentY);
  currentY += 3;

  const categoryTableData = data.categories
    .filter((c) => c.expense > 0 || c.net !== 0)
    .map((c, idx) => [
      String(idx + 1),
      c.name,
      formatRupiah(c.expense),
      `${c.percentage}%`,
      c.budget > 0 ? formatRupiah(c.budget) : "-",
      c.budget > 0
        ? c.expense > c.budget
          ? "Overbudget"
          : "Hemat"
        : "-"
    ]);

  if (categoryTableData.length === 0) {
    categoryTableData.push(["-", "Tidak ada pengeluaran di periode ini", "-", "-", "-", "-"]);
  }

  autoTable(doc, {
    startY: currentY,
    head: [["No", "Kategori", "Pengeluaran (Rp)", "Porsi (%)", "Anggaran (Rp)", "Status"]],
    body: categoryTableData,
    theme: "grid",
    headStyles: {
      fillColor: [19, 42, 30],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7.5,
      halign: "left",
    },
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 2.2,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      textColor: [30, 41, 59],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 50 },
      2: { cellWidth: 38, halign: "right" },
      3: { cellWidth: 22, halign: "right" },
      4: { cellWidth: 36, halign: "right" },
      5: { cellWidth: 26, halign: "center" },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 14, right: 14 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // AI Insight Box
  if (data.aiInsight) {
    currentY = drawAiInsightBox(doc, currentY, data.aiInsight);
  }

  // Section 2: Rekap Mutasi & Saldo Rekening
  if (currentY > 230) {
    doc.addPage();
    currentY = 20;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("2. Rekap Mutasi & Saldo Rekening", 14, currentY);
  currentY += 3;

  const accountTableData = data.accounts.map((acc, idx) => [
    String(idx + 1),
    `${acc.name}${acc.isPrimary ? " (Utama)" : ""}`,
    formatRupiah(acc.initialBalance),
    `+${formatRupiah(acc.income)}`,
    `-${formatRupiah(acc.expense)}`,
    formatRupiah(acc.finalBalance),
  ]);

  if (accountTableData.length === 0) {
    accountTableData.push(["-", "Belum ada rekening terdaftar", "-", "-", "-", "-"]);
  }

  autoTable(doc, {
    startY: currentY,
    head: [["No", "Nama Rekening", "Saldo Awal (Rp)", "Masuk (+) (Rp)", "Keluar (-) (Rp)", "Saldo Akhir (Rp)"]],
    body: accountTableData,
    theme: "grid",
    headStyles: {
      fillColor: [19, 42, 30],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7.5,
      halign: "left",
    },
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 2.2,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      textColor: [30, 41, 59],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 46 },
      2: { cellWidth: 32, halign: "right" },
      3: { cellWidth: 32, halign: "right", textColor: [16, 185, 129] },
      4: { cellWidth: 32, halign: "right", textColor: [225, 29, 72] },
      5: { cellWidth: 30, halign: "right", fontStyle: "bold" },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 14, right: 14 },
  });

  addPageFooters(doc);

  const cleanMonth = data.monthName.replace(/\s+/g, "-");
  const fileName = `Laporan-Keuangan-Douit-${cleanMonth}-${data.year}.pdf`;
  const pdfBlob = doc.output("blob");
  const typedBlob = new Blob([pdfBlob], { type: "application/pdf" });
  downloadBlob(typedBlob, fileName);
}

export function exportMonthlyExcel(data: MonthlyReportData) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Rincian Pengeluaran per Kategori
  const catRows = [
    ["DOUIT AI - LAPORAN KEUANGAN BULANAN"],
    [`Periode: ${data.periodLabel}`],
    [`Filter Rekening: ${data.accountFilter}`],
    [`Waktu Ekspor: ${getGeneratedTimestamp()}`],
    [],
    ["RINGKASAN EKSEKUTIF"],
    ["Total Pemasukan", data.totalIncome],
    ["Total Pengeluaran", data.totalExpense],
    ["Arus Kas Bersih (Surplus/Defisit)", data.netSurplus],
    ["Status Alokasi", data.allocationStatus],
    [],
    ["RINCIAN PENGELUARAN PER KATEGORI"],
    ["No", "Nama Kategori", "Pemasukan (Rp)", "Pengeluaran (Rp)", "Net (Rp)", "Porsi (%)", "Anggaran (Rp)", "Status Alokasi"],
    ...data.categories.map((c, i) => [
      i + 1,
      c.name,
      c.income,
      c.expense,
      c.net,
      `${c.percentage}%`,
      c.budget || 0,
      c.budget > 0 ? (c.expense > c.budget ? "Overbudget" : "Hemat") : "Belum diatur",
    ]),
  ];

  const ws1 = XLSX.utils.aoa_to_sheet(catRows);
  ws1["!cols"] = [
    { wch: 6 },
    { wch: 28 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 12 },
    { wch: 18 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, "Rincian Kategori");

  // Sheet 2: Rekap Saldo & Mutasi Rekening
  const accRows = [
    ["DOUIT AI - REKAP MUTASI & SALDO REKENING"],
    [`Periode: ${data.periodLabel}`],
    [],
    ["No", "Nama Rekening", "Tipe", "Saldo Awal (Rp)", "Masuk (+) (Rp)", "Keluar (-) (Rp)", "Saldo Akhir (Rp)"],
    ...data.accounts.map((acc, i) => [
      i + 1,
      acc.name,
      acc.isPrimary ? "Utama" : "Sekunder",
      acc.initialBalance,
      acc.income,
      acc.expense,
      acc.finalBalance,
    ]),
  ];

  const ws2 = XLSX.utils.aoa_to_sheet(accRows);
  ws2["!cols"] = [
    { wch: 6 },
    { wch: 26 },
    { wch: 12 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "Mutasi Saldo Rekening");

  const cleanMonth = data.monthName.replace(/\s+/g, "-");
  const fileName = `Laporan-Keuangan-Douit-${cleanMonth}-${data.year}.xlsx`;
  const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const excelBlob = new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8",
  });
  downloadBlob(excelBlob, fileName);
}

// ----------------------------------------------------
// 2. ANNUAL TREND REPORT (TAB 2)
// ----------------------------------------------------

export function exportAnnualPdf(data: AnnualReportData) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const title = "Laporan Tren Keuangan Tahunan";
  const subtitle = `Tahun Anggaran: ${data.year}`;
  drawCorporateHeader(doc, title, subtitle, data.businessName, data.accountFilter);

  // Executive Summary - 3 Cards
  const kpiY = 43;
  const cardW = 58;
  const cardH = 20;
  const cardGap = 4;

  drawKpiCard(
    doc,
    14,
    kpiY,
    cardW,
    cardH,
    `Total Pemasukan (${data.year})`,
    formatRupiah(data.totalIncome),
    [16, 185, 129]
  );

  drawKpiCard(
    doc,
    14 + cardW + cardGap,
    kpiY,
    cardW,
    cardH,
    `Total Pengeluaran (${data.year})`,
    formatRupiah(data.totalExpense),
    [225, 29, 72]
  );

  const netColor: [number, number, number] =
    data.totalNet >= 0 ? [16, 185, 129] : [225, 29, 72];
  drawKpiCard(
    doc,
    14 + (cardW + cardGap) * 2,
    kpiY,
    cardW,
    cardH,
    `Akumulasi Bersih (${data.year})`,
    `${data.totalNet > 0 ? "+" : ""}${formatRupiah(data.totalNet)}`,
    netColor
  );

  // Section 1: Rekap Arus Kas 12 Bulan (Jan - Des)
  let currentY = kpiY + cardH + 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("1. Rekap Arus Kas 12 Bulan (Januari - Desember)", 14, currentY);
  currentY += 3;

  const monthlyRows = data.annualStats.map((s) => [
    s.monthName,
    formatRupiah(s.income),
    formatRupiah(s.expense),
    `${s.net >= 0 ? "+" : ""}${formatRupiah(s.net)}`,
    s.income > 0 ? `${(((s.income - s.expense) / s.income) * 100).toFixed(1)}%` : "-",
  ]);

  // Total Summary Row
  monthlyRows.push([
    "TOTAL AKUMULASI TAHUNAN",
    formatRupiah(data.totalIncome),
    formatRupiah(data.totalExpense),
    `${data.totalNet >= 0 ? "+" : ""}${formatRupiah(data.totalNet)}`,
    data.totalIncome > 0
      ? `${(((data.totalIncome - data.totalExpense) / data.totalIncome) * 100).toFixed(1)}%`
      : "-",
  ]);

  autoTable(doc, {
    startY: currentY,
    head: [["Bulan", "Pemasukan (Rp)", "Pengeluaran (Rp)", "Pendapatan Bersih (Rp)", "Savings Margin"]],
    body: monthlyRows,
    theme: "grid",
    headStyles: {
      fillColor: [19, 42, 30],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7.5,
      halign: "left",
    },
    styles: {
      font: "helvetica",
      fontSize: 7,
      cellPadding: 1.8,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      textColor: [30, 41, 59],
    },
    columnStyles: {
      0: { cellWidth: 42, fontStyle: "bold" },
      1: { cellWidth: 35, halign: "right" },
      2: { cellWidth: 35, halign: "right" },
      3: { cellWidth: 42, halign: "right", fontStyle: "bold" },
      4: { cellWidth: 28, halign: "right" },
    },
    didParseCell: (hookData) => {
      // Highlight totals row
      if (hookData.row.index === 12) {
        hookData.cell.styles.fillColor = [241, 245, 249];
        hookData.cell.styles.fontStyle = "bold";
        hookData.cell.styles.textColor = [15, 23, 42];
      }
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 14, right: 14 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // Section 2: Top Kategori Tahunan
  if (currentY > 235) {
    doc.addPage();
    currentY = 20;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("2. Top Kategori Pengeluaran Tahunan", 14, currentY);
  currentY += 3;

  const topCatRows = data.topCategories.map((c, i) => [
    String(i + 1),
    c.name,
    formatRupiah(c.total),
    `${c.percentage}%`,
  ]);

  if (topCatRows.length === 0) {
    topCatRows.push(["-", "Tidak ada data pengeluaran", "-", "-"]);
  }

  autoTable(doc, {
    startY: currentY,
    head: [["Peringkat", "Kategori Pengeluaran", "Total Pengeluaran (Rp)", "Porsi Tahunan (%)"]],
    body: topCatRows,
    theme: "grid",
    headStyles: {
      fillColor: [19, 42, 30],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7.5,
      halign: "left",
    },
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 2,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { cellWidth: 20, halign: "center" },
      1: { cellWidth: 72 },
      2: { cellWidth: 50, halign: "right" },
      3: { cellWidth: 40, halign: "right", fontStyle: "bold" },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 14, right: 14 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // Section 3: Matriks Sebaran Pengeluaran (Landscape Page)
  doc.addPage("a4", "landscape");
  drawCorporateHeader(
    doc,
    "Matriks Sebaran Pengeluaran Tahunan",
    `Tahun: ${data.year}`,
    data.businessName,
    data.accountFilter
  );

  const monthsHeader = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
  const matrixHeaders = ["Kategori", ...monthsHeader, "Total Tahunan"];

  const matrixBody = data.heatmapData.map((row) => [
    row.name,
    ...row.months.map((m) => (m > 0 ? formatNumberId(m) : "-")),
    formatRupiah(row.total),
  ]);

  if (matrixBody.length === 0) {
    matrixBody.push(["Tidak ada data", ...Array(12).fill("-"), "-"]);
  }

  autoTable(doc, {
    startY: 44,
    head: [matrixHeaders],
    body: matrixBody,
    theme: "grid",
    headStyles: {
      fillColor: [19, 42, 30],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7,
      halign: "center",
    },
    styles: {
      font: "helvetica",
      fontSize: 6.5,
      cellPadding: 1.8,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      halign: "right",
    },
    columnStyles: {
      0: { cellWidth: 38, halign: "left", fontStyle: "bold" },
      1: { cellWidth: 17 },
      2: { cellWidth: 17 },
      3: { cellWidth: 17 },
      4: { cellWidth: 17 },
      5: { cellWidth: 17 },
      6: { cellWidth: 17 },
      7: { cellWidth: 17 },
      8: { cellWidth: 17 },
      9: { cellWidth: 17 },
      10: { cellWidth: 17 },
      11: { cellWidth: 17 },
      12: { cellWidth: 17 },
      13: { cellWidth: 30, halign: "right", fontStyle: "bold", textColor: [225, 29, 72] },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 14, right: 14 },
  });

  addPageFooters(doc);

  const fileName = `Laporan-Tahunan-Douit-${data.year}.pdf`;
  const pdfBlob = doc.output("blob");
  const typedBlob = new Blob([pdfBlob], { type: "application/pdf" });
  downloadBlob(typedBlob, fileName);
}

export function exportAnnualExcel(data: AnnualReportData) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Rekap Arus Kas 12 Bulan
  const cashflowRows = [
    ["DOUIT AI - LAPORAN TAHUNAN ARUS KAS"],
    [`Tahun: ${data.year}`],
    [`Filter Rekening: ${data.accountFilter}`],
    [`Waktu Ekspor: ${getGeneratedTimestamp()}`],
    [],
    ["Bulan", "Pemasukan (Rp)", "Pengeluaran (Rp)", "Pendapatan Bersih (Rp)", "Savings Margin (%)"],
    ...data.annualStats.map((s) => [
      s.monthName,
      s.income,
      s.expense,
      s.net,
      s.income > 0 ? Number((((s.income - s.expense) / s.income) * 100).toFixed(1)) : 0,
    ]),
    [],
    [
      "TOTAL AKUMULASI",
      data.totalIncome,
      data.totalExpense,
      data.totalNet,
      data.totalIncome > 0
        ? Number((((data.totalIncome - data.totalExpense) / data.totalIncome) * 100).toFixed(1))
        : 0,
    ],
  ];

  const ws1 = XLSX.utils.aoa_to_sheet(cashflowRows);
  ws1["!cols"] = [
    { wch: 18 },
    { wch: 20 },
    { wch: 20 },
    { wch: 22 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, "Arus Kas 12 Bulan");

  // Sheet 2: Matriks Pengeluaran Bulanan
  const matrixHeaders = [
    "Nama Kategori",
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
    "Total Pengeluaran",
  ];

  const matrixRows = [
    ["DOUIT AI - MATRIKS SEBARAN PENGELUARAN TAHUNAN"],
    [`Tahun: ${data.year}`],
    [],
    matrixHeaders,
    ...data.heatmapData.map((row) => [
      row.name,
      ...row.months,
      row.total,
    ]),
  ];

  const ws2 = XLSX.utils.aoa_to_sheet(matrixRows);
  ws2["!cols"] = [
    { wch: 26 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "Matriks Pengeluaran");

  const fileName = `Laporan-Tahunan-Douit-${data.year}.xlsx`;
  const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const excelBlob = new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8",
  });
  downloadBlob(excelBlob, fileName);
}

// ----------------------------------------------------
// 3. MULTI-YEAR EXECUTIVE GROWTH REPORT (TAB 3)
// ----------------------------------------------------

export function exportMultiYearPdf(data: MultiYearReportData) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const title = "Laporan Pertumbuhan Kekayaan Multi-Tahun";
  const subtitle = `Rentang Periode: ${data.yearRangeLabel}`;
  drawCorporateHeader(doc, title, subtitle, data.businessName, data.accountFilter);

  // Lifetime KPIs - 3 Cards
  const kpiY = 43;
  const cardW = 58;
  const cardH = 20;
  const cardGap = 4;

  const netColor: [number, number, number] =
    data.lifetimeNet >= 0 ? [16, 185, 129] : [225, 29, 72];
  drawKpiCard(
    doc,
    14,
    kpiY,
    cardW,
    cardH,
    "Akumulasi Tabungan Lifetime",
    `${data.lifetimeNet >= 0 ? "+" : ""}${formatRupiah(data.lifetimeNet)}`,
    netColor
  );

  drawKpiCard(
    doc,
    14 + cardW + cardGap,
    kpiY,
    cardW,
    cardH,
    "Rata-Rata Pengeluaran Tahunan",
    formatRupiah(data.avgAnnualExpense),
    [15, 23, 42]
  );

  drawKpiCard(
    doc,
    14 + (cardW + cardGap) * 2,
    kpiY,
    cardW,
    cardH,
    "Tahun Terhemat",
    data.bestYear ? `${data.bestYear}` : "-",
    [16, 185, 129],
    data.bestYearMargin > -Infinity ? `Margin Tabungan: ${(data.bestYearMargin * 100).toFixed(1)}%` : undefined
  );

  // Section 1: Tabel Rekap Multi-Tahun
  let currentY = kpiY + cardH + 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("1. Rekap Performa Finansial Multi-Tahun", 14, currentY);
  currentY += 3;

  const multiYearRows = data.yearlyStats.map((s) => [
    String(s.year),
    formatRupiah(s.income),
    formatRupiah(s.expense),
    `${s.net >= 0 ? "+" : ""}${formatRupiah(s.net)}`,
    s.income > 0 ? `${s.marginPct.toFixed(1)}%` : "-",
  ]);

  if (multiYearRows.length === 0) {
    multiYearRows.push(["-", "-", "-", "-", "-"]);
  }

  autoTable(doc, {
    startY: currentY,
    head: [["Tahun", "Pemasukan (Rp)", "Pengeluaran (Rp)", "Pendapatan Bersih (Rp)", "Margin Tabungan (%)"]],
    body: multiYearRows,
    theme: "grid",
    headStyles: {
      fillColor: [19, 42, 30],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7.5,
      halign: "left",
    },
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 2.2,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      textColor: [30, 41, 59],
    },
    columnStyles: {
      0: { cellWidth: 26, fontStyle: "bold" },
      1: { cellWidth: 40, halign: "right" },
      2: { cellWidth: 40, halign: "right" },
      3: { cellWidth: 44, halign: "right", fontStyle: "bold" },
      4: { cellWidth: 32, halign: "right" },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 14, right: 14 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // AI Insight Box
  if (data.aiInsight) {
    currentY = drawAiInsightBox(doc, currentY, data.aiInsight);
  }

  // Section 2: Sebaran Pengeluaran Multi-Tahun
  if (currentY > 230) {
    doc.addPage();
    currentY = 20;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`2. Sebaran Pengeluaran Kategori (Tahun Terpilih: ${data.selectedYear})`, 14, currentY);
  currentY += 3;

  const categoryBreakdownRows = data.selectedYearCategories.map((item, idx) => {
    let yoyLabel = "-";
    if (item.prevVal === null) {
      yoyLabel = "Tahun Basis";
    } else if (item.prevVal === 0 && item.currentVal > 0) {
      yoyLabel = "+100% (Baru)";
    } else if (item.yoyPct !== null) {
      const sign = item.yoyPct > 0 ? "+" : "";
      yoyLabel = `${sign}${Math.round(item.yoyPct)}% YoY`;
    }

    return [
      String(idx + 1),
      item.name,
      formatRupiah(item.currentVal),
      `${item.percentage}%`,
      item.prevVal !== null ? formatRupiah(item.prevVal) : "-",
      yoyLabel,
    ];
  });

  if (categoryBreakdownRows.length === 0) {
    categoryBreakdownRows.push(["-", "Tidak ada pengeluaran", "-", "-", "-", "-"]);
  }

  autoTable(doc, {
    startY: currentY,
    head: [["No", "Kategori", `Pengeluaran ${data.selectedYear} (Rp)`, "Porsi (%)", "Tahun Sebelumnya (Rp)", "Perubahan YoY"]],
    body: categoryBreakdownRows,
    theme: "grid",
    headStyles: {
      fillColor: [19, 42, 30],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7.5,
      halign: "left",
    },
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 2.2,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      textColor: [30, 41, 59],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 46 },
      2: { cellWidth: 38, halign: "right" },
      3: { cellWidth: 22, halign: "right" },
      4: { cellWidth: 36, halign: "right" },
      5: { cellWidth: 30, halign: "center" },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 14, right: 14 },
  });

  addPageFooters(doc);

  const cleanRange = data.yearRangeLabel.replace(/\s+/g, "");
  const fileName = `Laporan-Pertumbuhan-Douit-${cleanRange}.pdf`;
  const pdfBlob = doc.output("blob");
  const typedBlob = new Blob([pdfBlob], { type: "application/pdf" });
  downloadBlob(typedBlob, fileName);
}

export function exportMultiYearExcel(data: MultiYearReportData) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Rekap Multi-Tahun
  const multiYearRows = [
    ["DOUIT AI - LAPORAN PERTUMBUHAN KEKAYAAN MULTI-TAHUN"],
    [`Rentang Periode: ${data.yearRangeLabel}`],
    [`Filter Rekening: ${data.accountFilter}`],
    [`Waktu Ekspor: ${getGeneratedTimestamp()}`],
    [],
    ["METRIK LIFETIME"],
    ["Akumulasi Tabungan Lifetime", data.lifetimeNet],
    ["Rata-Rata Pengeluaran Tahunan", data.avgAnnualExpense],
    ["Tahun Terhemat", data.bestYear || "-"],
    ["Margin Tahun Terhemat", `${(data.bestYearMargin * 100).toFixed(1)}%`],
    [],
    ["TABEL REKAP MULTI-TAHUN"],
    ["Tahun", "Pemasukan (Rp)", "Pengeluaran (Rp)", "Pendapatan Bersih (Rp)", "Margin Tabungan (%)"],
    ...data.yearlyStats.map((s) => [
      s.year,
      s.income,
      s.expense,
      s.net,
      s.income > 0 ? Number(s.marginPct.toFixed(1)) : 0,
    ]),
  ];

  const ws1 = XLSX.utils.aoa_to_sheet(multiYearRows);
  ws1["!cols"] = [
    { wch: 14 },
    { wch: 22 },
    { wch: 22 },
    { wch: 24 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, "Rekap Multi-Tahun");

  // Sheet 2: Sebaran Kategori Multi-Tahun
  const catRows = [
    ["DOUIT AI - SEBARAN PENGELUARAN KATEGORI"],
    [`Tahun Terpilih: ${data.selectedYear}`],
    [],
    ["No", "Nama Kategori", `Pengeluaran ${data.selectedYear} (Rp)`, "Porsi (%)", "Tahun Sebelumnya (Rp)", "Perubahan YoY (%)"],
    ...data.selectedYearCategories.map((c, i) => [
      i + 1,
      c.name,
      c.currentVal,
      `${c.percentage}%`,
      c.prevVal || 0,
      c.yoyPct !== null ? Number(c.yoyPct.toFixed(1)) : "-",
    ]),
  ];

  const ws2 = XLSX.utils.aoa_to_sheet(catRows);
  ws2["!cols"] = [
    { wch: 6 },
    { wch: 26 },
    { wch: 22 },
    { wch: 14 },
    { wch: 22 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "Sebaran Kategori");

  const cleanRange = data.yearRangeLabel.replace(/\s+/g, "");
  const fileName = `Laporan-Pertumbuhan-Douit-${cleanRange}.xlsx`;
  const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const excelBlob = new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8",
  });
  downloadBlob(excelBlob, fileName);
}
