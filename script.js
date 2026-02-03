// == Titan Editor: Updated script.js ==
// Implements:
// 1) Export JS for all nodes (special cases + generic fallback)
// 2) Exec I/O auto-added to all nodes
// 3) DOM click outputs element
// 4) LocalStorage autosave/load
// 5) Run in editor (no new window) option
// 6) Improved IO labels
// 7) var.set reflected in Variables panel (variables pulled from nodes + saved state)
// 8) Multi-select movement
// 9) Comment block (resizable group block)

// --- CONFIG & STATE ---
const CONFIG = { gridSize: 20, snapRadius: 15, storageKey: 'titan_project_v1' };

const STATE = {
  nodes: {}, connections: [], variables: {}, transform: { x: 0, y: 0, k: 1 },
  dragging: null, selection: [], isRunning: false, plugins: {}, timers: {}, runWindow: null, _origConsole: null, functions: {}
};

// --- DOM refs ---
const DOM = {
  canvas: document.getElementById('canvasInner'),
  svg: document.getElementById('connections'),
  viewport: document.getElementById('canvas-viewport'),
  palette: document.getElementById('paletteContent'),
  console: document.getElementById('console-output'),
  props: document.getElementById('properties-content'),
  vars: document.getElementById('variables-list'),
  zoomInd: document.getElementById('zoom-indicator'),
  coordsInd: document.getElementById('coords-indicator'),
  pluginsList: document.getElementById('plugins-list'),
  modal: document.getElementById('modal'),
  modalBackdrop: document.getElementById('modal-backdrop'),
  modalTitle: document.getElementById('modal-title'),
  modalBody: document.getElementById('modal-body'),
  contextMenu: document.getElementById('context-menu'),
  runWindowBtn: document.getElementById('openRunWindowBtn'),
  stepBtn: document.getElementById('stepBtn'),
  paletteSearch: document.getElementById('paletteSearch'),
  runBtn: document.getElementById('runBtn'),
  runEditorBtn: document.getElementById('runEditorBtn'),
  stopBtn: document.getElementById('stopBtn'),
  exportBtn: document.getElementById('export-js-btn'),
  exportPreviewBtn: document.getElementById('export-js-preview-btn'),
  exportTextarea: document.getElementById('export-js-textarea'),
  fileInput: document.getElementById('fileInput'),
  saveBtn: document.getElementById('saveBtn'),
  loadBtn: document.getElementById('loadBtn'),
  clearBtn: document.getElementById('clearBtn'),
  pluginBtn: document.getElementById('pluginBtn'),
  docsBtn: document.getElementById('docsBtn'),
  themeBtn: document.getElementById('themeBtn')
};

Object.keys(DOM).forEach(k => { if(!DOM[k]) console.warn('DOM missing:', k); });

// --- Utils ---
const uid = () => 'n_' + Math.random().toString(36).slice(2,10);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function isExecIO(list){ return list && list.some(i=> i.type==='exec'); }

// --- Registry & automatic exec-adder ---
// registerNode will automatically ensure an exec input and exec output exist for every node
const REGISTRY = {};
function ensureExecIO(arr, isInput=true){
  arr = arr || [];
  if(!arr.some(i => i.type === 'exec')) {
    if(isInput) arr.unshift({ id: 'exec', type: 'exec', label: 'In' });
    else arr.push({ id: 'exec', type: 'exec', label: 'Out' });
  }
  return arr;
}
function registerNode(type, cat, name, inputs = [], outputs = [], execFunc = null) {
  // copy arrays to avoid mutation
  inputs = JSON.parse(JSON.stringify(inputs || []));
  outputs = JSON.parse(JSON.stringify(outputs || []));
  // ensure exec present on both sides
  inputs = ensureExecIO(inputs, true);
  outputs = ensureExecIO(outputs, false);
  REGISTRY[type] = { type, cat, name, inputs, outputs, execFunc };
}
function registerPlugin(id, meta) {
  STATE.plugins[id] = meta || { id, name: id };
  renderPlugins();
}
window.registerNode = registerNode;
window.registerPlugin = registerPlugin;

// --- Logging & run-window forwarding ---
function forwardToRunWindow(level, msg){
  if(!STATE.runWindow || STATE.runWindow.closed) return;
  try {
    const rc = STATE.runWindow.document.getElementById('run-console');
    const line = STATE.runWindow.document.createElement('div');
    line.className = 'log-line ' + (level === 'error' ? 'error' : (level === 'warn' ? 'warn' : 'info'));
    line.textContent = `[${new Date().toLocaleTimeString()}] ${String(msg)}`;
    rc.appendChild(line); rc.scrollTop = rc.scrollHeight;
  } catch(e){}
}
function formatForLog(x){ try { if(typeof x === 'object') return JSON.stringify(x); return String(x); } catch(e){ return String(x); } }
function log(msg, type='info'){ if(!DOM.console) return; const div = document.createElement('div'); div.className = 'log-line ' + type; div.textContent = `[${new Date().toLocaleTimeString()}] ${String(msg)}`; DOM.console.appendChild(div); DOM.console.scrollTop = DOM.console.scrollHeight; }

// --- NODE SET (comprehensive, with exec IO auto-added by registerNode) ---
/* Events */
registerNode('evt.start','Events','On Start', [], [{id:'exec', type:'exec'}]);
registerNode('evt.interval','Events','Interval', [{id:'exec',type:'exec'},{id:'ms',type:'number',val:1000}], [{id:'exec',type:'exec'}], async (ctx) => {
  const n = ctx.node; const ms = Number(await ctx.eval('ms'))||1000;
  if(STATE.timers[n.id]) clearInterval(STATE.timers[n.id]);
  STATE.timers[n.id] = setInterval(()=> { try{ ctx.trigger('exec'); }catch(e){} }, ms);
  return null;
});
// DOM click: improved outputs -> exec + el (element) + selector
registerNode('evt.click','Events','On DOM Click',[{id:'exec',type:'exec'},{id:'sel',type:'string',val:'#btn'}],[{id:'exec',type:'exec'},{id:'el',type:'object'}], async (ctx)=>{
  const sel = await ctx.eval('sel'); const n = ctx.node; const el = document.querySelector(sel);
  if(!el) return null;
  if(n._handler && n._handlerEl) try{ n._handlerEl.removeEventListener('click', n._handler); }catch(e){}
  const handler = ()=> ctx.trigger('exec').catch(()=>{});
  n._handler = handler; n._handlerEl = el; n._lastEl = el;
  el.addEventListener('click', handler);
  return null;
});

/* Console */
registerNode('console.log','Console','Console Log',[{id:'exec',type:'exec'},{id:'msg',type:'any'}],[{id:'exec',type:'exec'}], async (ctx)=> { const m = await ctx.eval('msg'); log(m,'info'); forwardToRunWindow('info', m); return 'exec'; });
registerNode('console.warn','Console','Console Warn',[{id:'exec',type:'exec'},{id:'msg',type:'any'}],[{id:'exec',type:'exec'}], async (ctx)=> { const m = await ctx.eval('msg'); log(m,'warn'); forwardToRunWindow('warn', m); return 'exec'; });
registerNode('console.clear','Console','Console Clear',[{id:'exec',type:'exec'}],[{id:'exec',type:'exec'}], async (ctx)=> { if(DOM.console) DOM.console.innerHTML = ''; if(STATE.runWindow && !STATE.runWindow.closed) try{ STATE.runWindow.document.getElementById('run-console').innerHTML = ''; }catch(e){} return 'exec'; });

/* Browser */
registerNode('browser.alert','Browser','Alert',[{id:'exec',type:'exec'},{id:'msg',type:'string'}],[{id:'exec',type:'exec'}], async (ctx)=> { alert(await ctx.eval('msg')); return 'exec'; });
registerNode('browser.prompt','Browser','Prompt',[{id:'exec',type:'exec'},{id:'msg',type:'string'}],[{id:'res',type:'string'},{id:'exec',type:'exec'}], async (ctx)=> prompt(await ctx.eval('msg')) || '');
registerNode('browser.open','Browser','Open URL',[{id:'exec',type:'exec'},{id:'url',type:'string'}],[{id:'exec',type:'exec'}], async (ctx)=> { window.open(await ctx.eval('url'),'_blank'); return 'exec'; });

/* Variables */
registerNode('var.set','Variables','Set Variable',[{id:'exec',type:'exec'},{id:'name',type:'string',val:'myVar'},{id:'val',type:'any'}],[{id:'exec',type:'exec'}], async (ctx)=> {
  const name = await ctx.eval('name'); const val = await ctx.eval('val');
  STATE.variables[name] = val; updateVarPanel(); forwardToRunWindow('info', `var ${name} = ${JSON.stringify(val)}`); return 'exec';
});
registerNode('var.get','Variables','Get Variable',[{id:'exec',type:'exec'},{id:'name',type:'string',val:'myVar'}],[{id:'exec',type:'exec'},{id:'val',type:'any'}], async (ctx)=> STATE.variables[await ctx.eval('name')]);
registerNode('var.const','Variables','Create Constant',[{id:'exec',type:'exec'},{id:'name',type:'string'},{id:'val',type:'any'}],[{id:'exec',type:'exec'}], async (ctx)=> { const name = await ctx.eval('name'); const val = await ctx.eval('val'); Object.defineProperty(STATE.variables, name, { value: val, writable:false, configurable:false, enumerable:true }); updateVarPanel(); return 'exec'; });

/* Logic / Flow */
registerNode('logic.if','Logic','If / Else',[{id:'exec',type:'exec'},{id:'cond',type:'boolean'}],[{id:'true',type:'exec',label:'Then'},{id:'false',type:'exec',label:'Else'},{id:'exec',type:'exec'}], async (ctx)=> { const cond = await ctx.eval('cond'); return cond ? 'true' : 'false'; });
registerNode('flow.wait','Flow','Wait (ms)',[{id:'exec',type:'exec'},{id:'ms',type:'number',val:1000}],[{id:'exec',type:'exec'}], async (ctx)=> { const ms = Number(await ctx.eval('ms'))||0; await new Promise(r=>setTimeout(r,ms)); return 'exec'; });
registerNode('flow.for','Loops','For Loop',[{id:'exec',type:'exec'},{id:'start',type:'number',val:0},{id:'end',type:'number',val:10}],[{id:'loop',type:'exec',label:'Loop'},{id:'done',type:'exec',label:'Done'},{id:'idx',type:'number'},{id:'exec',type:'exec'}], async (ctx)=> { const s=Number(await ctx.eval('start')), e=Number(await ctx.eval('end')); for(let i=s;i<e;i++){ if(!STATE.isRunning) break; ctx.setTempOutput('idx', i); await ctx.trigger('loop'); } return 'done'; });

/* Arrays */
registerNode('arr.create','Arrays','Create Array',[{id:'exec',type:'exec'}],[{id:'arr',type:'array'},{id:'exec',type:'exec'}], async (ctx)=> []);
registerNode('arr.push','Arrays','Push',[{id:'exec',type:'exec'},{id:'arr',type:'array'},{id:'val',type:'any'}],[{id:'arr',type:'array'},{id:'exec',type:'exec'}], async (ctx)=> { const a = (await ctx.eval('arr'))||[]; a.push(await ctx.eval('val')); return a; });

/* Math */
registerNode('math.op','Math','Math Op',[{id:'exec',type:'exec'},{id:'a',type:'number'},{id:'op',type:'string',val:'+'},{id:'b',type:'number'}],[{id:'res',type:'number'},{id:'exec',type:'exec'}], async (ctx)=> { const a=Number(await ctx.eval('a')); const b=Number(await ctx.eval('b')); const op = ctx.input('op'); switch(op){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;default:return 0;} });

/* Strings */
registerNode('str.join','Strings','Join',[{id:'exec',type:'exec'},{id:'a',type:'string'},{id:'sep',type:'string',val:''},{id:'b',type:'string'}],[{id:'res',type:'string'},{id:'exec',type:'exec'}], async (ctx)=> `${await ctx.eval('a')}${await ctx.eval('sep')}${await ctx.eval('b')}`);

/* DOM Manipulation */
registerNode('dom.get_by_id','DOM','Get Element by ID',[{id:'exec',type:'exec'},{id:'id',type:'string'}],[{id:'el',type:'object'},{id:'exec',type:'exec'}], async (ctx)=> document.getElementById(await ctx.eval('id')));
registerNode('dom.set_text','DOM','Set Inner Text',[{id:'exec',type:'exec'},{id:'sel',type:'string'},{id:'text',type:'string'}],[{id:'exec',type:'exec'}], async (ctx)=> { const sel = await ctx.eval('sel'); const txt = await ctx.eval('text'); const el = document.querySelector(sel); if(!el) throw new Error('Selector not found: '+sel); el.innerText = txt; forwardToRunWindow('info', `DOM set text: ${sel}`); return 'exec'; });
registerNode('dom.set_html','DOM','Set Inner HTML',[{id:'exec',type:'exec'},{id:'sel',type:'string'},{id:'html',type:'string'}],[{id:'exec',type:'exec'}], async (ctx)=> { const sel = await ctx.eval('sel'); const html = await ctx.eval('html'); const el = document.querySelector(sel); if(!el) throw new Error('Selector not found: '+sel); el.innerHTML = html; forwardToRunWindow('info', `DOM set html: ${sel}`); return 'exec'; });
registerNode('dom.set_style','DOM','Set Style',[{id:'exec',type:'exec'},{id:'sel',type:'string'},{id:'prop',type:'string'},{id:'val',type:'string'}],[{id:'exec',type:'exec'}], async (ctx)=> { const sel = await ctx.eval('sel'); const prop = await ctx.eval('prop'); const val = await ctx.eval('val'); const el = document.querySelector(sel); if(!el) throw new Error('Selector not found: '+sel); el.style[prop] = val; forwardToRunWindow('info', `DOM set style: ${sel} ${prop}=${val}`); return 'exec'; });
registerNode('dom.on','DOM','Add Event Listener',[{id:'exec',type:'exec'},{id:'sel',type:'string'},{id:'event',type:'string',val:'click'}],[{id:'exec',type:'exec'},{id:'el',type:'object'}], async (ctx)=> {
  const sel = await ctx.eval('sel'); const ev = await ctx.eval('event'); const els = document.querySelectorAll(sel);
  if(!els || els.length===0) return null;
  els.forEach(el => {
    const handler = ()=> ctx.trigger('exec').catch(()=>{});
    el.addEventListener(ev, handler);
    ctx.node._listeners = ctx.node._listeners || []; ctx.node._listeners.push({el, ev, handler});
    ctx.node._lastEl = el;
  });
  return null;
});

/* Functions */
registerNode('fn.define','Functions','Define Function',[{id:'exec',type:'exec'},{id:'name',type:'string'},{id:'code',type:'string'}],[{id:'exec',type:'exec'}], async (ctx)=> { const name = await ctx.eval('name'); const code = await ctx.eval('code'); STATE.functions = STATE.functions || {}; STATE.functions[name] = code; return 'exec'; });
registerNode('fn.call','Functions','Call Function',[{id:'exec',type:'exec'},{id:'name',type:'string'},{id:'args',type:'array'}],[{id:'res',type:'any'},{id:'exec',type:'exec'}], async (ctx)=> { const name = await ctx.eval('name'); const args = await ctx.eval('args')||[]; const code = STATE.functions && STATE.functions[name]; if(!code) throw new Error('Function not found: '+name); const fn = new Function('args','state','log','return ('+code+')(args,state,log);'); const res = fn(args, STATE, (m)=>{ log('[fn] '+m,'info'); forwardToRunWindow('info','[fn] '+m); }); return res; });

/* Literals */
registerNode('data.string','Literals','String Literal',[{id:'exec',type:'exec'},{id:'val',type:'string',val:''}],[{id:'val',type:'string'},{id:'exec',type:'exec'}], (ctx)=> ctx.input('val'));
registerNode('data.number','Literals','Number Literal',[{id:'exec',type:'exec'},{id:'val',type:'number',val:0}],[{id:'val',type:'number'},{id:'exec',type:'exec'}], (ctx)=> parseFloat(ctx.input('val')));
registerNode('comment','UI','Comment',[{id:'exec',type:'exec'},{id:'title',type:'string',val:'Comment'}],[{id:'exec',type:'exec'}], async (ctx)=> null);

// --- PALETTE RENDERER & SEARCH ---
function initPalette(){
  if(!DOM.palette) return;
  DOM.palette.innerHTML = '';
  DOM.palette.style.overflowY = 'auto';
  DOM.palette.style.webkitOverflowScrolling = 'touch';
  const cats = {};
  Object.values(REGISTRY).forEach(def => {
    if(!cats[def.cat]) cats[def.cat] = [];
    cats[def.cat].push(def);
  });
  Object.keys(cats).sort().forEach(c => {
    const header = document.createElement('div'); header.className='category-header'; header.textContent = c;
    header.dataset.category = c.toLowerCase();
    DOM.palette.appendChild(header);
    cats[c].forEach(def => {
      const el = document.createElement('div'); el.className='palette-block';
      el.innerHTML = `<i class="material-icons" style="font-size:14px">extension</i> ${def.name} <span class="meta">${def.type}</span>`;
      el.dataset.type = def.type; el.dataset.name = def.name.toLowerCase(); el.dataset.cat = c.toLowerCase();
      el.draggable = true;
      el.ondragstart = (e)=> e.dataTransfer.setData('type', def.type);
      el.ondblclick = ()=> {
        const rect = DOM.viewport.getBoundingClientRect();
        const vx = (rect.width/2 - STATE.transform.x)/STATE.transform.k;
        const vy = (rect.height/2 - STATE.transform.y)/STATE.transform.k;
        addNode(def.type, vx, vy);
        updateConnections();
        saveToStorageDebounced();
      };
      DOM.palette.appendChild(el);
    });
  });
}

// filter palette search
function filterPalette(q){
  if(!DOM.palette) return;
  const query = (q||'').trim().toLowerCase();
  const blocks = DOM.palette.querySelectorAll('.palette-block');
  const headers = DOM.palette.querySelectorAll('.category-header');
  if(!query){ blocks.forEach(b=> b.style.display = ''); headers.forEach(h=> h.style.display = ''); return; }
  blocks.forEach(b=>{
    const name = b.dataset.name || '';
    const type = b.dataset.type || '';
    const cat = b.dataset.cat || '';
    const match = name.includes(query) || type.includes(query) || cat.includes(query);
    b.style.display = match ? '' : 'none';
  });
  headers.forEach(h=>{
    const cat = h.dataset.category || '';
    let any = false;
    DOM.palette.querySelectorAll(`.palette-block[data-cat="${cat}"]`).forEach(pb => { if(pb.style.display !== 'none') any = true; });
    h.style.display = any ? '' : 'none';
  });
}
if(DOM.paletteSearch){
  DOM.paletteSearch.addEventListener('input', (e)=> filterPalette(e.target.value));
  DOM.paletteSearch.addEventListener('keydown', (e)=> { if(e.key === 'Escape'){ DOM.paletteSearch.value=''; filterPalette(''); } });
}

// --- NODE CREATION & UI ---
function addNode(type, x, y, id = null, initialData = {}){
  const def = REGISTRY[type]; if(!def) return;
  const nId = id || uid();
  const nodeData = { id: nId, type, x, y, inputs: {}, outputs: {}, _meta: def, _listeners: [], _customScript: null, _customColor: null };
  def.inputs.forEach(inp => nodeData.inputs[inp.id] = initialData[inp.id] !== undefined ? initialData[inp.id] : (inp.val !== undefined ? inp.val : ''));
  STATE.nodes[nId] = nodeData;

  // create element
  const el = document.createElement('div');
  el.className = 'node' + (type === 'comment' ? ' comment' : '');
  el.id = nId;
  el.dataset.cat = def.cat;
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  el.style.left = '0px'; el.style.top = '0px';

  // header
  const head = document.createElement('div'); head.className = 'node-header';
  head.innerHTML = `<span>${def.name}</span><span class="small">${def.type}</span>`;
  if(type === 'comment'){ // comments show title differently
    head.innerHTML = `<div class="comment-title">${nodeData.inputs.title || def.name}</div>`;
    head.style.cursor = 'move';
  }
  if(nodeData._customColor) head.style.background = nodeData._customColor;
  el.appendChild(head);

  // body area for normal nodes: sockets + inputs
  if(type !== 'comment'){
    const body = document.createElement('div'); body.className = 'node-body';
    const leftCol = document.createElement('div'); leftCol.className = 'col';
    def.inputs.forEach(inp => {
      const row = document.createElement('div'); row.className = 'socket in';
      row.innerHTML = `<div class="port in type-${inp.type} ${inp.type==='exec'?'exec':''}" data-port="${inp.id}" data-type="${inp.type}" title="${inp.type}"></div>`;
      if(inp.type !== 'exec'){
        const inputField = document.createElement('input'); inputField.className='node-input';
        inputField.value = nodeData.inputs[inp.id];
        inputField.dataset.node = nId; inputField.dataset.inp = inp.id; inputField.onchange = (e)=> { STATE.nodes[e.target.dataset.node].inputs[e.target.dataset.inp] = e.target.value; showProperties(nId); saveToStorageDebounced(); };
        inputField.onmousedown = e => e.stopPropagation();
        inputField.setAttribute('data-inp', inp.id);
        row.appendChild(inputField);
        const lbl = document.createElement('span'); lbl.textContent = inp.id; lbl.style.marginLeft = '6px'; row.appendChild(lbl);
      } else {
        const lbl = document.createElement('span'); lbl.textContent = inp.label || inp.id; row.appendChild(lbl);
      }
      leftCol.appendChild(row);
    });

    const rightCol = document.createElement('div'); rightCol.className='col';
    def.outputs.forEach(out => {
      const row = document.createElement('div'); row.className = 'socket out';
      const lbl = document.createElement('span'); lbl.textContent = out.label || out.id; row.appendChild(lbl);
      row.innerHTML += `<div class="port out type-${out.type} ${out.type==='exec'?'exec':''}" data-port="${out.id}" data-type="${out.type}" title="${out.type}"></div>`;
      rightCol.appendChild(row);
    });

    body.append(leftCol, rightCol); el.appendChild(body);
  } else {
    // comment-specific content: allow resizing handle
    const body = document.createElement('div'); body.style.padding = '8px';
    const t = document.createElement('div'); t.style.color = 'var(--text)'; t.textContent = '— group —'; body.appendChild(t);
    const resize = document.createElement('div'); resize.className = 'comment-resize';
    el.appendChild(body); el.appendChild(resize);
    // attach resize behavior
    setupCommentResize(el, resize, nId);
    // show title input in props when selected
  }

  // events
  el.onmousedown = (e)=> {
    // if clicking ports or inputs, don't start node drag
    if(e.target.classList.contains('port') || e.target.tagName === 'INPUT') return;
    // If multi selected and clicked a selected node -> start multi drag
    startDragNode(e, nId);
  };
  el.onclick = (e)=> { if(STATE.dragging) return; selectNode(nId, e.shiftKey); e.stopPropagation(); };
  el.oncontextmenu = (e)=> { e.preventDefault(); showNodeContextMenu(e.clientX, e.clientY, nId); };

  DOM.canvas.appendChild(el);

  // If var.set: ensure variable appears in Variables panel as default
  if(type === 'var.set'){
    const name = nodeData.inputs.name;
    if(name && STATE.variables[name] === undefined){
      try {
        // attempt JSON parse for default val strings
        const v = nodeData.inputs.val; try { STATE.variables[name] = JSON.parse(String(v)); } catch(_) { STATE.variables[name] = v; }
      } catch(e){}
      updateVarPanel();
      saveToStorageDebounced();
    }
  }

  saveToStorageDebounced();
  return nId;
}

// comment resize helper
function setupCommentResize(el, handle, nodeId){
  let dragging = false, sx=0, sy=0, startW=0, startH=0;
  handle.onmousedown = (ev)=> {
    ev.stopPropagation(); dragging=true; sx = ev.clientX; sy = ev.clientY; const r = el.getBoundingClientRect(); startW = r.width; startH = r.height; document.body.style.userSelect='none';
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };
  function onMove(ev){
    if(!dragging) return;
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    const w = Math.max(80, startW + dx), h = Math.max(50, startH + dy);
    el.style.width = w + 'px'; el.style.height = h + 'px';
    const n = STATE.nodes[nodeId]; if(n){ n._size = { w, h }; saveToStorageDebounced(); }
  }
  function onUp(){ dragging=false; document.body.style.userSelect='auto'; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
}

// selection
function selectNode(id, multi = false){
  if(!multi) { document.querySelectorAll('.node.selected').forEach(n=>n.classList.remove('selected')); STATE.selection = []; }
  const el = document.getElementById(id);
  if(el) {
    el.classList.add('selected');
    if(!STATE.selection.includes(id)) STATE.selection.push(id);
    showProperties(id);
    updateCanvasInfo();
  }
}

// --- CONNECTION DRAWING ---
function updateConnections(){
  if(!DOM.svg) return;
  DOM.svg.innerHTML = '';
  STATE.connections.forEach((conn) => {
    const fromEl = document.getElementById(conn.from), toEl = document.getElementById(conn.to);
    if(!fromEl || !toEl) return;
    const p1 = getPortPos(conn.from, conn.fromPort, 'out');
    const p2 = getPortPos(conn.to, conn.toPort, 'in');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    const dx = Math.abs(p1.x - p2.x);
    const c1x = p1.x + dx*0.5, c2x = p2.x - dx*0.5;
    const d = `M ${p1.x} ${p1.y} C ${c1x} ${p1.y} ${c2x} ${p2.y} ${p2.x} ${p2.y}`;
    path.setAttribute('d', d);
    const fromPortEl = fromEl.querySelector(`.port[data-port="${conn.fromPort}"]`);
    const type = fromPortEl ? (fromPortEl.dataset.type || 'any') : 'any';
    const stroke = colorByType(type);
    path.setAttribute('stroke', stroke);
    path.setAttribute('data-orig-stroke', stroke);
    path.setAttribute('stroke-width','3');
    path.setAttribute('fill','none');
    path.classList.add('conn-line');
    path.addEventListener('mouseenter', ()=> { path.setAttribute('stroke','#ff4d4d'); path.setAttribute('stroke-width','4'); });
    path.addEventListener('mouseleave', ()=> { path.setAttribute('stroke', path.getAttribute('data-orig-stroke')||'#fff'); path.setAttribute('stroke-width','3'); });
    path.addEventListener('click', ()=> { STATE.connections = STATE.connections.filter(c => c !== conn); updateConnections(); saveToStorageDebounced(); });
    DOM.svg.appendChild(path);
  });
}

function getPortPos(nodeId, portId, dir) {
  const nodeEl = document.getElementById(nodeId);
  if(!nodeEl) return {x:0,y:0};
  const portEl = nodeEl.querySelector(`.port.${dir}[data-port="${portId}"]`) || nodeEl.querySelector(`.port[data-port="${portId}"]`);
  if(!portEl) {
    // fallback: use node center
    const rect = nodeEl.getBoundingClientRect(); const canRect = DOM.canvas.getBoundingClientRect(); const scale = STATE.transform.k;
    return { x: (rect.left - canRect.left + rect.width/2) / scale, y: (rect.top - canRect.top + rect.height/2) / scale };
  }
  const rect = portEl.getBoundingClientRect();
  const canRect = DOM.canvas.getBoundingClientRect();
  const scale = STATE.transform.k;
  return { x: (rect.left - canRect.left + rect.width/2) / scale, y: (rect.top - canRect.top + rect.height/2) / scale };
}
function colorByType(type) {
  switch(type){
    case 'string': return '#d500f9';
    case 'number': return '#00e676';
    case 'boolean': return '#ff3d00';
    case 'object': case 'array': return '#00b0ff';
    case 'exec': return '#ffffff';
    default: return '#b0bec5';
  }
}

// --- INTERACTION: pan/zoom/wire + marquee + multi-drag ---
if(DOM.viewport){
  DOM.viewport.addEventListener('mousedown', (e) => {
    if(e.shiftKey && (e.target === DOM.viewport || e.target === DOM.canvas)) { startMarquee(e); return; }
    if(e.target === DOM.viewport || e.target === DOM.svg) { STATE.dragging = { type: 'pan', lx: e.clientX, ly: e.clientY }; }
  });
  DOM.viewport.addEventListener('wheel', (e)=> { e.preventDefault(); const oldK = STATE.transform.k; const delta = -Math.sign(e.deltaY) * 0.1; STATE.transform.k = clamp(oldK + delta, 0.2, 5); updateTransform(); });
  DOM.viewport.addEventListener('dragover', e => e.preventDefault());
  DOM.viewport.addEventListener('drop', e => {
    e.preventDefault();
    const type = e.dataTransfer.getData('type'); if(!type) return;
    const rect = DOM.viewport.getBoundingClientRect();
    const x = (e.clientX - rect.left - STATE.transform.x) / STATE.transform.k;
    const y = (e.clientY - rect.top - STATE.transform.y) / STATE.transform.k;
    addNode(type, x, y);
    updateConnections();
    saveToStorageDebounced();
  });
}

document.addEventListener('mousedown', (e) => {
  if(e.target.classList && e.target.classList.contains('port') && e.target.classList.contains('out')) {
    e.stopPropagation();
    const nodeId = e.target.closest('.node').id;
    const portId = e.target.dataset.port;
    STATE.dragging = { type: 'wire', from: nodeId, port: portId };
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('stroke','#fff'); path.setAttribute('stroke-width','2'); path.setAttribute('fill','none'); path.setAttribute('stroke-dasharray','5,5'); path.id = 'temp-wire';
    DOM.svg.appendChild(path);
  }
});

document.addEventListener('mousemove', (e) => {
  if(!STATE.dragging) return;
  if(STATE.dragging.type === 'pan') {
    const dx = e.clientX - STATE.dragging.lx, dy = e.clientY - STATE.dragging.ly;
    STATE.transform.x += dx; STATE.transform.y += dy; STATE.dragging.lx = e.clientX; STATE.dragging.ly = e.clientY; updateTransform();
  } else if(STATE.dragging.type === 'node') {
    // moving a SINGLE node OR multiple selection
    if(STATE.dragging.multi && STATE.selection.length > 1){
      const scale = STATE.transform.k;
      const dx = (e.clientX - STATE.dragging.lx)/scale, dy = (e.clientY - STATE.dragging.ly)/scale;
      STATE.selection.forEach(id => {
        const node = STATE.nodes[id]; if(!node) return;
        node.x += dx; node.y += dy;
        const el = document.getElementById(id);
        const sx = Math.round(node.x / CONFIG.gridSize) * CONFIG.gridSize; const sy = Math.round(node.y / CONFIG.gridSize) * CONFIG.gridSize;
        if(el) el.style.transform = `translate(${sx}px, ${sy}px)`;
      });
      STATE.dragging.lx = e.clientX; STATE.dragging.ly = e.clientY; updateConnections(); updateCanvasInfo();
    } else {
      const node = STATE.nodes[STATE.dragging.id]; if(!node) return;
      const scale = STATE.transform.k; const dx = (e.clientX - STATE.dragging.lx)/scale, dy = (e.clientY - STATE.dragging.ly)/scale;
      node.x += dx; node.y += dy;
      const sx = Math.round(node.x / CONFIG.gridSize) * CONFIG.gridSize; const sy = Math.round(node.y / CONFIG.gridSize) * CONFIG.gridSize;
      const el = document.getElementById(STATE.dragging.id); if(el) el.style.transform = `translate(${sx}px, ${sy}px)`;
      STATE.dragging.lx = e.clientX; STATE.dragging.ly = e.clientY; updateConnections(); updateCanvasInfo();
    }
  } else if(STATE.dragging.type === 'wire') {
    const p1 = getPortPos(STATE.dragging.from, STATE.dragging.port, 'out');
    const rect = DOM.canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / STATE.transform.k, my = (e.clientY - rect.top) / STATE.transform.k;
    const dx = Math.abs(p1.x - mx), c1x = p1.x + dx*0.5, c2x = mx - dx*0.5;
    const d = `M ${p1.x} ${p1.y} C ${c1x} ${p1.y} ${c2x} ${my} ${mx} ${my}`;
    const temp = document.getElementById('temp-wire'); if(temp) temp.setAttribute('d', d);
  } else if(STATE.dragging.type === 'marquee') {
    updateMarquee(e);
  }
});

document.addEventListener('mouseup', (e) => {
  if(STATE.dragging?.type === 'wire') {
    const target = e.target;
    if(target.classList && target.classList.contains('port') && target.classList.contains('in')) {
      const toNode = target.closest('.node').id; const toPort = target.dataset.port;
      if(toNode !== STATE.dragging.from) {
        STATE.connections = STATE.connections.filter(c => !(c.to === toNode && c.toPort === toPort));
        STATE.connections.push({ from: STATE.dragging.from, fromPort: STATE.dragging.port, to: toNode, toPort: toPort });
        updateConnections(); saveToStorageDebounced();
      }
    }
    document.getElementById('temp-wire')?.remove();
  } else if(STATE.dragging?.type === 'marquee') {
    finishMarquee();
  } else if(STATE.dragging?.type === 'node'){
    // finish node drag -> save
    saveToStorageDebounced();
  }
  STATE.dragging = null;
});

// start dragging node (supports multi-select move)
function startDragNode(e, id) {
  // if the clicked node is selected and multiple selected -> multi move
  const multi = STATE.selection.includes(id) && STATE.selection.length > 1;
  if(multi) STATE.dragging = { type: 'node', multi: true, lx: e.clientX, ly: e.clientY };
  else STATE.dragging = { type: 'node', id, lx: e.clientX, ly: e.clientY };
  // ensure selection is updated
  if(!STATE.selection.includes(id)) selectNode(id, false);
}

// update canvas transform
function updateTransform() {
  if(!DOM.canvas) return;
  DOM.canvas.style.transform = `translate(${STATE.transform.x}px, ${STATE.transform.y}px) scale(${STATE.transform.k})`;
  if(DOM.zoomInd) DOM.zoomInd.textContent = Math.round(STATE.transform.k * 100) + '%';
  if(DOM.viewport){
    DOM.viewport.style.backgroundPosition = `${STATE.transform.x}px ${STATE.transform.y}px`;
    DOM.viewport.style.backgroundSize = `${CONFIG.gridSize * STATE.transform.k}px ${CONFIG.gridSize * STATE.transform.k}px`;
  }
}

// --- Marquee multi-select ---
let marqueeEl = null;
function startMarquee(e){
  marqueeEl = document.createElement('div');
  marqueeEl.style.position = 'absolute';
  marqueeEl.style.left = e.clientX + 'px';
  marqueeEl.style.top = e.clientY + 'px';
  marqueeEl.style.width = '0px';
  marqueeEl.style.height = '0px';
  marqueeEl.style.border = '1px dashed var(--accent)';
  marqueeEl.style.background = 'rgba(0,230,118,0.06)';
  marqueeEl.style.zIndex = 9999;
  document.body.appendChild(marqueeEl);
  STATE.dragging = { type: 'marquee', sx: e.clientX, sy: e.clientY };
}
function updateMarquee(e){
  if(!marqueeEl || !STATE.dragging) return;
  const sx = STATE.dragging.sx, sy = STATE.dragging.sy;
  const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
  const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
  marqueeEl.style.left = x + 'px'; marqueeEl.style.top = y + 'px'; marqueeEl.style.width = w + 'px'; marqueeEl.style.height = h + 'px';
}
function finishMarquee(){
  if(!marqueeEl) return;
  const rect = marqueeEl.getBoundingClientRect();
  document.body.removeChild(marqueeEl); marqueeEl = null;
  const selected = [];
  Object.values(STATE.nodes).forEach(n => {
    const el = document.getElementById(n.id);
    if(!el) return;
    const r = el.getBoundingClientRect();
    const overlap = !(r.right < rect.left || r.left > rect.right || r.bottom < rect.top || r.top > rect.bottom);
    if(overlap) selected.push(n.id);
  });
  document.querySelectorAll('.node.selected').forEach(n=>n.classList.remove('selected'));
  STATE.selection = [];
  selected.forEach(id => { const el = document.getElementById(id); if(el) el.classList.add('selected'); STATE.selection.push(id); });
  if(STATE.selection.length) showProperties(STATE.selection[0]);
  updateCanvasInfo();
}

// --- EXECUTION ENGINE ---
// added option to run inside editor (no external window)
let RUN_IN_EDITOR_ACTIVE = false;
function proxyConsoleToRuntime(inEditor=false) {
  if(STATE._origConsole) return;
  STATE._origConsole = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
  console.log = function(...args){ try{ STATE._origConsole.log(...args); }catch(e){} const msg = args.map(x=> formatForLog(x)).join(' '); log(msg,'info'); if(inEditor){} else forwardToRunWindow('info', msg); };
  console.warn = function(...args){ try{ STATE._origConsole.warn(...args);}catch(e){} const msg = args.map(x=> formatForLog(x)).join(' '); log(msg,'warn'); if(inEditor){} else forwardToRunWindow('warn', msg); };
  console.error = function(...args){ try{ STATE._origConsole.error(...args);}catch(e){} const msg = args.map(x=> formatForLog(x)).join(' '); log(msg,'error'); if(inEditor){} else forwardToRunWindow('error', msg); };
}
function restoreConsole() {
  if(!STATE._origConsole) return;
  console.log = STATE._origConsole.log; console.warn = STATE._origConsole.warn; console.error = STATE._origConsole.error;
  STATE._origConsole = null;
}

function disableRunUI(disable){
  try { if(DOM.runBtn) DOM.runBtn.disabled = disable; if(DOM.stepBtn) DOM.stepBtn.disabled = disable; if(DOM.stopBtn) DOM.stopBtn.disabled = !disable; if(DOM.runEditorBtn) DOM.runEditorBtn.disabled = disable; } catch(e){}
}

// open run window (same as before)
function openRunWindow(){
  try {
    if(STATE.runWindow && !STATE.runWindow.closed){ STATE.runWindow.focus(); return; }
    const w = window.open('', 'titan-run', 'width=700,height=600');
    const doc = w.document;
    doc.open();
    doc.write(`<!doctype html><html><head><title>Titan Runtime</title><style>
      body{background:#0b0b0d;color:#f0f0f0;font-family:Consolas,monospace;padding:8px}
      #run-console{height:88vh;overflow:auto;border:1px solid #222;padding:8px;background:#050506}
      .log-line{margin-bottom:6px}
      .log-line.warn{color:#ffb74d}
      .log-line.error{color:#ff6b6b}
      .log-line.info{color:#81d4fa}
      </style></head><body>
      <h3>Titan Run Console</h3><div id="run-console"></div>
      </body></html>`);
    doc.close(); STATE.runWindow = w;
  } catch(e){ log('Could not open run window: '+(e?.message||e),'error'); }
}

// runEngine accepts flag whether to open run window (default true)
async function runEngine(openWindow = true, inEditor = false){
  if(STATE.isRunning) return;
  disableRunUI(true);
  if(openWindow) openRunWindow();
  proxyConsoleToRuntime(inEditor);
  STATE.isRunning = true;
  RUN_IN_EDITOR_ACTIVE = inEditor;
  log('--- Execution Started ---','info');
  document.querySelectorAll('.node').forEach(n=>n.classList.remove('error','running'));

  const starts = Object.values(STATE.nodes).filter(n => n.type === 'evt.start');
  try {
    for(const s of starts){
      const outs = STATE.connections.filter(c => c.from === s.id && c.fromPort === 'exec');
      if(outs.length === 0){ await executeNode(s.id); }
      else { for(const o of outs){ await executeNode(o.to); } }
    }
  } catch(err) {
    log('Runtime Error: ' + (err?.message || String(err)),'error');
    if(!inEditor) forwardToRunWindow('error', 'Runtime Error: ' + (err?.message || String(err)));
  }

  STATE.isRunning = false;
  log('--- Execution Finished ---','info');
  restoreConsole();
  disableRunUI(false);
  RUN_IN_EDITOR_ACTIVE = false;
}

async function stepOnce(){
  if(STATE.isRunning) { log('Already running','warn'); return; }
  disableRunUI(true);
  openRunWindow();
  proxyConsoleToRuntime(false);
  STATE.isRunning = true;
  log('--- Step Execution ---','info');
  const starts = Object.values(STATE.nodes).filter(n => n.type === 'evt.start');
  try {
    if(starts.length === 0) { log('No start nodes','warn'); }
    else {
      const s = starts[0];
      const outs = STATE.connections.filter(c => c.from === s.id && c.fromPort === 'exec');
      if(outs.length === 0) await executeNode(s.id);
      else for(const o of outs) await executeNode(o.to);
    }
  } catch(e){ log('Step Error: '+(e?.message||e),'error'); forwardToRunWindow('error','Step Error: '+(e?.message||e)); }
  STATE.isRunning = false;
  restoreConsole();
  disableRunUI(false);
}

// stop engine
function stopEngine(){
  Object.keys(STATE.timers).forEach(k=>{ try{ clearInterval(STATE.timers[k]); }catch(e){} delete STATE.timers[k]; });
  STATE.isRunning = false;
  restoreConsole();
  log('--- Execution Stopped ---','info');
  disableRunUI(false);
}

// executeNode & evaluateDataNode
async function executeNode(nodeId) {
  if(!STATE.isRunning) return;
  const node = STATE.nodes[nodeId]; if(!node) return;
  const def = REGISTRY[node.type]; if(!def) return;
  const el = document.getElementById(nodeId); if(el) el.classList.add('running');
  await new Promise(r=>setTimeout(r, 30));
  if(el) el.classList.remove('running');

  const ctx = {
    node,
    input: (name) => node.inputs[name],
    eval: async (portName) => {
      const conn = STATE.connections.find(c => c.to === nodeId && c.toPort === portName);
      if(conn) return await evaluateDataNode(conn.from, conn.fromPort);
      return node.inputs[portName];
    },
    trigger: async (outPort) => {
      const conns = STATE.connections.filter(c => c.from === nodeId && c.fromPort === outPort);
      for(const c of conns) await executeNode(c.to);
    },
    setTempOutput: (port, val) => { node.outputs = node.outputs || {}; node.outputs[port] = val; }
  };

  try {
    if(def.execFunc){
      const r = await def.execFunc(ctx);
      if(typeof r === 'string') await ctx.trigger(r);
    } else {
      const outConns = STATE.connections.filter(c => c.from === nodeId && c.fromPort === 'exec');
      for(const c of outConns) await executeNode(c.to);
    }
    if(node._customScript){
      try {
        const fn = new Function('ctx','state','log','return ('+node._customScript+')(ctx,state,log);');
        await fn(ctx, STATE, (m)=>{ log('[node-script] '+m,'info'); if(!RUN_IN_EDITOR_ACTIVE) forwardToRunWindow('info','[node-script] '+m); });
      } catch(e){ el && el.classList.add('error'); throw e; }
    }
  } catch(e) {
    el && el.classList.add('error');
    log('Node Error (' + (def.name || node.type) + '): ' + (e?.message || String(e)), 'error');
    if(!RUN_IN_EDITOR_ACTIVE) forwardToRunWindow('error', 'Node Error (' + (def.name || node.type) + '): ' + (e?.message || String(e)));
    throw e;
  }
}

async function evaluateDataNode(nodeId, outPort) {
  const node = STATE.nodes[nodeId]; const def = REGISTRY[node.type];
  if(!node || !def) return null;
  if(node.outputs && node.outputs[outPort] !== undefined) return node.outputs[outPort];
  const ctx = {
    eval: async (p) => { const c = STATE.connections.find(x => x.to === nodeId && x.toPort === p); if(c) return await evaluateDataNode(c.from, c.fromPort); return node.inputs[p]; },
    input: (p) => node.inputs[p]
  };
  if(def.execFunc){
    const res = await def.execFunc({...ctx, node});
    if(res && typeof res === 'object' && res[outPort] !== undefined) return res[outPort];
    return res;
  }
  return null;
}

// --- UI Helpers & serialization + localStorage ---

// Save / load to localStorage
function saveToStorage(){
  try {
    const copyNodes = JSON.parse(JSON.stringify(STATE.nodes));
    // strip DOM references and event handlers
    Object.values(copyNodes).forEach(n => { delete n._listeners; delete n._handler; delete n._handlerEl; });
    const project = { nodes: copyNodes, connections: STATE.connections, variables: STATE.variables, plugins: STATE.plugins, functions: STATE.functions };
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(project));
    log('Saved to localStorage','info');
  } catch(e){ log('Save error: '+(e?.message||e),'error'); }
}
let saveDebounceTimer = null;
function saveToStorageDebounced(){
  if(saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(()=>{ saveToStorage(); saveDebounceTimer = null; }, 400);
}

function loadFromStorage(){
  try {
    const data = localStorage.getItem(CONFIG.storageKey);
    if(!data) return false;
    const project = JSON.parse(data);
    // cleanup existing
    Object.values(STATE.nodes).forEach(n => { if(n._listeners) n._listeners.forEach(l=>{ try{ l.el.removeEventListener(l.ev, l.handler); }catch(e){} }); if(n._handler && n._handlerEl) try{ n._handlerEl.removeEventListener('click', n._handler); }catch(e){} });
    Object.keys(STATE.timers).forEach(k=>{ try{ clearInterval(STATE.timers[k]); }catch(e){} delete STATE.timers[k]; });
    STATE.nodes = {}; STATE.connections = [];
    DOM.canvas.innerHTML = '<svg id="connections"></svg>';
    DOM.svg = document.getElementById('connections');
    Object.values(project.nodes || {}).forEach(n => {
      addNode(n.type, n.x||80, n.y||60, n.id, n.inputs);
      if(n._customScript) STATE.nodes[n.id]._customScript = n._customScript;
      if(n._customColor) { STATE.nodes[n.id]._customColor = n._customColor; const head = document.querySelector(`#${n.id} .node-header`); if(head) head.style.background = n._customColor; }
      if(n._size) { const el = document.getElementById(n.id); if(el){ el.style.width = (n._size.w||el.offsetWidth)+'px'; el.style.height = (n._size.h||el.offsetHeight)+'px'; } }
    });
    STATE.connections = project.connections || [];
    STATE.variables = project.variables || {};
    STATE.plugins = project.plugins || {};
    STATE.functions = project.functions || {};
    initPalette(); updateConnections(); updateVarPanel(); updateCanvasInfo(); renderPlugins();
    log('Loaded from localStorage','info');
    return true;
  } catch(e){ log('Load error: '+(e?.message||e),'error'); return false; }
}

// show properties
function showProperties(id){
  const node = STATE.nodes[id];
  if(!DOM.props) return;
  DOM.props.innerHTML = '';
  if(!node){ DOM.props.innerHTML = '<p class="empty-msg">Select a node to edit properties.</p>'; return; }
  const def = REGISTRY[node.type];
  DOM.modalTitle && (DOM.modalTitle.textContent = def.name + ' — Properties');
  // If multi-selected, show nothing except basic info
  if(STATE.selection.length > 1){
    DOM.props.innerHTML = `<p>${STATE.selection.length} nodes selected</p>`;
    return;
  }
  def.inputs.forEach(inp => {
    const row = document.createElement('div'); row.className = 'prop-row';
    const label = document.createElement('label'); label.textContent = `${inp.id} (${inp.type})`; row.appendChild(label);
    if(inp.type === 'boolean'){
      const sel = document.createElement('select'); sel.innerHTML = `<option value="true">true</option><option value="false">false</option>`;
      sel.value = String(node.inputs[inp.id]);
      sel.onchange = (e) => { node.inputs[inp.id] = e.target.value === 'true'; updateNodeInputUI(id, inp.id, e.target.value); saveToStorageDebounced(); };
      row.appendChild(sel);
    } else {
      const input = document.createElement('input'); input.value = node.inputs[inp.id];
      input.onchange = (e)=> { node.inputs[inp.id] = e.target.value; updateNodeInputUI(id, inp.id, e.target.value); saveToStorageDebounced(); };
      row.appendChild(input);
    }
    DOM.props.appendChild(row);
  });

  // comment title special case
  if(node.type === 'comment'){
    const hr = document.createElement('hr'); hr.style.border = '0'; hr.style.borderTop = '1px solid #222'; DOM.props.appendChild(hr);
    const csLabel = document.createElement('div'); csLabel.style.color = 'var(--text-dim)'; csLabel.textContent = 'Title'; DOM.props.appendChild(csLabel);
    const titleInput = document.createElement('input'); titleInput.value = node.inputs.title || ''; titleInput.onchange = (e)=> { node.inputs.title = e.target.value; const head = document.querySelector(`#${id} .comment-title`); if(head) head.textContent = e.target.value; saveToStorageDebounced(); };
    DOM.props.appendChild(titleInput);
  }

  // custom script controls
  const hr = document.createElement('hr'); hr.style.border = '0'; hr.style.borderTop = '1px solid #222'; DOM.props.appendChild(hr);
  const csLabel = document.createElement('div'); csLabel.style.color = 'var(--text-dim)'; csLabel.textContent = 'Custom Script (runs after node exec)'; DOM.props.appendChild(csLabel);
  const csBtn = document.createElement('button'); csBtn.textContent = node._customScript ? 'Edit Script' : 'Add Script'; csBtn.onclick = ()=> addCustomScriptToNode(id);
  DOM.props.appendChild(csBtn);
  const colorBtn = document.createElement('button'); colorBtn.textContent = 'Header Color'; colorBtn.style.marginLeft = '8px';
  colorBtn.onclick = ()=> { const c = prompt('Header CSS (empty to reset):', node._customColor || '') || ''; node._customColor = c || null; const h = document.querySelector(`#${id} .node-header`); if(h) h.style.background = c || ''; saveToStorageDebounced(); };
  DOM.props.appendChild(colorBtn);
}

// update node input UI (for inline inputs)
function updateNodeInputUI(nodeId, inputId, val){
  const inputEl = document.querySelector(`#${nodeId} .node-input[data-inp="${inputId}"]`);
  if(inputEl) inputEl.value = val;
}

// Variables panel: now shows both state variables and var.set nodes defaults
function updateVarPanel(){
  if(!DOM.vars) return;
  DOM.vars.innerHTML = '';
  // gather variable defaults from var.set nodes
  const nodeVarDefaults = {};
  Object.values(STATE.nodes).forEach(n => {
    if(n.type === 'var.set' && n.inputs && n.inputs.name){
      nodeVarDefaults[n.inputs.name] = n.inputs.val;
    }
  });
  // merge keys
  const allKeys = new Set([...Object.keys(STATE.variables||{}), ...Object.keys(nodeVarDefaults)]);
  allKeys.forEach(k => {
    const wrapper = document.createElement('div'); wrapper.className='var-item';
    const nameSpan = document.createElement('span'); nameSpan.textContent = k;
    const current = STATE.variables[k] !== undefined ? STATE.variables[k] : nodeVarDefaults[k];
    const valInput = document.createElement('input'); valInput.value = JSON.stringify(current); valInput.style.background='transparent'; valInput.style.border='none'; valInput.style.color='var(--accent)'; valInput.style.width='60%';
    valInput.onchange = (e)=> {
      try { const parsed = JSON.parse(e.target.value); STATE.variables[k] = parsed; } catch(_){ STATE.variables[k] = e.target.value; }
      updateVarPanel(); saveToStorageDebounced();
    };
    const removeBtn = document.createElement('button'); removeBtn.className='icon-btn'; removeBtn.innerHTML = '<i class="material-icons">delete</i>';
    removeBtn.onclick = ()=> { delete STATE.variables[k]; updateVarPanel(); saveToStorageDebounced(); };
    wrapper.appendChild(nameSpan); wrapper.appendChild(valInput); wrapper.appendChild(removeBtn);
    DOM.vars.appendChild(wrapper);
  });
}

// Save & Load buttons
if(DOM.saveBtn) DOM.saveBtn.onclick = ()=> {
  const json = JSON.stringify({ nodes: STATE.nodes, connections: STATE.connections, variables: STATE.variables, plugins: STATE.plugins, functions: STATE.functions }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'project.json'; a.click();
};
if(DOM.loadBtn && DOM.fileInput) DOM.loadBtn.onclick = ()=> DOM.fileInput.click();
if(DOM.fileInput) DOM.fileInput.onchange = (e) => {
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      // overwrite state
      STATE.nodes = {}; STATE.connections = []; DOM.canvas.innerHTML = '<svg id="connections"></svg>'; DOM.svg = document.getElementById('connections');
      Object.values(data.nodes || {}).forEach(n => {
        addNode(n.type, n.x, n.y, n.id, n.inputs);
        if(n._customScript) STATE.nodes[n.id]._customScript = n._customScript;
        if(n._customColor) { STATE.nodes[n.id]._customColor = n._customColor; const head = document.querySelector(`#${n.id} .node-header`); if(head) head.style.background = n._customColor; }
        if(n._size) { const el = document.getElementById(n.id); if(el){ el.style.width = (n._size.w||el.offsetWidth)+'px'; el.style.height = (n._size.h||el.offsetHeight)+'px'; } }
      });
      STATE.connections = data.connections || []; STATE.variables = data.variables || {}; STATE.plugins = data.plugins || {}; STATE.functions = data.functions || {};
      updateConnections(); updateVarPanel(); initPalette(); renderPlugins(); saveToStorageDebounced();
      log('Project loaded from file','info');
    } catch(err) { log('Load Error: '+(err?.message||err),'error'); }
  };
  reader.readAsText(file);
};

// clear
if(DOM.clearBtn) DOM.clearBtn.onclick = ()=> {
  if(confirm('Clear all?')) {
    Object.values(STATE.nodes).forEach(n => { if(n._listeners) n._listeners.forEach(l=>{ try{ l.el.removeEventListener(l.ev, l.handler); }catch(e){} }); if(n._handler && n._handlerEl) try{ n._handlerEl.removeEventListener('click', n._handler); }catch(e){} });
    Object.keys(STATE.timers).forEach(k=>{ try{ clearInterval(STATE.timers[k]); }catch(e){} delete STATE.timers[k]; });
    STATE.nodes = {}; STATE.connections = []; DOM.canvas.innerHTML = '<svg id="connections"></svg>'; DOM.svg = document.getElementById('connections'); DOM.props.innerHTML = '<p class="empty-msg">Select a node to edit properties.</p>';
    updateConnections(); updateVarPanel(); saveToStorageDebounced();
  }
};

// theme toggle
if(DOM.themeBtn) DOM.themeBtn.onclick = ()=> document.body.classList.toggle('dark');

// open runwindow btn behavior
if(DOM.runWindowBtn) DOM.runWindowBtn.onclick = openRunWindow;
if(DOM.runEditorBtn) DOM.runEditorBtn.onclick = ()=> { runEngine(false, true); };

// export / preview
async function nodeToJS(nodeId, visited = new Set()){
  if(visited.has(nodeId)) return '';
  visited.add(nodeId);
  const node = STATE.nodes[nodeId]; if(!node) return '';
  const def = REGISTRY[node.type]; if(!def) return '';
  let js = '';
  // special-case known nodes for clean output
  switch(node.type){
    case 'evt.start': break;
    case 'console.log': js += `console.log(${JSON.stringify(node.inputs.msg || '')});\n`; break;
    case 'console.warn': js += `console.warn(${JSON.stringify(node.inputs.msg || '')});\n`; break;
    case 'var.set': {
      const name = String(node.inputs.name || 'myVar').replace(/[^a-zA-Z0-9_$]/g,'_');
      const val = node.inputs.val;
      try { js += `let ${name} = ${JSON.stringify(JSON.parse(String(val)))};\n`; } catch(_) { js += `let ${name} = ${JSON.stringify(String(val))};\n`; }
      break;
    }
    case 'var.get': js += `/* read variable ${JSON.stringify(node.inputs.name||'')} */\n`; break;
    case 'math.op': js += `/* math */\nlet __tmp = ${JSON.stringify(node.inputs.a)} ${node.inputs.op || '+'} ${JSON.stringify(node.inputs.b)};\n`; break;
    case 'str.join': js += `let __tmp = ${JSON.stringify(node.inputs.a)} + ${JSON.stringify(node.inputs.sep)} + ${JSON.stringify(node.inputs.b)};\n`; break;
    case 'browser.alert': js += `alert(${JSON.stringify(node.inputs.msg || '')});\n`; break;
    case 'browser.open': js += `window.open(${JSON.stringify(node.inputs.url || '')},'_blank');\n`; break;
    case 'dom.get_by_id': js += `const el_${nodeId} = document.getElementById(${JSON.stringify(node.inputs.id||'')});\n`; break;
    case 'dom.set_text': js += `document.querySelector(${JSON.stringify(node.inputs.sel||'')}).innerText = ${JSON.stringify(node.inputs.text||'')};\n`; break;
    case 'dom.set_html': js += `document.querySelector(${JSON.stringify(node.inputs.sel||'')}).innerHTML = ${JSON.stringify(node.inputs.html||'')};\n`; break;
    case 'arr.create': js += `let arr_${nodeId} = [];\n`; break;
    case 'arr.push': js += `/* push (manual) */\n`; break;
    case 'comment': js += `/* ${node.inputs.title || 'comment'} */\n`; break;
    default:
      // generic fallback: emit comment with inputs
      js += `/* ${def.name} (${def.type}) */\n`;
      Object.keys(node.inputs||{}).forEach(k => {
        if(k === 'exec') return;
        const v = node.inputs[k];
        js += `// ${k} = ${JSON.stringify(v)}\n`;
      });
      js += `\n`;
      break;
  }
  // traverse exec outputs
  const outs = STATE.connections.filter(c => c.from === nodeId && c.fromPort === 'exec');
  for(const c of outs) js += await nodeToJS(c.to, visited);
  return js;
}

async function generateJS(){
  let code = '';
  const starts = Object.values(STATE.nodes).filter(n => n.type === 'evt.start');
  if(starts.length === 0) code = '// No start nodes found. Connect nodes to evt.start to export.\n';
  else for(const s of starts) code += await nodeToJS(s.id, new Set());
  if(DOM.exportTextarea) DOM.exportTextarea.value = code;
  try { await navigator.clipboard.writeText(code); log('[Export JS] Copied to clipboard!', 'info'); } catch(e){ log('[Export JS] Failed to copy: '+(e?.message||e),'error'); }
  return code;
}
if(DOM.exportBtn) DOM.exportBtn.onclick = generateJS;
if(DOM.exportPreviewBtn) DOM.exportPreviewBtn.onclick = ()=> { const code = (DOM.exportTextarea && DOM.exportTextarea.value) || ''; openModal('Exported JS Preview', `<pre style="white-space:pre-wrap;background:#0b0b0d;padding:12px;border-radius:6px;color:#9ef">${escapeHtml(code)}</pre>`); };

// --- CONTEXT MENU & PER-NODE actions ---
function showNodeContextMenu(x,y,nodeId){
  const menu = DOM.contextMenu; if(!menu) return;
  menu.innerHTML = '';
  const addItem = (label, cb) => { const d = document.createElement('div'); d.className = 'ctx-item'; d.textContent = label; d.onclick = ()=>{ cb(); menu.classList.add('hidden'); }; menu.appendChild(d); };
  addItem('Delete Node', ()=> deleteNodes([nodeId]));
  addItem('Duplicate Node', ()=> duplicateNode(nodeId));
  addItem('Add/Edit Custom Script', ()=> addCustomScriptToNode(nodeId));
  addItem('Run Custom Script', ()=> runCustomScriptForNode(nodeId));
  addItem('Export Node JSON', ()=> { const n = STATE.nodes[nodeId]; const s = JSON.stringify(n, null, 2); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s],{type:'application/json'})); a.download = `${nodeId}.json`; a.click(); });
  menu.style.left = x + 'px'; menu.style.top = y + 'px'; menu.classList.remove('hidden');
}
document.addEventListener('click', ()=> { if(DOM.contextMenu) DOM.contextMenu.classList.add('hidden'); });

function deleteNodes(ids){ ids.forEach(id=>{ const n = STATE.nodes[id]; if(!n) return; if(n._listeners) n._listeners.forEach(l=>{ try{ l.el.removeEventListener(l.ev,l.handler); }catch(e){} }); if(n._handler && n._handlerEl) try{ n._handlerEl.removeEventListener('click', n._handler); }catch(e){} if(STATE.timers[id]) { clearInterval(STATE.timers[id]); delete STATE.timers[id]; } delete STATE.nodes[id]; document.getElementById(id)?.remove(); }); STATE.connections = STATE.connections.filter(c=> !ids.includes(c.from) && !ids.includes(c.to)); updateConnections(); DOM.props.innerHTML = '<p class="empty-msg">Select a node to edit properties.</p>'; STATE.selection = STATE.selection.filter(s => !ids.includes(s)); updateCanvasInfo(); saveToStorageDebounced(); }
function duplicateNode(id){ const s = STATE.nodes[id]; if(!s) return; const newId = uid(); const copyInputs = JSON.parse(JSON.stringify(s.inputs||{})); addNode(s.type, (s.x||100)+20, (s.y||100)+20, newId, copyInputs); if(s._customScript) STATE.nodes[newId]._customScript = s._customScript; if(s._customColor) { STATE.nodes[newId]._customColor = s._customColor; const head = document.querySelector(`#${newId} .node-header`); if(head) head.style.background = s._customColor; } updateConnections(); saveToStorageDebounced(); log('Duplicated '+id+' -> '+newId,'info'); }

function addCustomScriptToNode(nodeId){
  const node = STATE.nodes[nodeId];
  const existing = node._customScript || '';
  const code = prompt('Enter JS that returns a function (ctx,state,log). Example:\n(ctx,state,log)=>{ log(\"hi\"); }', existing) || '';
  if(code.trim()===''){ node._customScript = null; log('Removed custom script','info'); saveToStorageDebounced(); return; }
  node._customScript = code; log('Custom script saved','info'); saveToStorageDebounced();
}
async function runCustomScriptForNode(nodeId){
  const node = STATE.nodes[nodeId]; if(!node || !node._customScript){ log('No custom script','warn'); return; }
  try { const fn = new Function('ctx','state','log','return ('+node._customScript+')(ctx,state,log);'); await fn({node, input: n=>node.inputs[n], eval: async ()=>null}, STATE, (m)=>{ log('[node-script] '+m,'info'); forwardToRunWindow('info','[node-script] '+m); }); log('Custom script run ok','info'); } catch(e){ log('Custom script error: '+(e?.message||e),'error'); forwardToRunWindow('error','Custom script error: '+(e?.message||e)); }
}

// keyboard shortcuts
document.addEventListener('keydown', (e)=> {
  const ae = document.activeElement; if(ae && (ae.tagName==='INPUT' || ae.tagName==='TEXTAREA' || ae.isContentEditable)) return;
  if(e.key === 'Backspace') { if(STATE.selection.length){ e.preventDefault(); deleteNodes([...STATE.selection]); } }
  if(e.ctrlKey && (e.key === '+' || e.key === '=')){ e.preventDefault(); STATE.transform.k = clamp(STATE.transform.k + 0.1, 0.2, 5); updateTransform(); }
  if(e.ctrlKey && e.key === '-'){ e.preventDefault(); STATE.transform.k = clamp(STATE.transform.k - 0.1, 0.2, 5); updateTransform(); }
  if(e.ctrlKey && (e.key === '0')) { e.preventDefault(); STATE.transform.k = 1; updateTransform(); }
});

// --- RIGHT-SIDE TAB SWITCHING ---
function initRightTabs(){
  const sidebar = document.querySelector('#sidebar-right');
  if(!sidebar) return;
  const tabBar = document.createElement('div'); tabBar.style.display='flex'; tabBar.style.gap='6px'; tabBar.style.padding='6px'; tabBar.style.borderBottom='1px solid var(--border)';
  const tabs = [
    {label:'Properties', sel:'.prop-panel'},
    {label:'Variables', sel:'.var-panel'},
    {label:'Console', sel:'.console-panel'},
    {label:'Plugins', sel:'.plugin-panel'},
    {label:'Export JS', sel:'.export-panel'}
  ];
  tabs.forEach(t => {
    const b = document.createElement('button'); b.className='icon-btn'; b.textContent = t.label;
    b.onclick = ()=> showRightTab(t.sel);
    tabBar.appendChild(b);
  });
  sidebar.insertBefore(tabBar, sidebar.firstChild);
  showRightTab('.prop-panel');
}
function showRightTab(selector){
  const panels = document.querySelectorAll('#sidebar-right .panel');
  panels.forEach(p => p.style.display = p.matches(selector) ? 'flex' : 'none');
}
initRightTabs();

// --- PLUGIN MANAGER & DOCS (modal-based) ---
function renderPlugins(){
  if(!DOM.pluginsList) return;
  DOM.pluginsList.innerHTML = '';
  Object.keys(STATE.plugins).forEach(id => {
    const p = STATE.plugins[id];
    const el = document.createElement('div'); el.style.display='flex'; el.style.justifyContent='space-between'; el.style.alignItems='center'; el.style.marginBottom='6px';
    el.innerHTML = `<div><strong>${p.name||id}</strong><div style="font-size:12px;color:var(--text-dim)">${id}</div></div>`;
    const btns = document.createElement('div');
    const initBtn = document.createElement('button'); initBtn.className='icon-btn'; initBtn.title='Init'; initBtn.innerHTML = '<i class="material-icons">play_arrow</i>';
    initBtn.onclick = ()=> initPlugin(id);
    const removeBtn = document.createElement('button'); removeBtn.className='icon-btn'; removeBtn.title='Remove'; removeBtn.innerHTML = '<i class="material-icons">delete</i>';
    removeBtn.onclick = ()=> { delete STATE.plugins[id]; renderPlugins(); initPalette(); saveToStorageDebounced(); };
    btns.appendChild(initBtn); btns.appendChild(removeBtn); el.appendChild(btns);
    DOM.pluginsList.appendChild(el);
  });
}

function openPluginManager(){
  const html = `
    <p>Installed plugins:</p>
    <div id="plugin-list-inner" style="margin-bottom:10px;"></div>
    <p>Paste plugin JS below and click <strong>Install</strong>. Plugin should call registerNode(...) or return an object with init().</p>
    <textarea id="plugin-code" style="width:100%;height:180px;background:#0f0f12;color:#eee;padding:8px;border-radius:6px;border:1px solid #222;"></textarea>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <input id="plugin-id" placeholder="plugin-id (optional)" style="flex:1;padding:6px" />
      <input id="plugin-name" placeholder="plugin name (optional)" style="flex:1;padding:6px" />
    </div>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button id="install-plugin" class="primary">Install</button>
      <button id="init-all-plugins">Init All</button>
    </div>
  `;
  openModal('Plugin Manager', html);
  renderPlugins();
  document.getElementById('install-plugin').onclick = ()=> {
    const code = document.getElementById('plugin-code').value.trim();
    if(!code){ alert('Paste plugin JS'); return; }
    const id = document.getElementById('plugin-id').value.trim() || 'p_' + Date.now();
    const name = document.getElementById('plugin-name').value.trim() || id;
    STATE.plugins[id] = { id, name, code };
    try {
      const fn = new Function('registerNode','registerPlugin','state','log', code);
      const res = fn(registerNode, registerPlugin, STATE, (m)=>log('[plugin] '+m,'info'));
      if(res && typeof res.init === 'function'){ try{ res.init(registerNode, registerPlugin, STATE, (m)=>log('[plugin:init] '+m,'info')); } catch(e){ log('Plugin init error: '+(e?.message||e),'error'); } }
      renderPlugins(); initPalette(); saveToStorageDebounced(); log('Plugin installed: '+name,'info');
    } catch(e){ log('Plugin error: '+(e?.message||e),'error'); alert('Plugin error: '+(e?.message||e)); }
  };
  document.getElementById('init-all-plugins').onclick = ()=> { Object.keys(STATE.plugins).forEach(k=> initPlugin(k)); };
}
if(DOM.pluginBtn) DOM.pluginBtn.onclick = openPluginManager;

function initPlugin(id){
  const p = STATE.plugins[id];
  if(!p) { log('Plugin not found: '+id,'warn'); return; }
  if(p.code){
    try {
      const fn = new Function('registerNode','registerPlugin','state','log', p.code);
      const res = fn(registerNode, registerPlugin, STATE, (m)=>log('[plugin] '+m,'info'));
      if(res && typeof res.init === 'function') res.init(registerNode, registerPlugin, STATE, (m)=>log('[plugin:init] '+m,'info'));
      initPalette(); renderPlugins(); saveToStorageDebounced(); log('Plugin init executed: '+(p.name||id),'info');
    } catch(e){ log('Plugin init error: '+(e?.message||e),'error'); }
  } else if(typeof p.init === 'function'){ try{ p.init(registerNode, registerPlugin, STATE, (m)=>log('[plugin:init] '+m,'info')); }catch(e){ log('Plugin init error: '+(e?.message||e),'error'); } }
}

function docsHtml(){
  return `<h3>Plugin API & How to make plugins</h3>
    <p>Use <code>registerNode(type, category, name, inputs, outputs, execFunc)</code>. registerNode will automatically add exec input & output to nodes.</p>
    <p>Inputs/outputs example: <code>{id:'value', type:'number', val:0}</code>. Types: exec, number, string, boolean, array, object, any.</p>
    <p>execFunc receives <code>ctx</code> with: <code>node</code>, <code>input(name)</code>, <code>eval(portName)</code>, <code>trigger(outPort)</code>, <code>setTempOutput(port,val)</code>.</p>
    <pre style="background:#111;padding:8px;border-radius:6px;color:#9ef">
(function(registerNode, registerPlugin, state, log){
  registerNode('plugin.say','Plugins','Say Hello', [{id:'exec',type:'exec'},{id:'name',type:'string',val:'You'}], [{id:'exec',type:'exec'}], async (ctx)=>{
    const n = await ctx.eval('name');
    log('Hello '+n);
    return 'exec';
  });
  return { init(){ registerPlugin('hello','Hello Plugin'); } };
});
    </pre>
    <p><strong>Security:</strong> plugins run JS in your page. Only install trusted plugins.</p>`;
}
if(DOM.docsBtn) DOM.docsBtn.onclick = ()=> openModal('Docs', docsHtml());

// modal helpers
if(document.getElementById('modal-close')) document.getElementById('modal-close').onclick = closeModal;
if(document.getElementById('modal-backdrop')) document.getElementById('modal-backdrop').onclick = closeModal;
function openModal(title, html){ if(DOM.modalTitle) DOM.modalTitle.textContent = title; if(DOM.modalBody) DOM.modalBody.innerHTML = html; if(DOM.modal) DOM.modal.classList.remove('hidden'); if(DOM.modalBackdrop) DOM.modalBackdrop.classList.remove('hidden'); }
function closeModal(){ if(DOM.modal) DOM.modal.classList.add('hidden'); if(DOM.modalBackdrop) DOM.modalBackdrop.classList.add('hidden'); }

// helper: run custom script for node - reuse earlier
async function runCustomScriptForNode(nodeId){ const node = STATE.nodes[nodeId]; if(!node || !node._customScript){ log('No custom script','warn'); return; } try { const fn = new Function('ctx','state','log','return ('+node._customScript+')(ctx,state,log);'); await fn({node, input: n=>node.inputs[n], eval: async ()=>null}, STATE, (m)=>{ log('[node-script] '+m,'info'); forwardToRunWindow('info','[node-script] '+m); }); log('Custom script run ok','info'); } catch(e){ log('Custom script error: '+(e?.message||e),'error'); forwardToRunWindow('error','Custom script error: '+(e?.message||e)); } }

// canvas info
function updateCanvasInfo(){
  const coordsEl = DOM.coordsInd;
  if(!coordsEl) return;
  if(STATE.selection.length === 0){ coordsEl.textContent = '0, 0'; return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  STATE.selection.forEach(id => {
    const n = STATE.nodes[id];
    if(!n) return;
    const el = document.getElementById(id);
    if(!el) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    else {
      const style = el.style.transform;
      const m = style.match(/translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
      if(m){ const x = parseFloat(m[1]), y = parseFloat(m[2]); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); } else { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    }
  });
  if(minX === Infinity){ coordsEl.textContent = '0, 0'; return; }
  const cx = Math.round((minX + maxX)/2), cy = Math.round((minY + maxY)/2);
  coordsEl.textContent = `${cx}, ${cy}`;
}

// --- Initialization & autoload/autosave ---
initPalette();
updateTransform();
renderPlugins();
updateVarPanel();
updateConnections();
updateCanvasInfo();

// Load from storage if available, else add starter nodes
const had = loadFromStorage();
if(!had && Object.keys(STATE.nodes).length === 0){
  const s = addNode('evt.start', 80, 60);
  const l = addNode('console.log', 300, 80);
  STATE.nodes[l].inputs['msg'] = 'Hello world';
  STATE.connections.push({ from: s, fromPort: 'exec', to: l, toPort: 'exec' });
  updateConnections();
  saveToStorageDebounced();
}

// autosave on unload
window.addEventListener('beforeunload', ()=> saveToStorage());

// expose helpers
window.STATE = STATE;
window.registerNode = registerNode;
window.registerPlugin = registerPlugin;
window.generateJS = generateJS;
window.nodeToJS = nodeToJS;
window.log = (m,t='info') => log(m,t);

// bind run/stop/step
if(DOM.runBtn) DOM.runBtn.onclick = ()=> runEngine(true, false);
if(DOM.runEditorBtn) DOM.runEditorBtn.onclick = ()=> runEngine(false, true);
if(DOM.stepBtn) DOM.stepBtn.onclick = stepOnce;
if(DOM.stopBtn) DOM.stopBtn.onclick = stopEngine;
