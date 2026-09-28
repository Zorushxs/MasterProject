// Estado en memoria y operaciones sobre proyectos. Guarda solo con Almacen.
const Store = (() => {
  let data = { version: 1, projects: [] }, timer = null, onStatus = () => {};
  const now = () => new Date().toISOString();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 7));

  function norm(d) {
    const ps = Array.isArray(d && d.projects) ? d.projects : [];
    return { version: 1, projects: ps.map(p => ({
      id: p.id || uid(), name: p.name || '', description: p.description || '',
      status: p.status || 'idea', priority: p.priority || 'media', link: p.link || '',
      tags: Array.isArray(p.tags) ? p.tags : [], notes: p.notes || '',
      images: Array.isArray(p.images) ? p.images : (p.image ? [p.image] : []),
      coverPos: (p.coverPos && typeof p.coverPos.x === 'number') ? p.coverPos : { x: 50, y: 50 }, docs: Array.isArray(p.docs) ? p.docs : [],
      created: p.created || now(), updated: p.updated || now() })) };
  }
  function persist() {
    clearTimeout(timer); onStatus('saving');
    timer = setTimeout(async () => {
      try { await Almacen.save(data); onStatus('saved'); } catch (e) { console.error(e); onStatus('error'); }
    }, 400);
  }
  return {
    get projects() { return data.projects; },
    onStatus(fn) { onStatus = fn; },
    load(d) { data = norm(d); },
    get: id => data.projects.find(p => p.id === id),
    add() {
      const p = { id: uid(), name: '', description: '', status: 'idea', priority: 'media', link: '', tags: [], notes: '', images: [], coverPos: { x: 50, y: 50 }, docs: [], created: now(), updated: now() };
      data.projects.unshift(p); persist(); return p;
    },
    update(id, patch) { const p = this.get(id); if (p) { Object.assign(p, patch, { updated: now() }); persist(); } },
    remove(id) { data.projects = data.projects.filter(p => p.id !== id); persist(); },
    snapshot: () => data,
    flush: () => Almacen.save(data),
  };
})();