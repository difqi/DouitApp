import assert from "node:assert/strict";
import test from "node:test";
import {
  detectDeterministicDraftEditFields,
  isTimeDaypartClarificationReply,
  parseDeterministicDraftEdit,
  resolveTimeDaypartClarification,
  timeDaypartClarificationData,
} from "./fast-draft-edit.ts";

const NOW = new Date("2026-08-31T05:00:00.000Z");
const options = {
  draftType: "EXPENSE",
  now: NOW,
  resolveSource: (source) => ({ bri: "Bank BRI", bsi: "BSI", gopay: "GoPay", tunai: "Tunai" })[source.toLowerCase()] || null,
  resolveCategory: (category, type) => type === "EXPENSE"
    ? ({ transportasi: "Transportasi", makanan: "Makanan", belanja: "Belanja" })[category.toLowerCase()] || null
    : null,
};

function patchFor(message, parserOptions = options) {
  const result = parseDeterministicDraftEdit(message, parserOptions);
  assert.equal(result.kind, "patch", message);
  return result.patch;
}

test("parses explicit time edits", () => {
  assert.deepEqual(patchFor("jam 10 pagi"), { fields: ["transaction_time"], transactionTime: "10:00" });
  assert.deepEqual(patchFor("jam 7 malam"), { fields: ["transaction_time"], transactionTime: "19:00" });
  assert.deepEqual(patchFor("jam 12.30"), { fields: ["transaction_time"], transactionTime: "12:30" });
  assert.deepEqual(patchFor("pukul 14:30"), { fields: ["transaction_time"], transactionTime: "14:30" });
  assert.deepEqual(patchFor("ubah jamnya jadi 9 pagi"), { fields: ["transaction_time"], transactionTime: "09:00" });
  assert.deepEqual(patchFor("ubah jam ke 10 pagi"), { fields: ["transaction_time"], transactionTime: "10:00" });
  assert.deepEqual(patchFor("ganti jam jadi 10 pagi"), { fields: ["transaction_time"], transactionTime: "10:00" });
  assert.deepEqual(patchFor("jam transaksi jadi 12 siang"), { fields: ["transaction_time"], transactionTime: "12:00" });
  assert.deepEqual(patchFor("waktunya jam 10 pagi"), { fields: ["transaction_time"], transactionTime: "10:00" });
  assert.deepEqual(patchFor("jam ubah ke 10 pagi"), { fields: ["transaction_time"], transactionTime: "10:00" });
  assert.deepEqual(patchFor("jam ganti jadi 7 malam"), { fields: ["transaction_time"], transactionTime: "19:00" });
  assert.deepEqual(patchFor("waktu ubah ke 12 siang"), { fields: ["transaction_time"], transactionTime: "12:00" });
  assert.deepEqual(patchFor("jam transaksi ubah ke 10 pagi"), { fields: ["transaction_time"], transactionTime: "10:00" });
});

test("parses explicit amount edits", () => {
  assert.deepEqual(patchFor("jadi 25k"), { fields: ["amount"], amount: 25_000 });
  assert.deepEqual(patchFor("ubah jadi 30 ribu"), { fields: ["amount"], amount: 30_000 });
  assert.deepEqual(patchFor("nominalnya 50 ribu"), { fields: ["amount"], amount: 50_000 });
  assert.deepEqual(patchFor("harusnya 25000"), { fields: ["amount"], amount: 25_000 });
  assert.deepEqual(patchFor("ubah nominal ke 20k"), { fields: ["amount"], amount: 20_000 });
  assert.deepEqual(patchFor("ubah nominal jadi 20k"), { fields: ["amount"], amount: 20_000 });
  assert.deepEqual(patchFor("ganti nominal ke 20 ribu"), { fields: ["amount"], amount: 20_000 });
  assert.deepEqual(patchFor("ganti nominal jadi 20 ribu"), { fields: ["amount"], amount: 20_000 });
  assert.deepEqual(patchFor("nominalnya jadi 20k"), { fields: ["amount"], amount: 20_000 });
  assert.deepEqual(patchFor("nominalnya ubah ke 20k"), { fields: ["amount"], amount: 20_000 });
  assert.deepEqual(patchFor("nominal transaksi jadi 20k"), { fields: ["amount"], amount: 20_000 });
  assert.deepEqual(patchFor("nominal ubah ke 20k"), { fields: ["amount"], amount: 20_000 });
  assert.deepEqual(patchFor("nominal ganti jadi 20 ribu"), { fields: ["amount"], amount: 20_000 });
  assert.deepEqual(patchFor("nominal transaksi ubah ke 25k"), { fields: ["amount"], amount: 25_000 });
  assert.deepEqual(patchFor("jumlahnya ubah ke 30k"), { fields: ["amount"], amount: 30_000 });
  assert.deepEqual(
    patchFor("20k aja", { ...options, allowBareAmount: true }),
    { fields: ["amount"], amount: 20_000 },
  );
  assert.deepEqual(parseDeterministicDraftEdit("20k aja", options), { kind: "none" });
});

test("resolves only allowed payment sources", () => {
  assert.deepEqual(patchFor("pakai BRI aja"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("ganti ke GoPay"), { fields: ["sumber_dana"], sumberDana: "GoPay" });
  assert.deepEqual(patchFor("dari Tunai aja"), { fields: ["sumber_dana"], sumberDana: "Tunai" });
  assert.deepEqual(patchFor("ganti rekening ke bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("ubah rekening ke bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("rekeningnya ganti bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("rekeningnya bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("ubah sumber dana ke gopay"), { fields: ["sumber_dana"], sumberDana: "GoPay" });
  assert.deepEqual(patchFor("ganti sumber dana ke bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("sumber dananya bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("pakai rekening bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("ubah ke tunai"), { fields: ["sumber_dana"], sumberDana: "Tunai" });
  assert.deepEqual(patchFor("rekening ubah ke bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("rekening ubah ke bsi"), { fields: ["sumber_dana"], sumberDana: "BSI" });
  assert.deepEqual(patchFor("rekening ganti ke bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("rekening ganti jadi bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("rekening ganti jadi bsi"), { fields: ["sumber_dana"], sumberDana: "BSI" });
  assert.deepEqual(patchFor("sumber dana ubah ke bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("sumber dana ganti ke bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("sumber dana ganti ke bsi"), { fields: ["sumber_dana"], sumberDana: "BSI" });
  assert.deepEqual(patchFor("sumber dananya ubah ke bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  assert.deepEqual(patchFor("rekening transaksi ubah ke bri"), { fields: ["sumber_dana"], sumberDana: "Bank BRI" });
  const unknown = parseDeterministicDraftEdit("pakai BCA aja", options);
  assert.deepEqual(unknown, { kind: "clarification", field: "sumber_dana", requestedValue: "bca" });
  assert.deepEqual(
    parseDeterministicDraftEdit("ganti rekening ke bca", options),
    { kind: "clarification", field: "sumber_dana", requestedValue: "bca" },
  );
  assert.deepEqual(
    parseDeterministicDraftEdit("rekening ubah ke bca", options),
    { kind: "clarification", field: "sumber_dana", requestedValue: "bca" },
  );
});

test("uses Asia/Jakarta for deterministic dates", () => {
  assert.deepEqual(patchFor("kemarin aja"), { fields: ["transaction_date"], transactionDate: "2026-08-30" });
  assert.deepEqual(patchFor("hari ini aja"), { fields: ["transaction_date"], transactionDate: "2026-08-31" });
  assert.deepEqual(patchFor("tanggal 30 agustus"), { fields: ["transaction_date"], transactionDate: "2026-08-30" });
  assert.deepEqual(patchFor("ubah tanggalnya jadi kemarin"), { fields: ["transaction_date"], transactionDate: "2026-08-30" });
  assert.deepEqual(patchFor("ubah tanggal ke kemarin"), { fields: ["transaction_date"], transactionDate: "2026-08-30" });
  assert.deepEqual(patchFor("ganti tanggal jadi kemarin"), { fields: ["transaction_date"], transactionDate: "2026-08-30" });
  assert.deepEqual(patchFor("tanggalnya kemarin aja"), { fields: ["transaction_date"], transactionDate: "2026-08-30" });
  assert.deepEqual(patchFor("ubah tanggal jadi hari ini"), { fields: ["transaction_date"], transactionDate: "2026-08-31" });
  assert.deepEqual(patchFor("tanggal transaksi 30 agustus"), { fields: ["transaction_date"], transactionDate: "2026-08-30" });
  assert.deepEqual(patchFor("tanggal ubah ke kemarin"), { fields: ["transaction_date"], transactionDate: "2026-08-30" });
  assert.deepEqual(patchFor("tanggal ganti jadi hari ini"), { fields: ["transaction_date"], transactionDate: "2026-08-31" });
  assert.deepEqual(patchFor("tanggal transaksi ubah ke 30 agustus"), { fields: ["transaction_date"], transactionDate: "2026-08-30" });
});

test("resolves exact compatible categories", () => {
  assert.deepEqual(patchFor("kategorinya transportasi"), { fields: ["category"], category: "Transportasi" });
  assert.deepEqual(patchFor("ganti kategori ke makanan"), { fields: ["category"], category: "Makanan" });
  assert.deepEqual(patchFor("masuk ke kategori belanja"), { fields: ["category"], category: "Belanja" });
  assert.deepEqual(patchFor("ubah kategori ke transportasi"), { fields: ["category"], category: "Transportasi" });
  assert.deepEqual(patchFor("ganti kategori jadi transportasi"), { fields: ["category"], category: "Transportasi" });
  assert.deepEqual(patchFor("masuk kategori transportasi"), { fields: ["category"], category: "Transportasi" });
  assert.deepEqual(patchFor("kategori jadi makanan"), { fields: ["category"], category: "Makanan" });
  assert.deepEqual(patchFor("kategori ubah ke transportasi"), { fields: ["category"], category: "Transportasi" });
  assert.deepEqual(patchFor("kategori ganti jadi makanan"), { fields: ["category"], category: "Makanan" });
  assert.deepEqual(patchFor("kategori transaksi ubah ke belanja"), { fields: ["category"], category: "Belanja" });
});

test("stores and resolves only a matching bounded time-daypart clarification", () => {
  const initial = parseDeterministicDraftEdit("tambahkan jam 7 siang", options);
  assert.deepEqual(initial, {
    kind: "bounded_clarification",
    field: "transaction_time",
    clarificationType: "time_daypart",
    baseHour: 7,
    reply: "Apakah yang kamu maksud jam 7 pagi atau jam 7 malam?",
  });
  assert.deepEqual(
    detectDeterministicDraftEditFields("tambahkan jam 7 siang", { now: NOW }),
    ["transaction_time"],
  );

  const state = timeDaypartClarificationData("draft-a", 7);
  const expectedReplies = new Map([
    ["pagi", "Siap, jamnya aku ubah ke 07.00."],
    ["yang pagi", "Siap, jamnya aku ubah ke 07.00."],
    ["oh iya, pagi", "Siap, jamnya aku ubah ke 07.00."],
    ["maksudku pagi", "Siap, jamnya aku ubah ke 07.00."],
    ["malam", "Oke, jamnya sekarang 19.00."],
    ["yang malam", "Oke, jamnya sekarang 19.00."],
    ["oh iya malam", "Oke, jamnya sekarang 19.00."],
    ["maksudku malam", "Oke, jamnya sekarang 19.00."],
  ]);
  for (const [message, reply] of expectedReplies) {
    const result = resolveTimeDaypartClarification(message, state, "draft-a");
    assert.equal(result.kind, "patch", message);
    assert.deepEqual(result.patch, {
      fields: ["transaction_time"],
      transactionTime: message.includes("malam") ? "19:00" : "07:00",
    });
    assert.equal(result.reply, reply);
  }
});

test("standalone daypart replies remain non-mutating without clarification state", () => {
  assert.equal(isTimeDaypartClarificationReply("oh iya, pagi"), true);
  assert.equal(isTimeDaypartClarificationReply("pagi sekali"), false);
  assert.deepEqual(parseDeterministicDraftEdit("pagi", options), { kind: "none" });
  assert.deepEqual(resolveTimeDaypartClarification("pagi", null, "draft-a"), { kind: "none" });
});

test("closed or multiple-draft contexts cannot resolve a stored clarification", () => {
  assert.deepEqual(
    resolveTimeDaypartClarification("pagi", timeDaypartClarificationData("draft-a", 7), null),
    { kind: "none" },
  );
});

test("clarification state cannot be reused for another draft", () => {
  assert.deepEqual(
    resolveTimeDaypartClarification("pagi", timeDaypartClarificationData("draft-a", 7), "draft-b"),
    { kind: "none" },
  );
});

test("unlisted dayparts remain outside the bounded resolver", () => {
  assert.deepEqual(
    resolveTimeDaypartClarification("siang", timeDaypartClarificationData("draft-a", 7), "draft-a"),
    { kind: "none" },
  );
});

test("parses explicit multi-field edits atomically", () => {
  const sourceAndTime = parseDeterministicDraftEdit(
    "ganti rekening ke bri dan jam transaksi jadi 12 siang",
    options,
  );
  assert.equal(sourceAndTime.kind, "patch");
  assert.deepEqual(sourceAndTime.patch, {
    fields: ["sumber_dana", "transaction_time"],
    sumberDana: "Bank BRI",
    transactionTime: "12:00",
  });
  assert.equal(sourceAndTime.reply, "Siap, sumber dananya aku ubah ke Bank BRI dan jamnya ke 12.00.");

  const amountAndTime = parseDeterministicDraftEdit(
    "ubah nominal ke 25k dan jamnya jadi 7 malam",
    options,
  );
  assert.equal(amountAndTime.kind, "patch");
  assert.deepEqual(amountAndTime.patch, {
    fields: ["amount", "transaction_time"],
    amount: 25_000,
    transactionTime: "19:00",
  });
  assert.equal(amountAndTime.reply, "Oke, nominalnya sekarang Rp25.000 dan jamnya 19.00.");
});

test("dependency detection matches explicit clauses without parsing new transactions", () => {
  assert.deepEqual(
    detectDeterministicDraftEditFields("ganti rekening ke bri dan jam transaksi jadi 12 siang", { now: NOW }),
    ["sumber_dana", "transaction_time"],
  );
  assert.deepEqual(detectDeterministicDraftEditFields("ubah nominal ke 20k", { now: NOW }), ["amount"]);
  assert.equal(detectDeterministicDraftEditFields("makan 20k tunai", { now: NOW }), null);
  assert.equal(detectDeterministicDraftEditFields("20k aja", { now: NOW }), null);
  assert.deepEqual(
    detectDeterministicDraftEditFields("20k aja", { now: NOW, allowBareAmount: true }),
    ["amount"],
  );
});

test("falls back for ambiguity, partial clauses, conflicts, and new transactions", () => {
  for (const message of [
    "yang tadi kurang pas",
    "ubah yang itu",
    "ubah seperti biasanya",
    "kayaknya salah",
    "seperti biasanya",
    "pakai yang kemarin",
    "bukan itu",
    "jadi 30k pakai BRI",
    "kategorinya transportasi pakai BRI",
    "ubah rekening ke bri dan waktunya seperti kemarin",
    "ganti rekening ke bca dan jam transaksi jadi 12 siang",
    "jamnya 10 pagi dan jamnya 11 pagi",
    "yang rekeningnya biasanya",
    "sesuaikan aja",
    "beli bensin 15k",
    "beli air galon 10k",
    "makan 20k tunai",
  ]) {
    assert.deepEqual(parseDeterministicDraftEdit(message, options), { kind: "none" }, message);
  }
});
