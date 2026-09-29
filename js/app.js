// Interfaz: lista, editor, buscador, filtros, archivo y tema.
(() => {
  const $ = s => document.querySelector(s);
  const ESTADOS = { idea: 'Idea', curso: 'En curso', pausado: 'Pausado', terminado: 'Terminado' };
  const PRIOS = { baja: 'Baja', media: 'Media', alta: 'Alta' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let sel = null, q = '', filt = 'todos', docsOpen = false, shown = null,
    galOpen = (() => { try { return localStorage.getItem('proyectos:galeria') !== '0'; } catch { return true; } })();
  const MAX_DOC = 3 * 1024 * 1024; // 3 MB por documento (se guarda dentro del JSON)
  const pos = c => `object-position:${c.coverPos.x}% ${c.coverPos.y}%`;
  const fmt = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const pick = (accept, multiple) => new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple; i.onchange = () => ok([...i.files]); i.click(); });
  const readData = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(f); });
  async function shrink(file) { // reduce la imagen a 1600px máx. para no engordar el JSON
    const url = URL.createObjectURL(file);
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    return c.toDataURL('image/webp', 0.85);
  }

  // ---------- Visor de imágenes (carrusel) ----------
  let lb = null, fr = null, drag = null;
  const box = document.createElement('div'); box.className = 'lb'; box.hidden = true; document.body.appendChild(box);
  function renderLB() {
    const pr = Store.get(sel), im = pr ? pr.images : [];
    if (lb === null || !im.length) { box.hidden = true; box.innerHTML = ''; lb = null; return; }
    lb = (lb + im.length) % im.length; box.hidden = false;
    box.innerHTML = `<div class="lb-bar"><span>${lb + 1} / ${im.length}</span><span class="lb-btns">${lb > 0 ? '<button class="mini" data-lb="cover">Usar como portada</button>' : '<span class="lb-tag">Portada</span><button class="mini" data-lb="reframe">Encuadrar</button>'}<button class="mini" data-lb="del">Quitar imagen</button><button class="mini" data-lb="close" aria-label="Cerrar">✕</button></span></div>
      <div class="lb-stage" data-lb="bg"><img src="${im[lb]}" alt=""></div>
      ${im.length > 1 ? '<button class="lb-nav prev" data-lb="prev" aria-label="Anterior">‹</button><button class="lb-nav next" data-lb="next" aria-label="Siguiente">›</button>' : ''}`;
  }
  box.addEventListener('click', e => {
    const a = e.target.closest('[data-lb]'); if (!a) return;
    const k = a.dataset.lb, pr = Store.get(sel);
    if (k === 'close' || (k === 'bg' && e.target === a)) { history.back(); }
    else if (k === 'prev') { lb--; renderLB(); history.replaceState({ v: 'lb', id: sel, lb }, ''); }
    else if (k === 'next') { lb++; renderLB(); history.replaceState({ v: 'lb', id: sel, lb }, ''); }
    else if (k === 'cover' || k === 'reframe') startFrame(lb);
    else if (k === 'fcancel') { fr = null; renderLB(); }
    else if (k === 'fsave' && pr) {
      const im = [...pr.images], [x] = im.splice(fr.i, 1); im.unshift(x);
      Store.update(sel, { images: im, coverPos: { x: Math.round(fr.x), y: Math.round(fr.y) } });
      lb = fr.from === 'lb' ? 0 : null; fr = null; renderLB(); renderEditor();
    }
    else if (k === 'del' && pr && confirm('¿Quitar esta imagen del proyecto?')) {
      const im = [...pr.images]; Store.update(sel, lb === 0 ? { images: (im.splice(lb, 1), im), coverPos: { x: 50, y: 50 } } : { images: (im.splice(lb, 1), im) });
      lb = Math.max(0, Math.min(lb, im.length - 1)); renderLB(); renderEditor();
      if (im.length) history.replaceState({ v: 'lb', id: sel, lb }, ''); else history.back();
    }
  });
  document.addEventListener('keydown', e => {
    if (fr) { if (e.key === 'Escape') { fr = null; renderLB(); } return; }
    if (lb === null) return;
    if (e.key === 'Escape') history.back();
    else if (e.key === 'ArrowLeft') { lb--; renderLB(); }
    else if (e.key === 'ArrowRight') { lb++; renderLB(); }
  });

  // ---------- Encuadre de la portada ----------
  function startFrame(i) {
    const pr = Store.get(sel); if (!pr) return;
    const cur = i === 0 ? pr.coverPos : { x: 50, y: 50 };
    fr = { i, x: cur.x, y: cur.y, from: lb === null ? 'editor' : 'lb' };
    box.hidden = false;
    box.innerHTML = `<div class="lb-bar"><span>Arrastra la imagen. Se verá la parte iluminada.</span><span class="lb-btns"><button class="mini" data-lb="fcancel">Cancelar</button><button class="mini ok" data-lb="fsave">Guardar portada</button></span></div>
      <div class="fr-area" data-lb="fr"><div class="fr-stage"><img src="${pr.images[i]}" alt=""><div class="fr-mask"></div></div></div>`;
    const img = box.querySelector('.fr-stage img');
    const go = () => { fr.nw = img.naturalWidth; fr.nh = img.naturalHeight; layoutFrame(); };
    img.complete ? go() : (img.onload = go);
  }
  function layoutFrame() {
    const st = box.querySelector('.fr-stage'); if (!fr || !st || !fr.nw) return;
    const img = st.querySelector('img'), fw = st.clientWidth, fh = st.clientHeight;
    const k = Math.max(fw / fr.nw, fh / fr.nh), w = fr.nw * k, h = fr.nh * k;
    fr.ox = w - fw; fr.oy = h - fh;
    img.style.width = w + 'px'; img.style.height = h + 'px';
    img.style.left = (-fr.ox * fr.x / 100) + 'px'; img.style.top = (-fr.oy * fr.y / 100) + 'px';
  }
  const clamp = v => Math.max(0, Math.min(100, v));
  box.addEventListener('pointerdown', e => {
    if (!fr || !e.target.closest('[data-lb="fr"]')) return;
    drag = { sx: e.clientX, sy: e.clientY, x: fr.x, y: fr.y }; box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', e => {
    if (!drag || !fr) return;
    if (fr.ox > 0) fr.x = clamp(drag.x - (e.clientX - drag.sx) / fr.ox * 100);
    if (fr.oy > 0) fr.y = clamp(drag.y - (e.clientY - drag.sy) / fr.oy * 100);
    layoutFrame();
  });
  box.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('resize', layoutFrame);

  // ---------- Tema ----------
  const setTheme = t => { document.documentElement.dataset.theme = t; try { localStorage.setItem('proyectos:tema', t); } catch {} };
  const saved = (() => { try { return localStorage.getItem('proyectos:tema'); } catch { return null; } })();
  setTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');


  // ---------- Navegación (para que "atrás" del móvil no cierre la app) ----------
  function openProject(id) {
    sel = id;
    if (history.state && history.state.v === 'p') history.replaceState({ v: 'p', id }, '');
    else history.pushState({ v: 'p', id }, '');
    renderList(); renderEditor();
  }
  function goHome() {
    if (history.state && history.state.v === 'p') history.back();
    else { sel = null; renderList(); renderEditor(); }
  }
  window.addEventListener('popstate', e => {
    const st = e.state;
    sel = (st && (st.v === 'p' || st.v === 'lb') && Store.get(st.id)) ? st.id : null;
    lb = (st && st.v === 'lb') ? st.lb : null; fr = null;
    renderList(); renderEditor(); renderLB();
  });

  // ---------- Lista ----------
  // Filtros de la pantalla principal: dentro de cada grupo basta con cumplir uno; entre grupos deben cumplirse todos.
  const hf = { status: new Set(), priority: new Set(), tags: new Set() };
  const anyF = () => hf.status.size + hf.priority.size + hf.tags.size > 0;
  const bySearch = c => !q || [c.name, c.description, c.notes, c.tags.join(' ')].join(' ').toLowerCase().includes(q);
  const matches = c => (!hf.status.size || hf.status.has(c.status)) && (!hf.priority.size || hf.priority.has(c.priority)) &&
    (!hf.tags.size || c.tags.some(t => hf.tags.has(t.toLowerCase())));
  function filterBar(allTags) {
    const chip = (g, v, label) => `<button class="chip${hf[g].has(v) ? ' on' : ''}" data-hf="${g}" data-v="${esc(v)}" aria-pressed="${hf[g].has(v)}">${esc(label)}</button>`;
    const tagChips = [...allTags].sort((a, b) => a[1].localeCompare(b[1], 'es')).map(([k, l]) => chip('tags', k, l)).join('');
    return `<div class="hfilters">
      <div class="fgroup"><span class="fl">Estado</span>${Object.entries(ESTADOS).map(([k, l]) => chip('status', k, l)).join('')}</div>
      <div class="fgroup"><span class="fl">Prioridad</span>${Object.entries(PRIOS).map(([k, l]) => chip('priority', k, l)).join('')}</div>
      <div class="fgroup"><span class="fl">Etiquetas</span>${tagChips || '<span class="fl">Aún no hay etiquetas</span>'}</div>
      ${anyF() ? '<button class="mini" data-hclear>Limpiar filtros</button>' : ''}</div>`;
  }
  const ORDEN_ESTADO = { curso: 0, pausado: 1, idea: 2, terminado: 3 };
  function visible() {
    return Store.projects
      .filter(p => (filt === 'todos' || p.status === filt) &&
        (!q || [p.name, p.description, p.notes, p.tags.join(' ')].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => ORDEN_ESTADO[a.status] - ORDEN_ESTADO[b.status] || b.updated.localeCompare(a.updated));
  }
  function renderFilters() {
    const opts = [['todos', 'Todos'], ...Object.entries(ESTADOS)];
    $('#filters').innerHTML = opts.map(([k, v]) => {
      const n = k === 'todos' ? Store.projects.length : Store.projects.filter(p => p.status === k).length;
      return `<button data-f="${k}" class="chip${filt === k ? ' on' : ''}">${v} <span>${n}</span></button>`;
    }).join('');
  }
  function renderList() {
    const items = visible();
    $('#list').innerHTML = items.length ? items.map(p => `
      <li><button class="item${p.id === sel ? ' on' : ''}" data-id="${p.id}">
        <i class="dot s-${p.status}"></i>
        <span class="t">${esc(p.name) || '<em>Sin nombre</em>'}</span>
        ${p.priority === 'alta' ? '<b class="hi" title="Prioridad alta">!</b>' : ''}
      </button></li>`).join('') : `<li class="none">${Store.projects.length ? 'Nada coincide con la búsqueda.' : 'Aún no hay proyectos.'}</li>`;
    renderFilters();
  }

  // ---------- Editor ----------
  function renderEditor() {
    const p = Store.get(sel), ed = $('#editor');
    ed.classList.toggle('wide', !p);
    if (shown !== sel) { shown = sel; docsOpen = false; }
    if (!p) {
      const has = Store.projects.length > 0;
      const card = c => `<button class="card" data-open="${c.id}">
        ${c.images.length ? `<img class="thumb" src="${c.images[0]}" style="${pos(c)}" alt="">` : ''}
        <h3>${esc(c.name) || '<em>Sin nombre</em>'}</h3>
        ${c.description ? `<p>${esc(c.description)}</p>` : ''}
        <div class="meta"><span class="st"><i class="dot s-${c.status}"></i>${ESTADOS[c.status]}</span>
          ${c.priority === 'alta' ? '<b class="hi">Prioridad alta</b>' : ''}
          ${c.tags.slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div></button>`;
      const pool = Store.projects.filter(bySearch).sort((a, b) => b.updated.localeCompare(a.updated));
      const allTags = new Map();
      Store.projects.forEach(c => c.tags.forEach(t => { const k = t.toLowerCase(); if (!allTags.has(k)) allTags.set(k, t); }));
      hf.tags.forEach(t => { if (!allTags.has(t)) hf.tags.delete(t); }); // olvida etiquetas que ya no existen
      const grid = list => `<div class="cards">${list.join('')}</div>`;
      let body;
      if (!pool.length) body = '<p class="none">Nada coincide con la búsqueda.</p>';
      else if (!anyF()) body = grid(pool.map(card));
      else {
        const ok = pool.filter(matches), no = pool.filter(c => !matches(c));
        body = `<h3 class="sec first">Coinciden con los filtros (${ok.length})</h3>` +
          (ok.length ? grid(ok.map(card)) : '<p class="none">Ningún proyecto cumple los filtros.</p>') +
          (no.length ? `<h3 class="sec">No coinciden con los filtros (${no.length})</h3>` + grid(no.map(c => card(c).replace('class="card"', 'class="card dim"'))) : '');
      }
      ed.innerHTML = `<div class="empty${has ? ' has' : ''}"><h2>${has ? 'Elige un proyecto' : 'Crea tu primer proyecto'}</h2>
        <p>${has ? 'Selecciónalo en la lista o en las tarjetas para verlo y editarlo.' : 'Todo lo que escribas se guarda solo.'}</p>
        <button class="primary" id="emptyNew">Nuevo proyecto</button></div>` +
        (has ? filterBar(allTags) + body : '');
      $('#emptyNew').onclick = create; return;
    }
    const sel_ = (f, o, v) => `<select data-f="${f}">${Object.entries(o).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    ed.innerHTML = `
      <input class="title" data-f="name" value="${esc(p.name)}" placeholder="Nombre del proyecto" aria-label="Nombre">
      ${p.images.length
        ? `<figure class="cover"><button class="cover-btn" data-act="lb" data-i="0" aria-label="Ver imágenes"><img src="${p.images[0]}" style="${pos(p)}" alt=""></button>
            <div class="cover-act">${p.images.length > 1 ? `<span class="badge">${p.images.length} imágenes</span>` : ''}<button class="mini" data-act="frame">Encuadrar</button><button class="mini" data-act="img-add">Añadir</button></div></figure>
          ${p.images.length > 1 ? `<details class="gal"${galOpen ? ' open' : ''}><summary>Todas las imágenes (${p.images.length})</summary>
            <div class="strip">${p.images.map((s, i) => `<button${i === 0 ? ' class="cover-on" title="Portada"' : ''} data-act="lb" data-i="${i}" aria-label="Ver imagen ${i + 1}"><img src="${s}" alt=""></button>`).join('')}</div></details>` : ''}`
        : `<button class="addimg" data-act="img-add">Añadir imágenes</button>`}
      <div class="row">
        <label>Estado ${sel_('status', ESTADOS, p.status)}</label>
        <label>Prioridad ${sel_('priority', PRIOS, p.priority)}</label>
        <label class="grow">Enlace <span class="lk"><input data-f="link" type="url" value="${esc(p.link)}" placeholder="https://github.com/…"><a id="lkOpen" href="${esc(p.link)}" target="_blank" rel="noopener"${p.link ? '' : ' hidden'}>Abrir</a></span></label>
      </div>
      <label>Etiquetas <input data-f="tags" value="${esc(p.tags.join(', '))}" placeholder="web, personal, python (separadas por comas)"></label>
      <label>Descripción <textarea data-f="description" rows="2" placeholder="En una o dos frases, ¿de qué va?">${esc(p.description)}</textarea></label>
      <label class="fill">Notas <textarea data-f="notes" class="notes" placeholder="Ideas, pendientes, decisiones, enlaces…">${esc(p.notes)}</textarea></label>
      <details class="docs"${docsOpen ? ' open' : ''}><summary>Documentos${p.docs.length ? ` (${p.docs.length})` : ''}</summary>
        <ul>${p.docs.map(d => `<li><button class="lnk" data-act="doc-get" data-id="${d.id}" title="Descargar">${esc(d.name)}</button><span>${fmt(d.size)}</span><button class="mini" data-act="doc-del" data-id="${d.id}">Quitar</button></li>`).join('')}</ul>
        <button class="mini" data-act="doc-add">Añadir documento</button>
      </details>
      <div class="foot"><span>Creado el ${new Date(p.created).toLocaleDateString('es-ES')}</span><button class="danger" id="delBtn">Eliminar proyecto</button></div>`;
    $('#delBtn').onclick = () => {
      if (!confirm(`¿Eliminar «${p.name || 'Sin nombre'}»? No se puede deshacer.`)) return;
      Store.remove(p.id); goHome();
    };
  }
  $('#editor').addEventListener('click', async e => {
    const c = e.target.closest('[data-open]'); if (c) { openProject(c.dataset.open); return; }
    const h = e.target.closest('[data-hf]');
    if (h) { const s = hf[h.dataset.hf], v = h.dataset.v; s.has(v) ? s.delete(v) : s.add(v); renderEditor(); return; }
    if (e.target.closest('[data-hclear]')) { Object.values(hf).forEach(s => s.clear()); renderEditor(); return; }
    const b = e.target.closest('[data-act]'), pr = Store.get(sel); if (!b || !pr) return;
    const act = b.dataset.act, id = b.dataset.id;
    try {
      if (act === 'lb') { lb = +b.dataset.i; renderLB(); history.pushState({ v: 'lb', id: sel, lb }, '');
      } else if (act === 'frame') { startFrame(0);
      } else if (act === 'img-add') {
        const files = await pick('image/*', true), imgs = [...pr.images];
        for (const f of files) { try { imgs.push(await shrink(f)); } catch { alert(`No se pudo leer «${f.name}» como imagen.`); } }
        if (imgs.length !== pr.images.length) { Store.update(sel, { images: imgs }); renderEditor(); }
      } else if (act === 'doc-add') {
        const files = await pick('*/*', true), docs = [...pr.docs];
        for (const f of files) {
          if (f.size > MAX_DOC) { alert(`«${f.name}» pesa ${fmt(f.size)}. El máximo es ${fmt(MAX_DOC)} porque los documentos se guardan dentro del archivo JSON.`); continue; }
          docs.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: f.name, type: f.type, size: f.size, data: await readData(f) });
        }
        if (docs.length !== pr.docs.length) { Store.update(sel, { docs }); docsOpen = true; renderEditor(); }
      } else if (act === 'doc-del') {
        Store.update(sel, { docs: pr.docs.filter(d => d.id !== id) }); docsOpen = true; renderEditor();
      } else if (act === 'doc-get') {
        const d = pr.docs.find(x => x.id === id); if (!d) return;
        const a = document.createElement('a'); a.href = d.data; a.download = d.name; a.click();
      }
    } catch (err) { alert('No se pudo procesar el archivo: ' + err.message); }
  });
  $('#editor').addEventListener('toggle', e => {
    const d = e.target;
    if (d.classList.contains('gal')) { galOpen = d.open; try { localStorage.setItem('proyectos:galeria', d.open ? '1' : '0'); } catch {} }
    else if (d.classList.contains('docs')) docsOpen = d.open;
  }, true);
  $('#editor').addEventListener('input', e => {
    const f = e.target.dataset.f; if (!f || !sel) return;
    let v = e.target.value;
    if (f === 'tags') v = v.split(',').map(t => t.trim()).filter(Boolean);
    Store.update(sel, { [f]: v });
    if (f === 'link') { const a = $('#lkOpen'); a.href = v; a.hidden = !v; }
    renderList();
  });

  function create() {
    const p = Store.add(); q = ''; filt = 'todos'; $('#search').value = '';
    openProject(p.id); const n = document.querySelector('.title'); n && n.focus();
  }
  $('#newBtn').onclick = create;
  $('#homeBtn').onclick = () => { q = ''; filt = 'todos'; $('#search').value = ''; goHome(); };
  $('#search').oninput = e => { q = e.target.value.trim().toLowerCase(); renderList(); };
  $('#filters').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { filt = b.dataset.f; renderList(); } };
  $('#list').onclick = e => { const b = e.target.closest('[data-id]'); if (b) openProject(b.dataset.id); };

  // ---------- Estado de guardado y archivo ----------
  function renderState(s) {
    const dest = Almacen.mode === 'file' ? Almacen.name : 'este navegador';
    $('#saveState').textContent = s === 'saving' ? 'Guardando…' : s === 'error' ? 'Error al guardar' : `Guardado en ${dest}`;
    $('#saveState').dataset.s = s;
  }
  Store.onStatus(renderState);

  function renderBanner() {
    const b = $('#banner'), m = Almacen.mode;
    if (m === 'file') { b.hidden = true; b.innerHTML = ''; b.style.display = 'none'; return; }
    b.hidden = false; b.style.display = '';
    if (m === 'permiso') {
      b.innerHTML = `<p>Para seguir guardando en <strong>${esc(Almacen.name)}</strong>, el navegador necesita tu permiso otra vez.</p><button class="primary" id="bReconnect">Reconectar</button>`;
      $('#bReconnect').onclick = () => connect(Almacen.reconnect);
    } else if (Almacen.canFile) {
      b.innerHTML = `<p>Ahora mismo se guarda solo en este navegador. Elige un archivo <strong>.json</strong> para tener tus datos en tu disco.</p>
        <button class="primary" id="bCreate">Crear archivo</button><button id="bOpen">Abrir existente</button>`;
      $('#bCreate').onclick = () => connect(() => Almacen.create(Store.snapshot()));
      $('#bOpen').onclick = () => connect(Almacen.open);
    } else {
      b.innerHTML = `<p>Este navegador no permite guardar en un archivo. Se guarda en el navegador; usa <strong>Exportar</strong> para hacer copias.</p>`;
    }
  }
  async function connect(fn) {
    try {
      const r = await fn();
      if (r.data && r.data.projects && r.data.projects.length) Store.load(r.data);
      else if (r.data === null || r.data === undefined) await Store.flush();
      renderBanner(); goHome(); renderState('saved');
    } catch (e) { if (e.name !== 'AbortError') alert('No se pudo acceder al archivo: ' + e.message); }
  }
  $('#fileBtn').onclick = () => Almacen.canFile
    ? connect(() => confirm('¿Abrir un archivo existente?\nAceptar = abrir existente · Cancelar = crear uno nuevo')
        ? Almacen.open() : Almacen.create(Store.snapshot()))
    : alert('Tu navegador no permite elegir archivo. Usa Exportar e Importar.');

  // ---------- Exportar / importar ----------
  $('#exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(Store.snapshot(), null, 2)], { type: 'application/json' }));
    a.download = 'proyectos.json'; a.click(); URL.revokeObjectURL(a.href);
  };
  $('#importBtn').onclick = () => $('#importInput').click();
  $('#importInput').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.projects)) throw new Error('El archivo no tiene una lista "projects".');
      if (!confirm('Esto reemplaza tus proyectos actuales por los del archivo. ¿Continuar?')) return;
      Store.load(d); await Store.flush(); goHome(); renderState('saved');
    } catch (err) { alert('No se pudo importar: ' + err.message); }
    e.target.value = '';
  };

  // ---------- Arranque ----------
  (async () => {
    try { const r = await Almacen.init(); Store.load(r.data); } catch (e) { console.error(e); }
    sel = null; // arranca siempre en la pantalla principal
    history.replaceState({ v: 'home' }, '');
    renderBanner(); renderList(); renderEditor(); renderState('saved');
  })();
})();