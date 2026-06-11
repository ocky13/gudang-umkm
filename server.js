// ============================================================
//  Gudang UMKM — Node.js + Express + SQLite Backend
// ============================================================
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "gudang.db");

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── DATABASE SETUP ────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY, nama TEXT, tipe TEXT, sat TEXT,
    hpp REAL DEFAULT 0, hj REAL DEFAULT 0, min REAL DEFAULT 0,
    stok REAL DEFAULT 0, note TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY, nama TEXT, pic TEXT, telp TEXT,
    kat TEXT, alamat TEXT, status TEXT DEFAULT 'Aktif'
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE, nama TEXT,
    pass TEXT, role TEXT, status TEXT DEFAULT 'Aktif', lastLogin TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY, time TEXT, user TEXT,
    type TEXT, desc TEXT, isEdit INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS txMasuk (
    id TEXT PRIMARY KEY, invoiceNo TEXT, tgl TEXT, ref TEXT,
    supplier TEXT, catatan TEXT, by TEXT, createdAt TEXT, isEdited INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS txMasukDetail (
    txId TEXT, invoiceNo TEXT, tgl TEXT, itemId TEXT, nama TEXT,
    sat TEXT, qty REAL, harga REAL, hpp REAL, note TEXT
  );
  CREATE TABLE IF NOT EXISTS txKeluar (
    id TEXT PRIMARY KEY, invoiceNo TEXT, tgl TEXT, ref TEXT, noSJ TEXT,
    tujuan TEXT, platNo TEXT, jenisKendaraan TEXT, driver TEXT,
    catatan TEXT, by TEXT, createdAt TEXT, isEdited INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS txKeluarDetail (
    txId TEXT, invoiceNo TEXT, tgl TEXT, itemId TEXT, nama TEXT,
    sat TEXT, qty REAL, hpp REAL, note TEXT
  );
  CREATE TABLE IF NOT EXISTS txProd (
    id TEXT PRIMARY KEY, invoiceNo TEXT, tgl TEXT, ref TEXT, namaMenu TEXT,
    qtyProd REAL, totalHPP REAL, shift TEXT, chef TEXT, qc TEXT,
    catatan TEXT, by TEXT, createdAt TEXT, isEdited INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS txProdDetail (
    txId TEXT, invoiceNo TEXT, tgl TEXT, itemId TEXT, nama TEXT,
    sat TEXT, qty REAL, hpp REAL, note TEXT
  );
  CREATE TABLE IF NOT EXISTS txProdOutput (
    txId TEXT, invoiceNo TEXT, tgl TEXT, itemId TEXT, nama TEXT,
    sat TEXT, qty REAL, note TEXT
  );
  CREATE TABLE IF NOT EXISTS txSpoilage (
    id TEXT PRIMARY KEY, invoiceNo TEXT, tgl TEXT, kategori TEXT,
    alasan TEXT, disposisi TEXT, totalNilai REAL,
    by TEXT, createdAt TEXT
  );
  CREATE TABLE IF NOT EXISTS txSpoilageDetail (
    txId TEXT, invoiceNo TEXT, tgl TEXT, itemId TEXT, nama TEXT,
    sat TEXT, qty REAL, hpp REAL, note TEXT
  );
`);

// Seed default users if empty
const userCount = db.prepare("SELECT COUNT(*) as c FROM users").get();
if (userCount.c === 0) {
  db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)").run("1","admin","Admin Utama","admin123","superadmin","Aktif","—");
  db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)").run("2","gudang","Staff Gudang","gudang123","gudang","Aktif","—");
}

// ── HELPERS ──────────────────────────────────────────────────
const DETAIL_MAP = {
  txMasuk:    { detail: "txMasukDetail",    output: null },
  txKeluar:   { detail: "txKeluarDetail",   output: null },
  txProd:     { detail: "txProdDetail",     output: "txProdOutput" },
  txSpoilage: { detail: "txSpoilageDetail", output: null },
};

function readAll(table) {
  return db.prepare(`SELECT * FROM ${table}`).all();
}

function readTxWithDetail(header, detail, output) {
  const txs = db.prepare(`SELECT * FROM ${header}`).all();
  const details = db.prepare(`SELECT * FROM ${detail}`).all();
  const outputs = output ? db.prepare(`SELECT * FROM ${output}`).all() : [];
  const dmap = {}, omap = {};
  details.forEach(d => { if (!dmap[d.txId]) dmap[d.txId] = []; dmap[d.txId].push(d); });
  outputs.forEach(o => { if (!omap[o.txId]) omap[o.txId] = []; omap[o.txId].push(o); });
  return txs.map(tx => ({
    ...tx,
    rows: dmap[tx.id] || [],
    ...(output ? { outputRows: omap[tx.id] || [] } : {})
  }));
}

function insertRows(table, rows) {
  if (!rows || !rows.length) return;
  const cols = Object.keys(rows[0]);
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
  );
  const insertMany = db.transaction(arr => arr.forEach(r => stmt.run(cols.map(c => r[c] ?? ""))));
  insertMany(rows);
}

function deleteDetailByTxId(table, txId) {
  db.prepare(`DELETE FROM ${table} WHERE txId = ?`).run(String(txId));
}

// ── API ROUTES ────────────────────────────────────────────────

// loadAll
app.post("/api/loadAll", (req, res) => {
  try {
    res.json({
      items:      readAll("items"),
      suppliers:  readAll("suppliers"),
      users:      readAll("users"),
      logs:       readAll("logs"),
      txMasuk:    readTxWithDetail("txMasuk",    "txMasukDetail",    null),
      txKeluar:   readTxWithDetail("txKeluar",   "txKeluarDetail",   null),
      txProd:     readTxWithDetail("txProd",     "txProdDetail",     "txProdOutput"),
      txSpoilage: readTxWithDetail("txSpoilage", "txSpoilageDetail", null),
    });
  } catch (e) { res.json({ error: e.message }); }
});

// saveMaster
app.post("/api/saveMaster", (req, res) => {
  try {
    const p = req.body;
    if (p.items) {
      db.prepare("DELETE FROM items").run();
      insertRows("items", p.items);
    }
    if (p.suppliers) {
      db.prepare("DELETE FROM suppliers").run();
      insertRows("suppliers", p.suppliers);
    }
    if (p.users) {
      db.prepare("DELETE FROM users").run();
      insertRows("users", p.users);
    }
    res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// appendTransaction
app.post("/api/appendTransaction", (req, res) => {
  try {
    const p = req.body;
    const allowed = ["txMasuk","txKeluar","txProd","txSpoilage"];
    if (!allowed.includes(p.sheet)) return res.json({ error: "Sheet tidak valid" });
    const tx = p.tx;
    insertRows(p.sheet, [tx]);
    const dm = DETAIL_MAP[p.sheet];
    if (dm) {
      const detail = (tx.rows || []).map(r => ({ ...r, txId: tx.id, invoiceNo: tx.invoiceNo, tgl: tx.tgl }));
      insertRows(dm.detail, detail);
      if (dm.output) {
        const out = (tx.outputRows || []).map(r => ({ ...r, txId: tx.id, invoiceNo: tx.invoiceNo, tgl: tx.tgl }));
        insertRows(dm.output, out);
      }
    }
    if (p.logEntry) insertRows("logs", [p.logEntry]);
    res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// updateTransaction
app.post("/api/updateTransaction", (req, res) => {
  try {
    const p = req.body;
    const tx = p.tx;
    insertRows(p.sheet, [tx]);
    const dm = DETAIL_MAP[p.sheet];
    if (dm) {
      deleteDetailByTxId(dm.detail, tx.id);
      const detail = (tx.rows || []).map(r => ({ ...r, txId: tx.id, invoiceNo: tx.invoiceNo, tgl: tx.tgl }));
      insertRows(dm.detail, detail);
      if (dm.output) {
        deleteDetailByTxId(dm.output, tx.id);
        const out = (tx.outputRows || []).map(r => ({ ...r, txId: tx.id, invoiceNo: tx.invoiceNo, tgl: tx.tgl }));
        insertRows(dm.output, out);
      }
    }
    if (p.logEntry) insertRows("logs", [p.logEntry]);
    if (p.items) { db.prepare("DELETE FROM items").run(); insertRows("items", p.items); }
    res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// deleteTransaction
app.post("/api/deleteTransaction", (req, res) => {
  try {
    const p = req.body;
    db.prepare(`DELETE FROM ${p.sheet} WHERE id = ?`).run(String(p.txId));
    const dm = DETAIL_MAP[p.sheet];
    if (dm) {
      deleteDetailByTxId(dm.detail, p.txId);
      if (dm.output) deleteDetailByTxId(dm.output, p.txId);
    }
    if (p.items) { db.prepare("DELETE FROM items").run(); insertRows("items", p.items); }
    res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// updateItems
app.post("/api/updateItems", (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body.items;
    db.prepare("DELETE FROM items").run();
    insertRows("items", items);
    res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// updateUserLogin
app.post("/api/updateUserLogin", (req, res) => {
  try {
    const p = req.body;
    db.prepare("UPDATE users SET lastLogin = ? WHERE id = ?").run(p.lastLogin, String(p.userId));
    res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// Fallback: serve index.html for all other routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Gudang UMKM berjalan di http://localhost:${PORT}`);
});
