// ============================================================
//  Gudang UMKM — Node.js + Express + better-sqlite3
// ============================================================
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── DATABASE SETUP (JSON file-based, no native modules) ───────
const DB_PATH = path.join(__dirname, "gudang_data.json");

const EMPTY_DB = {
  items: [], suppliers: [], users: [], logs: [],
  txMasuk: [], txMasukDetail: [],
  txKeluar: [], txKeluarDetail: [],
  txProd: [], txProdDetail: [], txProdOutput: [],
  txSpoilage: [], txSpoilageDetail: []
};

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch(e) {}
  return JSON.parse(JSON.stringify(EMPTY_DB));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data), "utf8");
}

// Seed default users if empty
let _db = loadDB();
if (!_db.users || _db.users.length === 0) {
  _db.users = [
    { id:"1", username:"admin",  nama:"Admin Utama",  pass:"admin123",  role:"superadmin", status:"Aktif", lastLogin:"—" },
    { id:"2", username:"gudang", nama:"Staff Gudang", pass:"gudang123", role:"gudang",     status:"Aktif", lastLogin:"—" }
  ];
  saveDB(_db);
}

// ── HELPERS ──────────────────────────────────────────────────
const DETAIL_MAP = {
  txMasuk:    { detail: "txMasukDetail",    output: null },
  txKeluar:   { detail: "txKeluarDetail",   output: null },
  txProd:     { detail: "txProdDetail",     output: "txProdOutput" },
  txSpoilage: { detail: "txSpoilageDetail", output: null },
};

// ── API ROUTES ────────────────────────────────────────────────

// loadAll
app.post("/api/loadAll", (req, res) => {
  try {
    const d = loadDB();
    // Attach rows to transactions
    const attach = (txList, detailList, outputList) =>
      (txList || []).map(tx => ({
        ...tx,
        rows: (detailList || []).filter(r => String(r.txId) === String(tx.id)),
        ...(outputList !== undefined ? {
          outputRows: (outputList || []).filter(r => String(r.txId) === String(tx.id))
        } : {})
      }));
    res.json({
      items:      d.items      || [],
      suppliers:  d.suppliers  || [],
      users:      d.users      || [],
      logs:       d.logs       || [],
      txMasuk:    attach(d.txMasuk,    d.txMasukDetail,    undefined),
      txKeluar:   attach(d.txKeluar,   d.txKeluarDetail,   undefined),
      txProd:     attach(d.txProd,     d.txProdDetail,     d.txProdOutput),
      txSpoilage: attach(d.txSpoilage, d.txSpoilageDetail, undefined),
    });
  } catch (e) { res.json({ error: e.message }); }
});

// saveMaster
app.post("/api/saveMaster", (req, res) => {
  try {
    const d = loadDB(); const p = req.body;
    if (p.items)     d.items     = p.items;
    if (p.suppliers) d.suppliers = p.suppliers;
    if (p.users)     d.users     = p.users;
    saveDB(d); res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// appendTransaction
app.post("/api/appendTransaction", (req, res) => {
  try {
    const d = loadDB(); const p = req.body;
    const allowed = ["txMasuk","txKeluar","txProd","txSpoilage"];
    if (!allowed.includes(p.sheet)) return res.json({ error: "Sheet tidak valid" });
    const tx = p.tx;
    d[p.sheet].push(tx);
    const dm = DETAIL_MAP[p.sheet];
    if (dm) {
      const detail = (tx.rows||[]).map(r=>({...r,txId:tx.id,invoiceNo:tx.invoiceNo,tgl:tx.tgl}));
      d[dm.detail].push(...detail);
      if (dm.output) {
        const out = (tx.outputRows||[]).map(r=>({...r,txId:tx.id,invoiceNo:tx.invoiceNo,tgl:tx.tgl}));
        d[dm.output].push(...out);
      }
    }
    if (p.logEntry) d.logs.push(p.logEntry);
    saveDB(d); res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// updateTransaction
app.post("/api/updateTransaction", (req, res) => {
  try {
    const d = loadDB(); const p = req.body; const tx = p.tx;
    const idx = d[p.sheet].findIndex(x => String(x.id) === String(tx.id));
    if (idx >= 0) d[p.sheet][idx] = tx; else d[p.sheet].push(tx);
    const dm = DETAIL_MAP[p.sheet];
    if (dm) {
      d[dm.detail] = d[dm.detail].filter(r => String(r.txId) !== String(tx.id));
      d[dm.detail].push(...(tx.rows||[]).map(r=>({...r,txId:tx.id,invoiceNo:tx.invoiceNo,tgl:tx.tgl})));
      if (dm.output) {
        d[dm.output] = d[dm.output].filter(r => String(r.txId) !== String(tx.id));
        d[dm.output].push(...(tx.outputRows||[]).map(r=>({...r,txId:tx.id,invoiceNo:tx.invoiceNo,tgl:tx.tgl})));
      }
    }
    if (p.logEntry) d.logs.push(p.logEntry);
    if (p.items) d.items = p.items;
    saveDB(d); res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// deleteTransaction
app.post("/api/deleteTransaction", (req, res) => {
  try {
    const d = loadDB(); const p = req.body;
    d[p.sheet] = d[p.sheet].filter(x => String(x.id) !== String(p.txId));
    const dm = DETAIL_MAP[p.sheet];
    if (dm) {
      d[dm.detail] = d[dm.detail].filter(r => String(r.txId) !== String(p.txId));
      if (dm.output) d[dm.output] = d[dm.output].filter(r => String(r.txId) !== String(p.txId));
    }
    if (p.items) d.items = p.items;
    saveDB(d); res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// updateItems
app.post("/api/updateItems", (req, res) => {
  try {
    const d = loadDB();
    d.items = Array.isArray(req.body) ? req.body : req.body.items;
    saveDB(d); res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// updateUserLogin
app.post("/api/updateUserLogin", (req, res) => {
  try {
    const d = loadDB(); const p = req.body;
    const u = d.users.find(x => String(x.id) === String(p.userId));
    if (u) u.lastLogin = p.lastLogin;
    saveDB(d); res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// Fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Gudang UMKM berjalan di http://localhost:${PORT}`);
});
