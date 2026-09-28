// Capa de persistencia. Si algún día cambias a SQLite/backend, solo tocas este archivo.
const Almacen = (() => {
  const LS = 'proyectos:datos';
  const canFile = 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
  const opts = { types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] };
  let handle = null, mode = 'local'; // local | file | permiso

  const db = () => new Promise((ok, ko) => {
    const r = indexedDB.open('proyectos-app', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
  async function kvGet(k) {
    try { const d = await db(); return await new Promise(ok => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); }); } catch { return null; }
  }
  async function kvSet(k, v) {
    try { const d = await db(); await new Promise(ok => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; }); } catch {}
  }
  async function readFile() { const t = await (await handle.getFile()).text(); return t.trim() ? JSON.parse(t) : null; }
  // Lee el archivo; si ya no existe, olvida la referencia en vez de recrearlo al guardar.
  async function safeRead() {
    try { return { ok: true, data: await readFile() }; }
    catch (e) {
      if (e.name === 'NotFoundError') { handle = null; await kvSet('handle', null); mode = 'local'; return { ok: false }; }
      throw e;
    }
  }
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } };

  async function init() {
    handle = canFile ? await kvGet('handle') : null;
    if (handle) {
      if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') {
        const r = await safeRead();
        if (r.ok) { mode = 'file'; return { mode, data: r.data }; }
        return { mode: 'local', data: readLocal() };
      }
      mode = 'permiso'; return { mode, data: readLocal() };
    }
    mode = 'local'; return { mode, data: readLocal() };
  }
  async function reconnect() {
    if (await handle.requestPermission({ mode: 'readwrite' }) === 'granted') {
      const r = await safeRead();
      if (r.ok) { mode = 'file'; return { mode, data: r.data }; }
      return { mode: 'local', data: readLocal() };
    }
    return { mode, data: null };
  }
  async function open() {
    [handle] = await showOpenFilePicker(opts); await kvSet('handle', handle);
    mode = 'file'; return { mode, data: await readFile() };
  }
  async function create(data) {
    handle = await showSaveFilePicker({ ...opts, suggestedName: 'proyectos.json' });
    await kvSet('handle', handle); mode = 'file'; await save(data); return { mode };
  }
  async function save(data) {
    const json = JSON.stringify(data, null, 2);
    try { localStorage.setItem(LS, json); } catch (e) { if (mode !== 'file') throw e; }
    if (mode === 'file') { const w = await handle.createWritable(); await w.write(json); await w.close(); }
  }
  return { init, reconnect, open, create, save, canFile, get mode() { return mode; }, get name() { return handle && handle.name; } };
})();