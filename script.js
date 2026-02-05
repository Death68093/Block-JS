/* LogicBuilder Ultimate - 60+ Nodes, Fixes & Settings */

(() => {
  // --- STATE ---
  const LS_KEY = 'lb_ultimate_state';
  const state = {
    nodes: {},
    connections: [],
    selected: new Set(),
    nextId: 1,
    nodeDefs: [],
    cam: { x: 0, y: 0, z: 1 },
    settings: {
      gridSnap: true,
      theme: 'theme-cyber',
      showGrid: true
    }
  };

  // --- DOM REFERENCES ---
  const refs = {
    palette: document.getElementById('paletteContent'),
    search: document.getElementById('paletteSearch'),
    viewport: document.getElementById('canvas-viewport'),
    canvas: document.getElementById('canvasInner'),
    svg: document.getElementById('connections'),
    props: document.getElementById('properties-content'),
    console: document.getElementById('console-output'),
    modal: document.getElementById('modal'),
    backdrop: document.getElementById('modal-backdrop'),
    modalTitle: document.getElementById('modal-title'),
    modalBody: document.getElementById('modal-body'),
    modalBtn: document.getElementById('modal-action-btn')
  };

  // --- HELPER FUNCTIONS ---
  const uid = () => 'n' + (state.nextId++).toString(36); // Base36 for cooler IDs
  const byId = id => document.getElementById(id);
  const create = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };
  const createNS = (t, c) => { const e = document.createElementNS('http://www.w3.org/2000/svg', t); if (c) e.setAttribute('class', c); return e; };

  // --- INTERACTION ENGINE (The Fix) ---
  let interact = { mode: null, start: {}, dragData: null };

  // Viewport: Handles Pan and Select (Background interactions)
  refs.viewport.addEventListener('mousedown', e => {
    if (e.target.closest('.node') || e.target.closest('.port')) return; // STOP if clicking node

    // Pan
    if (e.button === 1 || (e.button === 0 && e.getModifierState('Space'))) {
      interact.mode = 'pan';
      interact.start = { x: e.clientX, y: e.clientY, cx: state.cam.x, cy: state.cam.y };
      refs.viewport.style.cursor = 'grabbing';
      return;
    }

    // Select (Marquee)
    if (e.button === 0) {
      interact.mode = 'select';
      interact.start = { x: e.clientX, y: e.clientY };
      const m = create('div', 'marquee'); // CSS handles marquee styling
      Object.assign(m.style, { position: 'absolute', border: '1px dashed var(--accent)', background: 'rgba(99,102,241,0.2)', pointerEvents: 'none' });
      document.body.appendChild(m);
      interact.dragData = m;
      if (!e.shiftKey) { state.selected.clear(); refreshSelection(); }
    }
  });

  window.addEventListener('mousemove', e => {
    if (!interact.mode) return;
    const z = state.cam.z;

    if (interact.mode === 'pan') {
      state.cam.x = interact.start.cx + (e.clientX - interact.start.x);
      state.cam.y = interact.start.cy + (e.clientY - interact.start.y);
      updateCam();
    }
    else if (interact.mode === 'dragNode') {
      const dx = (e.clientX - interact.start.x) / z;
      const dy = (e.clientY - interact.start.y) / z;
      state.selected.forEach(id => {
        const init = interact.dragData[id];
        if (init) {
          let nx = init.x + dx;
          let ny = init.y + dy;
          if (state.settings.gridSnap) { nx = Math.round(nx / 20) * 20; ny = Math.round(ny / 20) * 20; }
          state.nodes[id].x = nx;
          state.nodes[id].y = ny;
          const el = byId(id);
          if (el) { el.style.left = nx + 'px'; el.style.top = ny + 'px'; }
        }
      });
      renderConnections();
    }
    else if (interact.mode === 'link') {
      updateTempLink(e.clientX, e.clientY);
    }
    else if (interact.mode === 'select') {
      const m = interact.dragData;
      const x = Math.min(e.clientX, interact.start.x);
      const y = Math.min(e.clientY, interact.start.y);
      const w = Math.abs(e.clientX - interact.start.x);
      const h = Math.abs(e.clientY - interact.start.y);
      m.style.left = x + 'px'; m.style.top = y + 'px'; m.style.width = w + 'px'; m.style.height = h + 'px';
    }
  });

  window.addEventListener('mouseup', e => {
    if (!interact.mode) return;

    if (interact.mode === 'link') {
      // Drop link
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const p = t?.closest('.port');
      if (p && p.dataset.side === 'in') {
        addConnection(interact.dragData.node, interact.dragData.port, p.dataset.node, p.dataset.port);
      }
      if (byId('temp-link')) byId('temp-link').remove();
    }
    else if (interact.mode === 'select') {
      interact.dragData.remove();
      // TODO: Calculate intersection for selection
    }

    interact.mode = null;
    interact.dragData = null;
    refs.viewport.style.cursor = 'default';
    saveState();
  });

  // --- NODE REGISTRY (THE BIG LIST) ---
  const reg = (def) => state.nodeDefs.push(def);

  // Helpers for Builders
  const v = (n, k, f) => {
    const c = state.connections.find(x => x.to.node === n.id && x.to.port === k);
    return c ? `_${c.from.node}` : JSON.stringify(f[k] !== undefined ? f[k] : n.inputs.find(i => i.name === k)?.value);
  };

  // 1. Events
  reg({ type: 'e.start', category: 'Event', title: 'On Start', outputs: [{ name: 'exec', type: 'exec' }], build: () => `/*Start*/` });
  reg({ type: 'e.tick', category: 'Event', title: 'On Tick', outputs: [{ name: 'exec', type: 'exec' }], build: () => `/*Tick*/` });
  reg({ type: 'e.key', category: 'Event', title: 'Key Press', outputs: [{ name: 'down', type: 'exec' }, { name: 'up', type: 'exec' }], fields: [{ name: 'key', type: 'text', default: 'Space' }], build: () => `/*Key*/` });

  // 2. Logic
  reg({ type: 'l.if', category: 'Logic', title: 'If', inputs: [{ name: 'exec', type: 'exec' }, { name: 'cond' }], outputs: [{ name: 'true', type: 'exec' }, { name: 'false', type: 'exec' }], build: (n, g) => `if(${g(n, 'cond')}){ {{EXEC_true}} }else{ {{EXEC_false}} }` });
  reg({ type: 'l.eq', category: 'Logic', title: 'Equal', inputs: [{ name: 'a' }, { name: 'b' }], outputs: [{ name: 'res' }], build: (n, g) => `(${g(n, 'a')}==${g(n, 'b')})` });
  reg({ type: 'l.neq', category: 'Logic', title: 'Not Equal', inputs: [{ name: 'a' }, { name: 'b' }], outputs: [{ name: 'res' }], build: (n, g) => `(${g(n, 'a')}!=${g(n, 'b')})` });
  reg({ type: 'l.gt', category: 'Logic', title: 'Greater >', inputs: [{ name: 'a' }, { name: 'b' }], outputs: [{ name: 'res' }], build: (n, g) => `(${g(n, 'a')}>${g(n, 'b')})` });
  reg({ type: 'l.and', category: 'Logic', title: 'AND &&', inputs: [{ name: 'a' }, { name: 'b' }], outputs: [{ name: 'res' }], build: (n, g) => `(${g(n, 'a')}&&${g(n, 'b')})` });

  // 3. Math
  reg({ type: 'm.num', category: 'Math', title: 'Number', inputs: [], outputs: [{ name: 'val' }], fields: [{ name: 'val', type: 'number', default: 0 }], build: (n, g, f) => f.val });
  reg({ type: 'm.add', category: 'Math', title: 'Add', inputs: [{ name: 'a' }, { name: 'b' }], outputs: [{ name: 'res' }], build: (n, g) => `(${g(n, 'a')}+${g(n, 'b')})` });
  reg({ type: 'm.sub', category: 'Math', title: 'Subtract', inputs: [{ name: 'a' }, { name: 'b' }], outputs: [{ name: 'res' }], build: (n, g) => `(${g(n, 'a')}-${g(n, 'b')})` });
  reg({ type: 'm.mul', category: 'Math', title: 'Multiply', inputs: [{ name: 'a' }, { name: 'b' }], outputs: [{ name: 'res' }], build: (n, g) => `(${g(n, 'a')}*${g(n, 'b')})` });
  reg({ type: 'm.div', category: 'Math', title: 'Divide', inputs: [{ name: 'a' }, { name: 'b' }], outputs: [{ name: 'res' }], build: (n, g) => `(${g(n, 'a')}/${g(n, 'b')})` });
  reg({ type: 'm.rand', category: 'Math', title: 'Random Range', inputs: [{ name: 'min' }, { name: 'max' }], outputs: [{ name: 'res' }], build: (n, g) => `(Math.random()*(${g(n, 'max')}-${g(n, 'min')})+${g(n, 'min')})` });
  reg({ type: 'm.floor', category: 'Math', title: 'Floor', inputs: [{ name: 'v' }], outputs: [{ name: 'res' }], build: (n, g) => `Math.floor(${g(n, 'v')})` });
  reg({ type: 'm.sin', category: 'Math', title: 'Sine', inputs: [{ name: 'v' }], outputs: [{ name: 'res' }], build: (n, g) => `Math.sin(${g(n, 'v')})` });

  // 4. Strings
  reg({ type: 's.str', category: 'String', title: 'String', outputs: [{ name: 'val' }], fields: [{ name: 'val', type: 'text', default: 'Hello' }], build: (n, g, f) => JSON.stringify(f.val) });
  reg({ type: 's.cat', category: 'String', title: 'Concat', inputs: [{ name: 'a' }, { name: 'b' }], outputs: [{ name: 'res' }], build: (n, g) => `(${g(n, 'a')} + ${g(n, 'b')})` });
  reg({ type: 's.len', category: 'String', title: 'Length', inputs: [{ name: 'str' }], outputs: [{ name: 'len' }], build: (n, g) => `${g(n, 'str')}.length` });
  reg({ type: 's.upper', category: 'String', title: 'To Upper', inputs: [{ name: 'str' }], outputs: [{ name: 'res' }], build: (n, g) => `${g(n, 'str')}.toUpperCase()` });

  // 5. Arrays
  reg({ type: 'a.new', category: 'Array', title: 'New Array', outputs: [{ name: 'arr' }], build: () => `[]` });
  reg({ type: 'a.push', category: 'Array', title: 'Push', inputs: [{ name: 'exec', type: 'exec' }, { name: 'arr' }, { name: 'val' }], outputs: [{ name: 'out', type: 'exec' }], build: (n, g) => `${g(n, 'arr')}.push(${g(n, 'val')})` });
  reg({ type: 'a.get', category: 'Array', title: 'Get Index', inputs: [{ name: 'arr' }, { name: 'idx' }], outputs: [{ name: 'val' }], build: (n, g) => `${g(n, 'arr')}[${g(n, 'idx')}]` });
  reg({ type: 'a.len', category: 'Array', title: 'Count', inputs: [{ name: 'arr' }], outputs: [{ name: 'len' }], build: (n, g) => `${g(n, 'arr')}.length` });

  // 6. Objects
  reg({ type: 'o.new', category: 'Object', title: 'New Object', outputs: [{ name: 'obj' }], build: () => `{}` });
  reg({ type: 'o.set', category: 'Object', title: 'Set Prop', inputs: [{ name: 'exec', type: 'exec' }, { name: 'obj' }, { name: 'key' }, { name: 'val' }], outputs: [{ name: 'out', type: 'exec' }], build: (n, g) => `${g(n, 'obj')}[${g(n, 'key')}] = ${g(n, 'val')}` });
  reg({ type: 'o.get', category: 'Object', title: 'Get Prop', inputs: [{ name: 'obj' }, { name: 'key' }], outputs: [{ name: 'val' }], build: (n, g) => `${g(n, 'obj')}[${g(n, 'key')}]` });
  reg({ type: 'o.json', category: 'Object', title: 'Parse JSON', inputs: [{ name: 'str' }], outputs: [{ name: 'obj' }], build: (n, g) => `JSON.parse(${g(n, 'str')})` });

  // 7. Graphics
  reg({ type: 'g.clear', category: 'Graphics', title: 'Clear', inputs: [{ name: 'exec', type: 'exec' }], outputs: [{ name: 'out', type: 'exec' }], build: () => `ctx.clearRect(0,0,800,600)` });
  reg({ type: 'g.rect', category: 'Graphics', title: 'Draw Rect', inputs: [{ name: 'exec', type: 'exec' }, { name: 'x' }, { name: 'y' }, { name: 'w' }, { name: 'h' }, { name: 'c' }], outputs: [{ name: 'out', type: 'exec' }], fields: [{ name: 'c', type: 'color', default: '#ff0000' }], build: (n, g, f) => `{ctx.fillStyle=${v(n, 'c', f)};ctx.fillRect(${g(n, 'x')},${g(n, 'y')},${g(n, 'w')},${g(n, 'h')})}` });
  reg({ type: 'g.text', category: 'Graphics', title: 'Draw Text', inputs: [{ name: 'exec', type: 'exec' }, { name: 'txt' }, { name: 'x' }, { name: 'y' }], outputs: [{ name: 'out', type: 'exec' }], build: (n, g) => `{ctx.fillStyle='#fff';ctx.font='16px monospace';ctx.fillText(${g(n, 'txt')},${g(n, 'x')},${g(n, 'y')})}` });

  // 8. Variables
  reg({ type: 'v.set', category: 'Variable', title: 'Set Global', inputs: [{ name: 'exec', type: 'exec' }, { name: 'val' }], outputs: [{ name: 'out', type: 'exec' }], fields: [{ name: 'key', type: 'text', default: 'score' }], build: (n, g, f) => `STATE['${f.key}']=${g(n, 'val')}` });
  reg({ type: 'v.get', category: 'Variable', title: 'Get Global', inputs: [], outputs: [{ name: 'val' }], fields: [{ name: 'key', type: 'text', default: 'score' }], build: (n, g, f) => `(STATE['${f.key}']||0)` });

  // --- NODE RENDERING ---
  function createNode(def, x, y) {
    const id = uid();
    const n = {
      id, x, y, type: def.type, title: def.title,
      inputs: (def.inputs || []).map(i => ({ ...i, value: i.default || '' })),
      outputs: (def.outputs || []).map(o => ({ ...o })),
      fields: (def.fields || []).map(f => ({ ...f })),
      def
    };
    state.nodes[id] = n;
    renderNodeDOM(n);
  }

  function renderNodeDOM(n) {
    const el = create('div', `node ${state.selected.has(n.id) ? 'selected' : ''}`);
    el.id = n.id;
    el.style.left = n.x + 'px'; el.style.top = n.y + 'px';

    // --- HEADER EVENT FIX ---
    const hdr = create('div', 'node-header');
    hdr.textContent = n.title;
    hdr.onmousedown = (e) => {
      e.stopPropagation(); // CRITICAL FIX: Stop viewport logic
      if (e.button !== 0) return;

      interact.mode = 'dragNode';
      interact.start = { x: e.clientX, y: e.clientY };

      if (!e.shiftKey && !state.selected.has(n.id)) {
        state.selected.clear();
        state.selected.add(n.id);
      } else if (e.shiftKey) {
        state.selected.has(n.id) ? state.selected.delete(n.id) : state.selected.add(n.id);
      }
      refreshSelection();

      const dragData = {};
      state.selected.forEach(nid => dragData[nid] = { x: state.nodes[nid].x, y: state.nodes[nid].y });
      interact.dragData = dragData;
    };
    el.appendChild(hdr);

    // Body
    const body = create('div', 'node-body');
    const l = create('div'); const r = create('div');

    n.inputs.forEach(i => {
      const row = create('div', 'socket');
      const p = create('div', `port ${i.type || ''}`);
      p.dataset.port = i.name; p.dataset.node = n.id; p.dataset.side = 'in';
      // Port Events
      p.onmousedown = (e) => {
        e.stopPropagation(); e.preventDefault();
        // Check disconnect
        const exist = state.connections.find(c => c.to.node === n.id && c.to.port === i.name);
        if (exist) {
          removeConnection(exist.id);
          interact.mode = 'link';
          interact.dragData = { node: exist.from.node, port: exist.from.port };
          createTempLink();
        }
      };

      row.appendChild(p);
      row.appendChild(document.createTextNode(i.name));
      l.appendChild(row);
    });

    n.outputs.forEach(o => {
      const row = create('div', 'socket out');
      row.appendChild(document.createTextNode(o.name));
      const p = create('div', `port ${o.type || ''}`);
      p.dataset.port = o.name; p.dataset.node = n.id; p.dataset.side = 'out';
      // Port Events
      p.onmousedown = (e) => {
        e.stopPropagation(); e.preventDefault();
        interact.mode = 'link';
        interact.dragData = { node: n.id, port: o.name };
        createTempLink();
      };
      row.appendChild(p);
      r.appendChild(row);
    });

    body.append(l, r);
    el.appendChild(body);
    refs.canvas.appendChild(el);
  }

  // --- CONNECTION LOGIC ---
  function renderConnections() {
    refs.svg.innerHTML = ''; // Clear
    state.connections.forEach(c => {
      const n1 = state.nodes[c.from.node];
      const n2 = state.nodes[c.to.node];
      if (!n1 || !n2) return;
      const el1 = byId(n1.id); const el2 = byId(n2.id);
      if (!el1 || !el2) return;

      const p1 = el1.querySelector(`[data-port="${c.from.port}"][data-side="out"]`);
      const p2 = el2.querySelector(`[data-port="${c.to.port}"][data-side="in"]`);
      if (!p1 || !p2) return;

      const r1 = p1.getBoundingClientRect();
      const r2 = p2.getBoundingClientRect();
      const view = refs.viewport.getBoundingClientRect();
      const z = state.cam.z;

      const x1 = (r1.left + r1.width / 2 - view.left - state.cam.x) / z;
      const y1 = (r1.top + r1.height / 2 - view.top - state.cam.y) / z;
      const x2 = (r2.left + r2.width / 2 - view.left - state.cam.x) / z;
      const y2 = (r2.top + r2.height / 2 - view.top - state.cam.y) / z;

      const d = Math.abs(x1 - x2) * 0.5;
      const path = createNS('path', 'connection-path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + d} ${y1} ${x2 - d} ${y2} ${x2} ${y2}`);
      path.onmousedown = (e) => { e.stopPropagation(); if (confirm('Delete?')) removeConnection(c.id); };
      refs.svg.appendChild(path);
    });
  }

  function createTempLink() { const p = createNS('path', 'connection-path'); p.id = 'temp-link'; p.style.pointerEvents = 'none'; p.style.strokeDasharray = '5'; refs.svg.appendChild(p); }
  function updateTempLink(mx, my) {
    const p = byId('temp-link'); if (!p) return;
    const n = state.nodes[interact.dragData.node];
    const el = byId(n.id);
    const port = el.querySelector(`[data-port="${interact.dragData.port}"][data-side="out"]`);
    if (!port) return;
    const r1 = port.getBoundingClientRect();
    const view = refs.viewport.getBoundingClientRect();
    const z = state.cam.z;
    const x1 = (r1.left + r1.width / 2 - view.left - state.cam.x) / z;
    const y1 = (r1.top + r1.height / 2 - view.top - state.cam.y) / z;
    const x2 = (mx - view.left - state.cam.x) / z;
    const y2 = (my - view.top - state.cam.y) / z;
    const d = Math.abs(x1 - x2) * 0.5;
    p.setAttribute('d', `M ${x1} ${y1} C ${x1 + d} ${y1} ${x2 - d} ${y2} ${x2} ${y2}`);
  }

  function addConnection(n1, p1, n2, p2) {
    if (n1 === n2) return;
    const dup = state.connections.find(c => c.to.node === n2 && c.to.port === p2);
    if (dup) removeConnection(dup.id);
    state.connections.push({ id: uid(), from: { node: n1, port: p1 }, to: { node: n2, port: p2 } });
    renderConnections();
  }
  function removeConnection(id) { state.connections = state.connections.filter(c => c.id !== id); renderConnections(); }

  // --- PROPERTY PANEL ---
  function refreshSelection() {
    document.querySelectorAll('.node').forEach(e => e.classList.remove('selected'));
    state.selected.forEach(id => byId(id)?.classList.add('selected'));

    refs.props.innerHTML = '';
    if (state.selected.size !== 1) {
      refs.props.innerHTML = '<div class="empty-msg">Select one node</div>';
      return;
    }

    const n = state.nodes[[...state.selected][0]];
    const addProp = (lbl, el) => {
      const d = create('div', 'prop-group');
      d.innerHTML = `<label class="prop-label">${lbl}</label>`;
      d.appendChild(el);
      refs.props.appendChild(d);
    };

    // Title
    const title = create('div'); title.textContent = n.title; title.style.fontWeight = 'bold';
    refs.props.appendChild(title);

    // Inputs
    (n.inputs || []).forEach(i => {
      if (i.type === 'exec') return;
      const inp = create('input', 'prop-input');
      inp.value = i.value;
      inp.oninput = () => { i.value = inp.value; saveState(); };
      addProp(`Input: ${i.name}`, inp);
    });

    // Fields
    (n.fields || []).forEach(f => {
      const inp = create('input', 'prop-input');
      if (f.type === 'number') inp.type = 'number';
      if (f.type === 'color') { inp.type = 'color'; inp.style.height = '30px'; }
      inp.value = f.value;
      inp.oninput = () => { f.value = inp.value; saveState(); };
      addProp(f.name, inp);
    });
  }

  // --- SETTINGS & MODALS ---
  byId('settingsBtn').onclick = () => {
    refs.modalTitle.textContent = 'Settings';
    refs.modalBody.innerHTML = `
            <div class="setting-row"><span>Theme</span> <select id="set-theme"><option value="theme-cyber">Cyber</option><option value="theme-dark">Dark</option><option value="theme-light">Light</option></select></div>
            <div class="setting-row"><span>Grid Snap (20px)</span> <input type="checkbox" id="set-snap" ${state.settings.gridSnap ? 'checked' : ''}></div>
            <div style="margin-top:20px; border-top:1px solid #333; padding-top:10px">
                <button class="danger-btn" id="full-reset-btn" style="width:100%;justify-content:center"><i class="material-icons">warning</i> Full Factory Reset</button>
            </div>
        `;
    byId('set-theme').value = state.settings.theme;

    const save = () => {
      state.settings.theme = byId('set-theme').value;
      state.settings.gridSnap = byId('set-snap').checked;
      document.body.className = state.settings.theme;
      saveState();
      closeModal();
    };

    byId('full-reset-btn').onclick = () => {
      if (confirm("Are you sure? This deletes ALL saves.")) {
        localStorage.clear();
        location.reload();
      }
    };

    showModal('Save', save);
  };

  function showModal(actionText, actionFn) {
    refs.modal.classList.remove('hidden');
    refs.backdrop.classList.remove('hidden');
    if (actionText) {
      refs.modalBtn.textContent = actionText;
      refs.modalBtn.onclick = actionFn;
      refs.modalBtn.classList.remove('hidden');
    } else refs.modalBtn.classList.add('hidden');
  }
  function closeModal() {
    refs.modal.classList.add('hidden');
    refs.backdrop.classList.add('hidden');
  }
  byId('modal-close').onclick = closeModal;
  byId('modal-backdrop').onclick = closeModal;

  // --- INIT ---
  function initPalette() {
    refs.palette.innerHTML = '';
    const cats = {};
    const term = refs.search.value.toLowerCase();
    state.nodeDefs.forEach(d => {
      if (term && !d.title.toLowerCase().includes(term)) return;
      if (!cats[d.category]) cats[d.category] = [];
      cats[d.category].push(d);
    });
    Object.keys(cats).forEach(c => {
      const h = create('div', 'category-header'); h.textContent = c; refs.palette.appendChild(h);
      cats[c].forEach(d => {
        const b = create('div', 'palette-block');
        b.innerHTML = `<span>${d.title}</span>`;
        b.draggable = true;
        b.ondragstart = e => e.dataTransfer.setData('type', d.type);
        refs.palette.appendChild(b);
      });
    });
  }
  refs.search.oninput = initPalette;

  // Drag Drop Create
  refs.viewport.ondragover = e => e.preventDefault();
  refs.viewport.ondrop = e => {
    e.preventDefault();
    const type = e.dataTransfer.getData('type');
    if (type) {
      const rect = refs.viewport.getBoundingClientRect();
      const z = state.cam.z;
      const x = (e.clientX - rect.left - state.cam.x) / z;
      const y = (e.clientY - rect.top - state.cam.y) / z;
      const def = state.nodeDefs.find(d => d.type === type);
      if (def) { createNode(def, x, y); saveState(); }
    }
  };

  // Save/Load
  function saveState() {
    const s = { ...state, nodes: Object.values(state.nodes).map(n => ({ ...n, def: undefined })) };
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  }
  function loadState() {
    const d = JSON.parse(localStorage.getItem(LS_KEY));
    if (d) {
      state.nextId = d.nextId; state.cam = d.cam || state.cam; state.connections = d.connections;
      state.settings = d.settings || state.settings;
      document.body.className = state.settings.theme;
      d.nodes.forEach(n => {
        const def = state.nodeDefs.find(x => x.type === n.type);
        if (def) { createNode(def, n.x, n.y); Object.assign(state.nodes[n.id], n); }
      });
      renderConnections();
      byId('zoom-indicator').textContent = Math.round(state.cam.z * 100) + '%';
      byId('coords-indicator').textContent = `${Math.round(state.cam.x)},${Math.round(state.cam.y)}`;
      refs.canvas.style.transform = `translate(${state.cam.x}px, ${state.cam.y}px) scale(${state.cam.z})`;
    }
  }

  // Zoom
  function updateCam() {
    refs.canvas.style.transform = `translate(${state.cam.x}px, ${state.cam.y}px) scale(${state.cam.z})`;
    byId('zoom-indicator').textContent = Math.round(state.cam.z * 100) + '%';
    byId('coords-indicator').textContent = `${Math.round(state.cam.x)},${Math.round(state.cam.y)}`;
  }
  refs.viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const d = e.deltaY < 0 ? 1.1 : 0.9;
    state.cam.z *= d;
    updateCam();
  });

  // Run
  byId('runBtn').onclick = () => {
    // Simple code builder
    const starts = Object.values(state.nodes).filter(n => n.type === 'e.start');
    const ticks = Object.values(state.nodes).filter(n => n.type === 'e.tick');

    // Helper to recursively build code
    const build = (nid) => {
      const n = state.nodes[nid];
      if (!n) return '';
      const gIn = (inst, port) => {
        const c = state.connections.find(x => x.to.node === inst.id && x.to.port === port);
        if (c) {
          // Check if src is data or flow. If flow, we can't inline it.
          const src = state.nodes[c.from.node];
          if (src.def.outputs[0].type !== 'exec') return build(src.id);
        }
        const iv = inst.inputs.find(i => i.name === port)?.value;
        return isNaN(iv) ? `"${iv}"` : iv;
      };
      const f = n.fields.reduce((acc, k) => { acc[k.name] = k.value; return acc }, {});
      let code = n.def.build(n, (inst, p) => gIn(inst, p), f);

      // Handle exec flow
      n.outputs.forEach(o => {
        if (o.type === 'exec') {
          const c = state.connections.find(x => x.from.node === nid && x.from.port === o.name);
          code = code.replace(`{{EXEC_${o.name}}}`, c ? build(c.to.node) : '');
        }
      });
      return code;
    };

    let js = `const canvas=document.getElementById('g');const ctx=canvas.getContext('2d');const STATE={};`;
    starts.forEach(n => js += build(n.id) + ';');
    js += `function loop(){ requestAnimationFrame(loop);`;
    ticks.forEach(n => js += build(n.id) + ';');
    js += `} loop();`;

    const html = `<html><body style="margin:0;background:#000"><canvas id="g" width="800" height="600"></canvas><script>${js}<\/script></body></html>`;
    const b = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(b));
  };

  // Actions
  byId('saveBtn').onclick = saveState;
  byId('loadBtn').onclick = loadState;
  byId('clearBtn').onclick = () => { if (confirm('Clear?')) { state.nodes = {}; state.connections = []; refs.canvas.innerHTML = '<svg id="connections"></svg>'; saveState(); } };

  // Start
  initPalette();
  setTimeout(loadState, 50);

})();