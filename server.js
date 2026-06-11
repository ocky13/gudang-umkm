// ============================================================
//  Gudang UMKM — Node.js + Express + PostgreSQL
// ============================================================
const express = require("express");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── DATABASE SETUP ────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(sql, params) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Seed default data jika belum ada
  const r = await query("SELECT value FROM kv_store WHERE key='users'");
  if (!r.rows.length) {
    const users = [
      { id:"1", username:"admin",  nama:"Admin Utama",  pass:"admin123",  role:"superadmin", status:"Aktif", lastLogin:"—" },
      { id:"2", username:"gudang", nama:"Staff Gudang", pass:"gudang123", role:"gudang",     status:"Aktif", lastLogin:"—" }
    ];
    await setValue("users", users);
    await setValue("items", []);
    await setValue("suppliers", []);
    await setValue("logs", []);
    await setValue("txMasuk", []);
    await setValue("txMasukDetail", []);
    await setValue("txKeluar", []);
    await setValue("txKeluarDetail", []);
    await setValue("txProd", []);
    await setValue("txProdDetail", []);
    await setValue("txProdOutput", []);
    await setValue("txSpoilage", []);
    await setValue("txSpoilageDetail", []);
  }
  console.log("Database siap!");
}

async function getValue(key) {
  const r = await query("SELECT value FROM kv_store WHERE key=$1", [key]);
  return r.rows.length ? JSON.parse(r.rows[0].value) : [];
}

async function setValue(key, data) {
  await query(
    `INSERT INTO kv_store (key, value, updated_at) VALUES ($1,$2,NOW())
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
    [key, JSON.stringify(data)]
  );
}

// ── HELPERS ──────────────────────────────────────────────────
const DETAIL_MAP = {
  txMasuk:    { detail: "txMasukDetail",    output: null },
  txKeluar:   { detail: "txKeluarDetail",   output: null },
  txProd:     { detail: "txProdDetail",     output: "txProdOutput" },
  txSpoilage: { detail: "txSpoilageDetail", output: null },
};

function attachRows(txList, detailList, outputList) {
  return (txList||[]).map(tx => ({
    ...tx,
    rows: (detailList||[]).filter(r => String(r.txId) === String(tx.id)),
    ...(outputList !== undefined ? {
      outputRows: (outputList||[]).filter(r => String(r.txId) === String(tx.id))
    } : {})
  }));
}

// ── API ROUTES ────────────────────────────────────────────────

app.post("/api/loadAll", async (req, res) => {
  try {
    const [items, suppliers, users, logs,
           txMasuk, txMasukDetail,
           txKeluar, txKeluarDetail,
           txProd, txProdDetail, txProdOutput,
           txSpoilage, txSpoilageDetail] = await Promise.all([
      getValue("items"), getValue("suppliers"), getValue("users"), getValue("logs"),
      getValue("txMasuk"), getValue("txMasukDetail"),
      getValue("txKeluar"), getValue("txKeluarDetail"),
      getValue("txProd"), getValue("txProdDetail"), getValue("txProdOutput"),
      getValue("txSpoilage"), getValue("txSpoilageDetail")
    ]);
    res.json({
      items, suppliers, users, logs,
      txMasuk:    attachRows(txMasuk,    txMasukDetail,    undefined),
      txKeluar:   attachRows(txKeluar,   txKeluarDetail,   undefined),
      txProd:     attachRows(txProd,     txProdDetail,     txProdOutput),
      txSpoilage: attachRows(txSpoilage, txSpoilageDetail, undefined),
    });
  } catch(e) { res.json({ error: e.message }); }
});

app.post("/api/saveMaster", async (req, res) => {
  try {
    const p = req.body;
    const ops = [];
    if (p.items)     ops.push(setValue("items",     p.items));
    if (p.suppliers) ops.push(setValue("suppliers", p.suppliers));
    if (p.users)     ops.push(setValue("users",     p.users));
    await Promise.all(ops);
    res.json({ ok: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.post("/api/appendTransaction", async (req, res) => {
  try {
    const p = req.body;
    const allowed = ["txMasuk","txKeluar","txProd","txSpoilage"];
    if (!allowed.includes(p.sheet)) return res.json({ error: "Sheet tidak valid" });
    const tx = p.tx;
    const dm = DETAIL_MAP[p.sheet];

    const [list, detailList, outputList, logs] = await Promise.all([
      getValue(p.sheet),
      dm ? getValue(dm.detail) : Promise.resolve([]),
      dm?.output ? getValue(dm.output) : Promise.resolve([]),
      p.logEntry ? getValue("logs") : Promise.resolve(null)
    ]);

    list.push(tx);
    const ops = [setValue(p.sheet, list)];

    if (dm) {
      const newDetail = (tx.rows||[]).map(r=>({...r,txId:tx.id,invoiceNo:tx.invoiceNo,tgl:tx.tgl}));
      detailList.push(...newDetail);
      ops.push(setValue(dm.detail, detailList));
      if (dm.output) {
        const newOut = (tx.outputRows||[]).map(r=>({...r,txId:tx.id,invoiceNo:tx.invoiceNo,tgl:tx.tgl}));
        outputList.push(...newOut);
        ops.push(setValue(dm.output, outputList));
      }
    }
    if (p.logEntry && logs) { logs.push(p.logEntry); ops.push(setValue("logs", logs)); }
    await Promise.all(ops);
    res.json({ ok: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.post("/api/updateTransaction", async (req, res) => {
  try {
    const p = req.body; const tx = p.tx;
    const dm = DETAIL_MAP[p.sheet];
    const [list, detailList, outputList, logs, items] = await Promise.all([
      getValue(p.sheet),
      dm ? getValue(dm.detail) : Promise.resolve([]),
      dm?.output ? getValue(dm.output) : Promise.resolve([]),
      p.logEntry ? getValue("logs") : Promise.resolve(null),
      p.items ? null : Promise.resolve(null)
    ]);

    const idx = list.findIndex(x => String(x.id) === String(tx.id));
    if (idx >= 0) list[idx] = tx; else list.push(tx);
    const ops = [setValue(p.sheet, list)];

    if (dm) {
      const newDetail = (tx.rows||[]).map(r=>({...r,txId:tx.id,invoiceNo:tx.invoiceNo,tgl:tx.tgl}));
      const filteredDetail = detailList.filter(r => String(r.txId) !== String(tx.id));
      ops.push(setValue(dm.detail, [...filteredDetail, ...newDetail]));
      if (dm.output) {
        const newOut = (tx.outputRows||[]).map(r=>({...r,txId:tx.id,invoiceNo:tx.invoiceNo,tgl:tx.tgl}));
        const filteredOut = outputList.filter(r => String(r.txId) !== String(tx.id));
        ops.push(setValue(dm.output, [...filteredOut, ...newOut]));
      }
    }
    if (p.logEntry && logs) { logs.push(p.logEntry); ops.push(setValue("logs", logs)); }
    if (p.items) ops.push(setValue("items", p.items));
    await Promise.all(ops);
    res.json({ ok: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.post("/api/deleteTransaction", async (req, res) => {
  try {
    const p = req.body;
    const dm = DETAIL_MAP[p.sheet];
    const [list, detailList, outputList] = await Promise.all([
      getValue(p.sheet),
      dm ? getValue(dm.detail) : Promise.resolve([]),
      dm?.output ? getValue(dm.output) : Promise.resolve([])
    ]);
    const ops = [setValue(p.sheet, list.filter(x => String(x.id) !== String(p.txId)))];
    if (dm) {
      ops.push(setValue(dm.detail, detailList.filter(r => String(r.txId) !== String(p.txId))));
      if (dm.output) ops.push(setValue(dm.output, outputList.filter(r => String(r.txId) !== String(p.txId))));
    }
    if (p.items) ops.push(setValue("items", p.items));
    await Promise.all(ops);
    res.json({ ok: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.post("/api/updateItems", async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body.items;
    await setValue("items", items);
    res.json({ ok: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.post("/api/updateUserLogin", async (req, res) => {
  try {
    const p = req.body;
    const users = await getValue("users");
    const u = users.find(x => String(x.id) === String(p.userId));
    if (u) u.lastLogin = p.lastLogin;
    await setValue("users", users);
    res.json({ ok: true });
  } catch(e) { res.json({ error: e.message }); }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start
initDB().then(() => {
  app.listen(PORT, () => console.log(`Gudang UMKM jalan di port ${PORT}`));
}).catch(e => {
  console.error("DB init error:", e.message);
  process.exit(1);
});
