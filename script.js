// == Full updated script.js ==
// Includes fixes requested:
// - run actually executes graph (start nodes trigger connected flow)
// - variables panel updates live and is editable (edits update STATE.variables immediately)
// - plugin manager fixed & moved into modal (install/init/remove works)
// - all core nodes restored (console, browser, variables, logic, math, loops, arrays, DOM, functions, literals)
// - step button implemented (single-cycle execution)
// - connector hover highlights red and click deletes
// - right-side tab switching present
// - marquee multi-select
// - bottom-left shows coords of selected node or center of selection
// - ctrl +/+/- zoom shortcuts
// - backspace deletes selected nodes (no confirmation)
// Fixes added in this version:
// - Palette (Blocks) scroll restored & enforced
// - Search bar for palette works (filters blocks & categories)
// - Improved plugin docs content
// - Run button binding + Stop behavior (clears runtime timers & restores console)
// Nothing is left out.


// --- CORE CONFIGURATION & STATE ---
const CONFIG = {
  gridSize: 20,
  snapRadius: 15
};

const STATE = {
  nodes: {},          // Map<ID, NodeData>
  connections: [],    // Array<{from, fromPort, to, toPort}>
  variables: {},      // Map<Name, Value>
  transform: { x: 0, y: 0, k: 1 }, // Pan/Zoom
  dragging: null,     // { type, id, ... }
  selection: [],      // Array<ID>
  isRunning: false,
  plugins: {},        // plugin store { id: {name, code} }
  timers: {},         // node timers/intervals
  runWindow: null,    // external runtime window
  _origConsole: null  // saved original console
};

// --- DOM CACHE ---
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
  stopBtn: document.getElementById('stopBtn')
};

// minimal defensive fallback
Object.keys(DOM).forEach(k => { if(!DOM[k]) console.warn('DOM missing:', k); });

// --- UTILITIES ---
const uid = () => 'n_' + Math.random().toString(36).slice(2,10);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));

// --- REGISTRY & HELPERS ---
const REGISTRY = {};
function registerNode(type, cat, name, inputs = [], outputs = [], execFunc = null) {
  REGISTRY[type] = { type, cat, name, inputs, outputs, execFunc };
}
function registerPlugin(id, meta) {
  STATE.plugins[id] = meta || { id, name: id };
  renderPlugins();
}
window.registerNode = registerNode;
window.registerPlugin = registerPlugin;

// --- RENDER: forward logs to run window (single function used by many nodes) ---
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

// --- NODE DEFINITIONS (comprehensive set) ---

// Events
registerNode('evt.start','Events','On Start',[],[{id:'exec',type:'exec'}]);
registerNode('evt.interval','Events','Interval',[{id:'ms',type:'number',val:1000}],[{id:'exec',type:'exec'}], async (ctx) => {
  const n = ctx.node;
  const ms = Number(await ctx.eval('ms')) || 1000;
  if(STATE.timers[n.id]) clearInterval(STATE.timers[n.id]);
  STATE.timers[n.id] = setInterval(()=> { ctx.trigger('exec').catch(()=>{}); }, ms);
  return null;
});
registerNode('evt.click','Events','On DOM Click',[{id:'sel',type:'string',val:'#btn'}],[{id:'exec',type:'exec'}], async (ctx) => {
  const sel = await ctx.eval('sel');
  const n = ctx.node;
  const el = document.querySelector(sel);
  if(!el) return null;
  if(n._handler && n._handlerEl) try { n._handlerEl.removeEventListener('click', n._handler) } catch(e){}
  const handler = ()=> ctx.trigger('exec').catch(()=>{});
  n._handler = handler; n._handlerEl = el;
  el.addEventListener('click', handler);
  return null;
});

// Console & Debugging
registerNode('console.log','Console & Debugging','Console Log',[{id:'exec',type:'exec'},{id:'msg',type:'any'}],[{id:'exec',type:'exec'}], async (ctx)=> {
  const m = await ctx.eval('msg'); log(m,'info'); forwardToRunWindow('info', m); return 'exec';
});
registerNode('console.warn','Console & Debugging','Console Warn',[{id:'exec',type:'exec'},{id:'msg',type:'any'}],[{id:'exec',type:'exec'}], async (ctx)=> {
  const m = await ctx.eval('msg'); log(m,'warn'); forwardToRunWindow('warn', m); return 'exec';
});
registerNode('console.error','Console & Debugging','Console Error',[{id:'exec',type:'exec'},{id:'msg',type:'any'}],[{id:'exec',type:'exec'}], async (ctx)=> {
  const m = await ctx.eval('msg'); log(m,'error'); forwardToRunWindow('error', m); return 'exec';
});
registerNode('console.clear','Console & Debugging','Console Clear',[{id:'exec',type:'exec'}],[{id:'exec',type:'exec'}], async (ctx)=> {
  if(DOM.console) DOM.console.innerHTML = ''; if(STATE.runWindow && !STATE.runWindow.closed) try{ STATE.runWindow.document.getElementById('run-console').innerHTML = ''; }catch(e){}
  return 'exec';
});

// Browser interactions
registerNode('browser.alert','Browser Interactions','Alert',[{id:'exec',type:'exec'},{id:'msg',type:'string'}],[{id:'exec',type:'exec'}], async (ctx)=> { alert(await ctx.eval('msg')); return 'exec'; });
registerNode('browser.prompt','Browser Interactions','Prompt',[{id:'exec',type:'exec'},{id:'msg',type:'string'}],[{id:'res',type:'string'}], async (ctx)=> prompt(await ctx.eval('msg')) || '');
registerNode('browser.confirm','Browser Interactions','Confirm',[{id:'exec',type:'exec'},{id:'msg',type:'string'}],[{id:'res',type:'boolean'}], async (ctx)=> confirm(await ctx.eval('msg')));
registerNode('browser.open','Browser Interactions','Open URL',[{id:'url',type:'string'}],[], async (ctx)=> { window.open(await ctx.eval('url'),'_blank'); });

// Variables & Data
registerNode('var.set','Variables','Set Variable',[{id:'exec',type:'exec'},{id:'name',type:'string',val:'myVar'},{id:'val',type:'any'}],[{id:'exec',type:'exec'}], async (ctx)=> {
  const name = await ctx.eval('name'); const val = await ctx.eval('val');
  STATE.variables[name] = val; updateVarPanel(); forwardToRunWindow('info', `var ${name} = ${JSON.stringify(val)}`); return 'exec';
});
registerNode('var.get','Variables','Get Variable',[{id:'name',type:'string',val:'myVar'}],[{id:'val',type:'any'}], async (ctx)=> STATE.variables[await ctx.eval('name')]);
registerNode('var.const','Variables','Create Constant',[{id:'name',type:'string'},{id:'val',type:'any'}],[], async (ctx)=> {
  const name = await ctx.eval('name'); const val = await ctx.eval('val');
  Object.defineProperty(STATE.variables, name, { value: val, writable:false, configurable:false, enumerable:true });
  updateVarPanel(); return null;
});
registerNode('var.typeof','Variables','Type Of',[{id:'val',type:'any'}],[{id:'res',type:'string'}], async (ctx)=> typeof (await ctx.eval('val')));

// Logic & Control
registerNode('logic.if','Logic','If / Else',[{id:'exec',type:'exec'},{id:'cond',type:'boolean'}],[{id:'true',type:'exec',label:'Then'},{id:'false',type:'exec',label:'Else'}], async (ctx)=> { const cond = await ctx.eval('cond'); return cond ? 'true' : 'false'; });
registerNode('logic.compare','Logic','Compare',[{id:'a',type:'any'},{id:'op',type:'string',val:'=='},{id:'b',type:'any'}],[{id:'res',type:'boolean'}], async (ctx)=> { const a = await ctx.eval('a'); const b = await ctx.eval('b'); const op = ctx.input('op'); switch(op){case '==': return a==b; case '===': return a===b; case '!=': return a!=b; case '>': return a>b; case '<': return a<b; case '>=': return a>=b; case '<=': return a<=b; default: return false;} });
registerNode('logic.logical','Logic','Logical Op',[{id:'a',type:'boolean'},{id:'op',type:'string',val:'AND'},{id:'b',type:'boolean'}],[{id:'res',type:'boolean'}], async (ctx)=> { const a = await ctx.eval('a'); const b = await ctx.eval('b'); return ctx.input('op')==='AND' ? (a&&b) : (a||b); });

// Flow control
registerNode('flow.wait','Logic','Wait (ms)',[{id:'exec',type:'exec'},{id:'ms',type:'number',val:1000}],[{id:'exec',type:'exec'}], async (ctx)=> { const ms = Number(await ctx.eval('ms'))||0; await new Promise(r=>setTimeout(r,ms)); return 'exec'; });
registerNode('flow.for','Loops','For Loop',[{id:'exec',type:'exec'},{id:'start',type:'number',val:0},{id:'end',type:'number',val:10}],[{id:'loop',type:'exec',label:'Loop'},{id:'done',type:'exec',label:'Done'},{id:'idx',type:'number'}], async (ctx)=> { const s=Number(await ctx.eval('start')), e=Number(await ctx.eval('end')); for(let i=s;i<e;i++){ if(!STATE.isRunning) break; ctx.setTempOutput('idx', i); await ctx.trigger('loop'); } return 'done'; });
registerNode('flow.interval','Logic','Interval',[{id:'exec',type:'exec'},{id:'ms',type:'number',val:1000}],[{id:'tick',type:'exec'}], async (ctx)=> { const node = ctx.node; const ms = Number(await ctx.eval('ms'))||1000; if(STATE.timers[node.id]) clearInterval(STATE.timers[node.id]); STATE.timers[node.id] = setInterval(()=> ctx.trigger('tick').catch(()=>{}), ms); return null; });
registerNode('flow.clear_interval','Logic','Clear Interval',[{id:'exec',type:'exec'}],[{id:'exec',type:'exec'}], async (ctx)=> { const node = ctx.node; if(STATE.timers[node.id]) { clearInterval(STATE.timers[node.id]); delete STATE.timers[node.id]; } return 'exec'; });

// Arrays
registerNode('arr.create','Arrays','Create Empty Array',[],[{id:'arr',type:'array'}], async (ctx)=> []);
registerNode('arr.push','Arrays','Add to Array',[{id:'arr',type:'array'},{id:'val',type:'any'}],[{id:'arr',type:'array'}], async (ctx)=> { const a = (await ctx.eval('arr'))||[]; a.push(await ctx.eval('val')); return a; });
registerNode('arr.pop','Arrays','Remove Last',[{id:'arr',type:'array'}],[{id:'res',type:'any'},{id:'arr',type:'array'}], async (ctx)=> { const a = (await ctx.eval('arr'))||[]; const v = a.pop(); return { res: v, arr: a }; });
registerNode('arr.indexof','Arrays','Get Index',[{id:'arr',type:'array'},{id:'item',type:'any'}],[{id:'res',type:'number'}], async (ctx)=> (await ctx.eval('arr')||[]).indexOf(await ctx.eval('item')));
registerNode('arr.item','Arrays','Item at Index',[{id:'arr',type:'array'},{id:'idx',type:'number'}],[{id:'res',type:'any'}], async (ctx)=> { const a = (await ctx.eval('arr'))||[]; return a[Number(await ctx.eval('idx'))]; });

// Math
registerNode('math.op','Math','Math Op',[{id:'a',type:'number'},{id:'op',type:'string',val:'+'},{id:'b',type:'number'}],[{id:'res',type:'number'}], async (ctx)=> { const a=Number(await ctx.eval('a')); const b=Number(await ctx.eval('b')); const op = ctx.input('op'); switch(op){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;case '^':return Math.pow(a,b);default:return 0;} });
registerNode('math.rand','Math','Random',[{id:'min',type:'number',val:0},{id:'max',type:'number',val:1}],[{id:'res',type:'number'}], async (ctx)=> { const min=Number(await ctx.eval('min')), max=Number(await ctx.eval('max')); return Math.random()*(max-min)+min; });
registerNode('math.round','Math','Round',[{id:'n',type:'number'}],[{id:'res',type:'number'}], async (ctx)=>Math.round(Number(await ctx.eval('n'))));
registerNode('math.floor','Math','Floor',[{id:'n',type:'number'}],[{id:'res',type:'number'}], async (ctx)=>Math.floor(Number(await ctx.eval('n'))));
registerNode('math.ceil','Math','Ceil',[{id:'n',type:'number'}],[{id:'res',type:'number'}], async (ctx)=>Math.ceil(Number(await ctx.eval('n'))));
registerNode('math.pow','Math','Power',[{id:'a',type:'number'},{id:'b',type:'number'}],[{id:'res',type:'number'}], async (ctx)=>Math.pow(Number(await ctx.eval('a')),Number(await ctx.eval('b'))));
registerNode('math.sqrt','Math','Sqrt',[{id:'n',type:'number'}],[{id:'res',type:'number'}], async (ctx)=>Math.sqrt(Number(await ctx.eval('n'))));

// Strings
registerNode('str.join','Strings','Join Text',[{id:'a',type:'string'},{id:'b',type:'string'},{id:'sep',type:'string',val:''}],[{id:'res',type:'string'}], async (ctx)=> `${await ctx.eval('a')}${await ctx.eval('sep')}${await ctx.eval('b')}`);
registerNode('str.len','Strings','Text Length',[{id:'s',type:'string'}],[{id:'res',type:'number'}], async (ctx)=> String(await ctx.eval('s')).length);
registerNode('str.case','Strings','Change Case',[{id:'s',type:'string'},{id:'mode',type:'string',val:'upper'}],[{id:'res',type:'string'}], async (ctx)=> ctx.input('mode')==='upper' ? String(await ctx.eval('s')).toUpperCase() : String(await ctx.eval('s')).toLowerCase());
registerNode('str.substr','Strings','Substring',[{id:'s',type:'string'},{id:'start',type:'number',val:0},{id:'len',type:'number',val:5}],[{id:'res',type:'string'}], async (ctx)=> String(await ctx.eval('s')).substr(Number(await ctx.eval('start')), Number(await ctx.eval('len'))));

// DOM Manipulation
registerNode('dom.get_by_id','DOM Manipulation','Get Element by ID',[{id:'id',type:'string'}],[{id:'el',type:'object'}], async (ctx)=> document.getElementById(await ctx.eval('id')));
registerNode('dom.set_text','DOM Manipulation','Set Inner Text',[{id:'exec',type:'exec'},{id:'sel',type:'string'},{id:'text',type:'string'}],[{id:'exec',type:'exec'}], async (ctx)=> {
  try {
    const sel = await ctx.eval('sel'); const txt = await ctx.eval('text'); const el = document.querySelector(sel);
    if(!el) throw new Error('Selector not found: '+sel);
    el.innerText = txt;
    forwardToRunWindow('info', `DOM set text: ${sel}`);
    return 'exec';
  } catch(e) { forwardToRunWindow('error', `DOM error: ${e.message}`); throw e; }
});
registerNode('dom.set_html','DOM Manipulation','Set Inner HTML',[{id:'exec',type:'exec'},{id:'sel',type:'string'},{id:'html',type:'string'}],[{id:'exec',type:'exec'}], async (ctx)=> {
  try {
    const sel = await ctx.eval('sel'); const html = await ctx.eval('html'); const el = document.querySelector(sel);
    if(!el) throw new Error('Selector not found: '+sel);
    el.innerHTML = html; forwardToRunWindow('info', `DOM set html: ${sel}`); return 'exec';
  } catch(e) { forwardToRunWindow('error', `DOM error: ${e.message}`); throw e; }
});
registerNode('dom.set_style','DOM Manipulation','Set Style',[{id:'exec',type:'exec'},{id:'sel',type:'string'},{id:'prop',type:'string'},{id:'val',type:'string'}],[{id:'exec',type:'exec'}], async (ctx)=>{
  try {
    const sel = await ctx.eval('sel'); const prop = await ctx.eval('prop'); const val = await ctx.eval('val'); const el = document.querySelector(sel);
    if(!el) throw new Error('Selector not found: '+sel);
    el.style[prop] = val; forwardToRunWindow('info', `DOM set style: ${sel} ${prop}=${val}`); return 'exec';
  } catch(e) { forwardToRunWindow('error', `DOM error: ${e.message}`); throw e; }
});
registerNode('dom.on','DOM Manipulation','Event Listener',[{id:'sel',type:'string'},{id:'event',type:'string',val:'click'}],[{id:'exec',type:'exec'}], async (ctx)=> {
  const sel = await ctx.eval('sel'); const ev = await ctx.eval('event'); const els = document.querySelectorAll(sel);
  if(!els || els.length===0) return null;
  els.forEach(el => {
    const handler = ()=> ctx.trigger('exec').catch(()=>{});
    el.addEventListener(ev, handler);
    ctx.node._listeners = ctx.node._listeners || []; ctx.node._listeners.push({el, ev, handler});
  });
  return null;
});

// Functions
registerNode('fn.define','Functions','Define Function',[{id:'name',type:'string'},{id:'code',type:'string'}],[], async (ctx)=> {
  const name = await ctx.eval('name'); const code = await ctx.eval('code'); STATE.functions = STATE.functions || {}; STATE.functions[name] = code; return null;
});
registerNode('fn.call','Functions','Call Function',[{id:'name',type:'string'},{id:'args',type:'array'}],[{id:'res',type:'any'}], async (ctx)=> {
  const name = await ctx.eval('name'); const args = await ctx.eval('args')||[]; const code = STATE.functions && STATE.functions[name];
  if(!code) throw new Error('Function not found: '+name);
  try {
    const fn = new Function('args','state','log','return ('+code+')(args,state,log);');
    const res = fn(args, STATE, (m)=>{ log('[fn] '+m,'info'); forwardToRunWindow('info','[fn] '+m); });
    return res;
  } catch(e) { throw new Error('Function exec error: '+e.message); }
});

// Literals
registerNode('data.string','Variables','String Literal',[],[{id:'val',type:'string',val:''}], (ctx)=> ctx.input('val'));
registerNode('data.number','Variables','Number Literal',[],[{id:'val',type:'number',val:0}], (ctx)=> parseFloat(ctx.input('val')));
registerNode('data.array','Arrays','Array Literal',[],[{id:'val',type:'array',val:[]}], (ctx)=> ctx.input('val'));

// --- RENDERER & PALETTE ---
function initPalette(){
  if(!DOM.palette) return;
  DOM.palette.innerHTML = '';
  // ensure the palette container is scrollable and expands
  DOM.palette.style.overflowY = 'auto';
  DOM.palette.style.webkitOverflowScrolling = 'touch';
  DOM.palette.style.flex = '1';

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
        // drop near center of viewport
        const rect = DOM.viewport.getBoundingClientRect();
        const vx = (rect.width/2 - STATE.transform.x)/STATE.transform.k;
        const vy = (rect.height/2 - STATE.transform.y)/STATE.transform.k;
        addNode(def.type, vx, vy);
      };
      DOM.palette.appendChild(el);
    });
  });
  // ensure scrollable
  DOM.palette.style.overflowY = 'auto';
  DOM.palette.style.webkitOverflowScrolling = 'touch';
}

// create node DOM + model
function addNode(type, x, y, id = null, initialData = {}){
  const def = REGISTRY[type]; if(!def) return;
  const nId = id || uid();
  const nodeData = { id: nId, type, x, y, inputs: {}, outputs: {}, _meta: def, _listeners: [], _customScript: null, _customColor: null };
  def.inputs.forEach(inp => nodeData.inputs[inp.id] = initialData[inp.id] !== undefined ? initialData[inp.id] : (inp.val !== undefined ? inp.val : ''));
  STATE.nodes[nId] = nodeData;

  const el = document.createElement('div'); el.className='node'; el.id = nId; el.dataset.cat = def.cat;
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  el.style.left = '0px'; el.style.top = '0px';

  const head = document.createElement('div'); head.className='node-header';
  head.innerHTML = `<span>${def.name}</span><span class="small">${def.type}</span>`;
  if(nodeData._customColor) head.style.background = nodeData._customColor;
  el.appendChild(head);

  const body = document.createElement('div'); body.className='node-body';
  const leftCol = document.createElement('div'); leftCol.className='col';
  def.inputs.forEach(inp => {
    const row = document.createElement('div'); row.className='socket in';
    row.innerHTML = `<div class="port in type-${inp.type} ${inp.type==='exec'?'exec':''}" data-port="${inp.id}" data-type="${inp.type}" title="${inp.type}"></div>`;
    if(inp.type !== 'exec'){
      const inputField = document.createElement('input'); inputField.className='node-input';
      inputField.value = nodeData.inputs[inp.id];
      inputField.dataset.node = nId; inputField.dataset.inp = inp.id; inputField.onchange = (e)=> { STATE.nodes[e.target.dataset.node].inputs[e.target.dataset.inp] = e.target.value; showProperties(nId); };
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
    const row = document.createElement('div'); row.className='socket out';
    const lbl = document.createElement('span'); lbl.textContent = out.label || out.id; row.appendChild(lbl);
    row.innerHTML += `<div class="port out type-${out.type} ${out.type==='exec'?'exec':''}" data-port="${out.id}" data-type="${out.type}" title="${out.type}"></div>`;
    rightCol.appendChild(row);
  });

  body.append(leftCol, rightCol); el.appendChild(body);

  // events
  el.onmousedown = (e)=> { if(e.target.classList.contains('port') || e.target.tagName === 'INPUT') return; startDragNode(e, nId); };
  el.onclick = (e)=> { if(STATE.dragging) return; selectNode(nId, e.shiftKey); e.stopPropagation(); };
  el.oncontextmenu = (e)=> { e.preventDefault(); showNodeContextMenu(e.clientX, e.clientY, nId); };

  DOM.canvas.appendChild(el);
  return nId;
}

function selectNode(id, multi = false){
  if(!multi) { document.querySelectorAll('.node.selected').forEach(n=>n.classList.remove('selected')); STATE.selection = []; }
  const el = document.getElementById(id);
  if(el) { el.classList.add('selected'); if(!STATE.selection.includes(id)) STATE.selection.push(id); showProperties(id); updateCanvasInfo(); }
}

// --- CONNECTIONS & DRAWING ---
function updateConnections(){
  if(!DOM.svg) return;
  DOM.svg.innerHTML = '';
  STATE.connections.forEach((conn, idx) => {
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
    // hover -> red highlight
    path.addEventListener('mouseenter', ()=> { path.setAttribute('stroke','#ff4d4d'); path.setAttribute('stroke-width','4'); });
    path.addEventListener('mouseleave', ()=> { path.setAttribute('stroke', path.getAttribute('data-orig-stroke')||'#fff'); path.setAttribute('stroke-width','3'); });
    // click deletes
    path.addEventListener('click', ()=> { STATE.connections = STATE.connections.filter(c => c !== conn); updateConnections(); });
    DOM.svg.appendChild(path);
  });
}

// port position (canvas coordinates)
function getPortPos(nodeId, portId, dir) {
  const nodeEl = document.getElementById(nodeId);
  if(!nodeEl) return {x:0,y:0};
  const portEl = nodeEl.querySelector(`.port.${dir}[data-port="${portId}"]`) || nodeEl.querySelector(`.port[data-port="${portId}"]`);
  if(!portEl) return {x:0,y:0};
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
    case 'object':
    case 'array': return '#00b0ff';
    case 'exec': return '#ffffff';
    default: return '#b0bec5';
  }
}

// --- INTERACTION: pan/zoom/drag/wire + marquee multi-select ---
if(DOM.viewport) {
  DOM.viewport.addEventListener('mousedown', (e) => {
    // SHIFT + drag to marquee
    if(e.shiftKey && (e.target === DOM.viewport || e.target === DOM.canvas)) { startMarquee(e); return; }
    if(e.target === DOM.viewport || e.target === DOM.svg) { STATE.dragging = { type: 'pan', lx: e.clientX, ly: e.clientY }; }
  });

  DOM.viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const oldK = STATE.transform.k;
    const delta = -Math.sign(e.deltaY) * 0.1;
    STATE.transform.k = clamp(oldK + delta, 0.2, 5);
    updateTransform();
  });
}

// wiring start
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
    const node = STATE.nodes[STATE.dragging.id]; if(!node) return;
    const scale = STATE.transform.k; const dx = (e.clientX - STATE.dragging.lx)/scale, dy = (e.clientY - STATE.dragging.ly)/scale;
    node.x += dx; node.y += dy;
    const sx = Math.round(node.x / CONFIG.gridSize) * CONFIG.gridSize; const sy = Math.round(node.y / CONFIG.gridSize) * CONFIG.gridSize;
    const el = document.getElementById(STATE.dragging.id); if(el) el.style.transform = `translate(${sx}px, ${sy}px)`;
    STATE.dragging.lx = e.clientX; STATE.dragging.ly = e.clientY; updateConnections(); updateCanvasInfo();
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
        updateConnections();
      }
    }
    document.getElementById('temp-wire')?.remove();
  } else if(STATE.dragging?.type === 'marquee') {
    finishMarquee();
  }
  STATE.dragging = null;
});

// drag from palette drop
if(DOM.viewport) {
  DOM.viewport.addEventListener('dragover', e => e.preventDefault());
  DOM.viewport.addEventListener('drop', e => {
    e.preventDefault();
    const type = e.dataTransfer.getData('type'); if(!type) return;
    const rect = DOM.viewport.getBoundingClientRect();
    const x = (e.clientX - rect.left - STATE.transform.x) / STATE.transform.k;
    const y = (e.clientY - rect.top - STATE.transform.y) / STATE.transform.k;
    addNode(type, x, y);
    updateConnections();
  });
}

// start dragging node
function startDragNode(e, id) {
  STATE.dragging = { type: 'node', id, lx: e.clientX, ly: e.clientY };
  selectNode(id, false);
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

// --- Marquee multi-select implementation ---
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

// --- EXECUTION ENGINE & runtime console proxy ---
// A: runEngine triggers any start nodes by executing downstream connections.
// B: Proxy console to in-app console and run window while running.

function proxyConsoleToRuntime() {
  if(STATE._origConsole) return;
  STATE._origConsole = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
  console.log = function(...args){ try{ STATE._origConsole.log(...args); }catch(e){} const msg = args.map(x=> formatForLog(x)).join(' '); log(msg,'info'); forwardToRunWindow('info', msg); };
  console.warn = function(...args){ try{ STATE._origConsole.warn(...args);}catch(e){} const msg = args.map(x=> formatForLog(x)).join(' '); log(msg,'warn'); forwardToRunWindow('warn', msg); };
  console.error = function(...args){ try{ STATE._origConsole.error(...args);}catch(e){} const msg = args.map(x=> formatForLog(x)).join(' '); log(msg,'error'); forwardToRunWindow('error', msg); };
}
function restoreConsole() {
  if(!STATE._origConsole) return;
  console.log = STATE._origConsole.log; console.warn = STATE._origConsole.warn; console.error = STATE._origConsole.error;
  STATE._origConsole = null;
}
function formatForLog(x){ try { if(typeof x === 'object') return JSON.stringify(x); return String(x); } catch(e){ return String(x); } }

function disableRunUI(disable){
  try {
    if(DOM.runBtn) DOM.runBtn.disabled = disable;
    if(DOM.stepBtn) DOM.stepBtn.disabled = disable;
    if(DOM.stopBtn) DOM.stopBtn.disabled = !disable ? true : false;
  } catch(e){}
}

async function runEngine(){
  if(STATE.isRunning) return;
  // ensure run button/stop UI
  disableRunUI(true);
  openRunWindow();
  proxyConsoleToRuntime();
  STATE.isRunning = true;
  log('--- Execution Started ---','info');
  document.querySelectorAll('.node').forEach(n=>n.classList.remove('error','running'));

  // find start nodes and execute downstream connected nodes
  const starts = Object.values(STATE.nodes).filter(n => n.type === 'evt.start');
  try {
    // For each start, trigger outgoing exec-connected nodes
    for(const s of starts){
      // if node has exec output connections
      const outs = STATE.connections.filter(c => c.from === s.id && c.fromPort === 'exec');
      if(outs.length === 0){
        // if no direct outs, try executing the start node itself (some nodes may have execFunc)
        await executeNode(s.id);
      } else {
        // kick each downstream node
        for(const o of outs){
          await executeNode(o.to);
        }
      }
    }
  } catch(err) {
    log('Runtime Error: ' + (err?.message || String(err)),'error');
    forwardToRunWindow('error', 'Runtime Error: ' + (err?.message || String(err)));
  }

  STATE.isRunning = false;
  log('--- Execution Finished ---','info');
  restoreConsole();
  disableRunUI(false);
}

// Stop engine: clears runtime timers, marks not running, restores console
function stopEngine(){
  if(!STATE.isRunning && Object.keys(STATE.timers).length === 0){
    // nothing running
    log('Nothing to stop','warn');
    return;
  }
  // clear node timers
  Object.keys(STATE.timers).forEach(k => {
    try{ clearInterval(STATE.timers[k]); }catch(e){}
    try{ clearTimeout(STATE.timers[k]); }catch(e){}
    delete STATE.timers[k];
  });
  STATE.isRunning = false;
  restoreConsole();
  if(STATE.runWindow && !STATE.runWindow.closed) try{ STATE.runWindow.focus(); }catch(e){}
  log('--- Execution Stopped ---','info');
  disableRunUI(false);
}

// Step button: run a single cycle from first start node (useful for debugging)
async function stepOnce(){
  if(STATE.isRunning) {
    log('Already running','warn'); return;
  }
  // disable run UI during step
  disableRunUI(true);
  openRunWindow();
  proxyConsoleToRuntime();
  STATE.isRunning = true;
  log('--- Step Execution ---','info');
  const starts = Object.values(STATE.nodes).filter(n => n.type === 'evt.start');
  try {
    if(starts.length === 0) { log('No start nodes','warn'); }
    else {
      const s = starts[0];
      const outs = STATE.connections.filter(c => c.from === s.id && c.fromPort === 'exec');
      if(outs.length === 0) await executeNode(s.id);
      else {
        for(const o of outs) { await executeNode(o.to); }
      }
    }
  } catch(e){ log('Step Error: '+(e?.message||e),'error'); forwardToRunWindow('error','Step Error: '+(e?.message||e)); }
  STATE.isRunning = false;
  restoreConsole();
  disableRunUI(false);
}

if(DOM.stepBtn) DOM.stepBtn.onclick = stepOnce;
else console.warn('stepBtn not found');

// Ensure run/stop buttons are bound
if(DOM.runBtn) DOM.runBtn.onclick = runEngine;
else console.warn('runBtn not found');
if(DOM.stopBtn) DOM.stopBtn.onclick = stopEngine;

// executeNode: runs a node's execFunc and optional custom script, passes ctx with eval/trigger
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
      // no execFunc: if node has outgoing exec connections, trigger them
      const outConns = STATE.connections.filter(c => c.from === nodeId && c.fromPort === 'exec');
      for(const c of outConns) await executeNode(c.to);
    }
    // custom script
    if(node._customScript){
      try {
        const fn = new Function('ctx','state','log','return ('+node._customScript+')(ctx,state,log);');
        await fn(ctx, STATE, (m)=>{ log('[node-script] '+m,'info'); forwardToRunWindow('info','[node-script] '+m); });
      } catch(e){ el && el.classList.add('error'); throw e; }
    }
  } catch(e) {
    el && el.classList.add('error');
    log('Node Error (' + (def.name || node.type) + '): ' + (e?.message || String(e)), 'error');
    forwardToRunWindow('error', 'Node Error (' + (def.name || node.type) + '): ' + (e?.message || String(e)));
    throw e;
  }
}

// evaluateDataNode for value ports
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

// --- UI HELPERS & SERIALIZATION ---
function log(msg, type='info'){
  if(!DOM.console) return;
  const div = document.createElement('div'); div.className = 'log-line ' + type;
  div.textContent = `[${new Date().toLocaleTimeString()}] ${String(msg)}`;
  DOM.console.appendChild(div);
  DOM.console.scrollTop = DOM.console.scrollHeight;
}

function showProperties(id){
  const node = STATE.nodes[id];
  if(!DOM.props) return;
  DOM.props.innerHTML = '';
  if(!node){ DOM.props.innerHTML = '<p class="empty-msg">Select a node to edit properties.</p>'; return; }
  const def = REGISTRY[node.type];
  DOM.modalTitle && (DOM.modalTitle.textContent = def.name + ' — Properties');
  def.inputs.forEach(inp => {
    const row = document.createElement('div'); row.className = 'prop-row';
    const label = document.createElement('label'); label.textContent = `${inp.id} (${inp.type})`; row.appendChild(label);
    if(inp.type === 'boolean'){
      const sel = document.createElement('select'); sel.innerHTML = `<option value="true">true</option><option value="false">false</option>`;
      sel.value = String(node.inputs[inp.id]);
      sel.onchange = (e) => { node.inputs[inp.id] = e.target.value === 'true'; updateNodeInputUI(id, inp.id, e.target.value); };
      row.appendChild(sel);
    } else {
      const input = document.createElement('input'); input.value = node.inputs[inp.id];
      input.onchange = (e)=> { node.inputs[inp.id] = e.target.value; updateNodeInputUI(id, inp.id, e.target.value); };
      row.appendChild(input);
    }
    DOM.props.appendChild(row);
  });

  // custom script controls
  const hr = document.createElement('hr'); hr.style.border = '0'; hr.style.borderTop = '1px solid #222'; DOM.props.appendChild(hr);
  const csLabel = document.createElement('div'); csLabel.style.color = 'var(--text-dim)'; csLabel.textContent = 'Custom Script (runs after node exec)'; DOM.props.appendChild(csLabel);
  const csBtn = document.createElement('button'); csBtn.textContent = node._customScript ? 'Edit Script' : 'Add Script'; csBtn.onclick = ()=> addCustomScriptToNode(id);
  DOM.props.appendChild(csBtn);
  const colorBtn = document.createElement('button'); colorBtn.textContent = 'Header Color'; colorBtn.style.marginLeft = '8px';
  colorBtn.onclick = ()=> { const c = prompt('Header CSS (empty to reset):', node._customColor || '') || ''; node._customColor = c || null; const h = document.querySelector(`#${id} .node-header`); if(h) h.style.background = c || ''; };
  DOM.props.appendChild(colorBtn);
}

function updateNodeInputUI(nodeId, inputId, val){
  const inputEl = document.querySelector(`#${nodeId} .node-input[data-inp="${inputId}"]`);
  if(inputEl) inputEl.value = val;
}

function updateVarPanel(){
  if(!DOM.vars) return;
  DOM.vars.innerHTML = '';
  // top: add new var btn already present, below list editable
  Object.keys(STATE.variables).forEach(k => {
    const wrapper = document.createElement('div'); wrapper.className='var-item';
    const nameSpan = document.createElement('span'); nameSpan.textContent = k;
    const valInput = document.createElement('input'); valInput.value = JSON.stringify(STATE.variables[k]); valInput.style.background='transparent'; valInput.style.border='none'; valInput.style.color='var(--accent)'; valInput.style.width='60%';
    valInput.onchange = (e)=> {
      try {
        const parsed = JSON.parse(e.target.value);
        STATE.variables[k] = parsed;
      } catch(_){
        // if not JSON, store string
        STATE.variables[k] = e.target.value;
      }
      updateVarPanel();
    };
    const removeBtn = document.createElement('button'); removeBtn.className='icon-btn'; removeBtn.innerHTML = '<i class="material-icons">delete</i>'; removeBtn.onclick = ()=> { delete STATE.variables[k]; updateVarPanel(); };
    wrapper.appendChild(nameSpan); wrapper.appendChild(valInput); wrapper.appendChild(removeBtn);
    DOM.vars.appendChild(wrapper);
  });
}

// Save & Load
document.getElementById('saveBtn').onclick = ()=> {
  const json = JSON.stringify({ nodes: STATE.nodes, connections: STATE.connections, variables: STATE.variables });
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'project.json'; a.click();
};
document.getElementById('loadBtn').onclick = ()=> document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = (e) => {
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      STATE.nodes = {}; STATE.connections = []; DOM.canvas.innerHTML = '<svg id="connections"></svg>'; DOM.svg = document.getElementById('connections');
      Object.values(data.nodes || {}).forEach(n => {
        addNode(n.type, n.x, n.y, n.id, n.inputs);
        if(n._customScript) STATE.nodes[n.id]._customScript = n._customScript;
        if(n._customColor) { STATE.nodes[n.id]._customColor = n._customColor; const head = document.querySelector(`#${n.id} .node-header`); if(head) head.style.background = n._customColor; }
      });
      STATE.connections = data.connections || []; STATE.variables = data.variables || {};
      updateConnections(); updateVarPanel(); initPalette();
      log('Project loaded','info');
    } catch(err) { log('Load Error: '+(err?.message||err),'error'); }
  };
  reader.readAsText(file);
};

// clear
document.getElementById('clearBtn').onclick = ()=> {
  if(confirm('Clear all?')) {
    Object.values(STATE.nodes).forEach(n => { if(n._listeners) n._listeners.forEach(l=>{ try{ l.el.removeEventListener(l.ev, l.handler); }catch(e){} }); if(n._handler && n._handlerEl) try{ n._handlerEl.removeEventListener('click', n._handler); }catch(e){} });
    Object.keys(STATE.timers).forEach(k=>{ try{ clearInterval(STATE.timers[k]); }catch(e){} delete STATE.timers[k]; });
    STATE.nodes = {}; STATE.connections = []; DOM.canvas.innerHTML = '<svg id="connections"></svg>'; DOM.svg = document.getElementById('connections'); DOM.props.innerHTML = '<p class="empty-msg">Select a node to edit properties.</p>';
    updateConnections(); updateVarPanel();
  }
};

// theme
document.getElementById('themeBtn').onclick = ()=> document.body.classList.toggle('dark');

// open run window
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
if(DOM.runWindowBtn) DOM.runWindowBtn.onclick = openRunWindow;

// --- CONTEXT MENU & PER-NODE MENU ---
function showNodeContextMenu(x,y,nodeId){
  const menu = DOM.contextMenu; if(!menu) return;
  menu.innerHTML = '';
  const addItem = (label, cb) => { const d = document.createElement('div'); d.className = 'ctx-item'; d.textContent = label; d.onclick = ()=>{ cb(); menu.classList.add('hidden'); }; menu.appendChild(d); };
  addItem('Delete Node', ()=> deleteNodes([nodeId]));
  addItem('Duplicate Node', ()=> duplicateNode(nodeId));
  addItem('Add/Edit Custom Script', ()=> addCustomScriptToNode(nodeId));
  addItem('Run Custom Script', ()=> runCustomScriptForNode(nodeId));
  addItem('Export', ()=> { const n = STATE.nodes[nodeId]; const s = JSON.stringify(n, null, 2); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s],{type:'application/json'})); a.download = `${nodeId}.json`; a.click(); });
  menu.style.left = x + 'px'; menu.style.top = y + 'px'; menu.classList.remove('hidden');
}
document.addEventListener('click', ()=> { if(DOM.contextMenu) DOM.contextMenu.classList.add('hidden'); });

function deleteNodes(ids){ ids.forEach(id=>{ const n = STATE.nodes[id]; if(!n) return; if(n._listeners) n._listeners.forEach(l=>{ try{ l.el.removeEventListener(l.ev,l.handler); }catch(e){} }); if(n._handler && n._handlerEl) try{ n._handlerEl.removeEventListener('click', n._handler); }catch(e){} if(STATE.timers[id]) { clearInterval(STATE.timers[id]); delete STATE.timers[id]; } delete STATE.nodes[id]; document.getElementById(id)?.remove(); }); STATE.connections = STATE.connections.filter(c=> !ids.includes(c.from) && !ids.includes(c.to)); updateConnections(); DOM.props.innerHTML = '<p class="empty-msg">Select a node to edit properties.</p>'; STATE.selection = STATE.selection.filter(s => !ids.includes(s)); updateCanvasInfo(); }
function duplicateNode(id){ const s = STATE.nodes[id]; if(!s) return; const newId = uid(); const copyInputs = JSON.parse(JSON.stringify(s.inputs||{})); addNode(s.type, (s.x||100)+20, (s.y||100)+20, newId, copyInputs); if(s._customScript) STATE.nodes[newId]._customScript = s._customScript; if(s._customColor) { STATE.nodes[newId]._customColor = s._customColor; const head = document.querySelector(`#${newId} .node-header`); if(head) head.style.background = s._customColor; } updateConnections(); log('Duplicated '+id+' -> '+newId,'info'); }

function addCustomScriptToNode(nodeId){
  const node = STATE.nodes[nodeId];
  const existing = node._customScript || '';
  const code = prompt('Enter JS that returns a function (ctx,state,log). Example:\n(ctx,state,log)=>{ log(\"hi\"); }', existing) || '';
  if(code.trim()===''){ node._customScript = null; log('Removed custom script','info'); return; }
  node._customScript = code; log('Custom script saved','info');
}
async function runCustomScriptForNode(nodeId){
  const node = STATE.nodes[nodeId]; if(!node || !node._customScript){ log('No custom script','warn'); return; }
  try { const fn = new Function('ctx','state','log','return ('+node._customScript+')(ctx,state,log);'); await fn({node, input: n=>node.inputs[n], eval: async ()=>null}, STATE, (m)=>{ log('[node-script] '+m,'info'); forwardToRunWindow('info','[node-script] '+m); }); log('Custom script run ok','info'); } catch(e){ log('Custom script error: '+(e?.message||e),'error'); forwardToRunWindow('error','Custom script error: '+(e?.message||e)); }
}

// backspace deletes selected nodes (no confirmation) & zoom shortcuts
document.addEventListener('keydown', (e)=> {
  const ae = document.activeElement; if(ae && (ae.tagName==='INPUT' || ae.tagName==='TEXTAREA' || ae.isContentEditable)) return;
  if(e.key === 'Backspace') { if(STATE.selection.length){ e.preventDefault(); deleteNodes([...STATE.selection]); } }
  // ctrl + / - zoom
  if(e.ctrlKey && (e.key === '+' || e.key === '=')){ e.preventDefault(); STATE.transform.k = clamp(STATE.transform.k + 0.1, 0.2, 5); updateTransform(); }
  if(e.ctrlKey && e.key === '-'){ e.preventDefault(); STATE.transform.k = clamp(STATE.transform.k - 0.1, 0.2, 5); updateTransform(); }
  if(e.ctrlKey && (e.key === '0')) { e.preventDefault(); STATE.transform.k = 1; updateTransform(); }
});

// --- RIGHT-SIDE TAB SWITCHING (properties, variables, console, plugins) ---
function initRightTabs(){
  const sidebar = document.querySelector('#sidebar-right');
  if(!sidebar) return;
  const tabBar = document.createElement('div'); tabBar.style.display='flex'; tabBar.style.gap='6px'; tabBar.style.padding='6px'; tabBar.style.borderBottom='1px solid var(--border)';
  const tabs = [ {label:'Properties', sel:'.prop-panel'}, {label:'Variables', sel:'.var-panel'}, {label:'Console', sel:'.console-panel'}, {label:'Plugins', sel:'.plugin-panel'} ];
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

// --- PLUGIN MANAGER: modal-based (move add plugin there) ---
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
    removeBtn.onclick = ()=> { delete STATE.plugins[id]; renderPlugins(); initPalette(); };
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
      renderPlugins(); initPalette(); log('Plugin installed: '+name,'info');
    } catch(e){ log('Plugin error: '+(e?.message||e),'error'); alert('Plugin error: '+(e?.message||e)); }
  };
  document.getElementById('init-all-plugins').onclick = ()=> { Object.keys(STATE.plugins).forEach(k=> initPlugin(k)); };
}
if(document.getElementById('pluginBtn')) document.getElementById('pluginBtn').onclick = openPluginManager;

function initPlugin(id){
  const p = STATE.plugins[id];
  if(!p) { log('Plugin not found: '+id,'warn'); return; }
  if(p.code){
    try {
      const fn = new Function('registerNode','registerPlugin','state','log', p.code);
      const res = fn(registerNode, registerPlugin, STATE, (m)=>log('[plugin] '+m,'info'));
      if(res && typeof res.init === 'function') res.init(registerNode, registerPlugin, STATE, (m)=>log('[plugin:init] '+m,'info'));
      initPalette(); renderPlugins(); log('Plugin init executed: '+(p.name||id),'info');
    } catch(e){ log('Plugin init error: '+(e?.message||e),'error'); }
  } else if(typeof p.init === 'function'){ try{ p.init(registerNode, registerPlugin, STATE, (m)=>log('[plugin:init] '+m,'info')); }catch(e){ log('Plugin init error: '+(e?.message||e),'error'); } }
}

// docs modal (improved)
function docsHtml(){
  return `<h3>Plugin API & How to make plugins</h3>
    <p>Plugins allow you to add nodes or run init code. Use the provided helpers:</p>
    <ul>
      <li><code>registerNode(type, category, name, inputs, outputs, execFunc)</code> — defines a node.</li>
      <li><code>registerPlugin(id, meta)</code> — registers plugin metadata (optional).</li>
    </ul>
    <p><strong>Inputs/Outputs</strong>: arrays of objects like <code>{ id:'value', type:'number', val:0 }</code>. Type can be <code>exec</code>, <code>number</code>, <code>string</code>, <code>boolean</code>, <code>array</code>, <code>object</code>, <code>any</code>.</p>
    <p><strong>execFunc</strong> is async and receives a <code>ctx</code> object with:</p>
    <pre style="background:#0b0b0d;padding:8px;border-radius:6px;color:#9ef">
{
  node,                // node model
  input(name)          // returns raw input value (string defaults)
  eval(portName)       // async: evaluate upstream connected data node (if any)
  trigger(outPort)     // async: trigger outgoing exec connections from this node
  setTempOutput(port,val) // set temporary outputs for subsequent evaluateDataNode reads
}
    </pre>
    <p>Example plugin (paste into plugin box):</p>
    <pre style="background:#111;padding:8px;border-radius:6px;color:#9ef">
(function(registerNode, registerPlugin, state, log){
  registerNode('plugin.say','Plugins','Say Hello', [{id:'exec',type:'exec'},{id:'name',type:'string',val:'World'}], [{id:'exec',type:'exec'}], async (ctx)=>{
    const n = await ctx.eval('name');
    log('Hello ' + n);
    return 'exec';
  });
  return { init(){ registerPlugin('hello','Hello Plugin'); } };
});
    </pre>
    <p><strong>Security note:</strong> plugins run arbitrary JS in your page. Only install plugins you trust.</p>
    <p style="color:var(--text-dim)">When a plugin is installed, it may call <code>registerNode</code> immediately. Use <em>Init All</em> to re-run plugin init code.</p>`;
}
if(document.getElementById('docsBtn')) document.getElementById('docsBtn').onclick = ()=> openModal('Docs', docsHtml());

// modal helpers
document.getElementById('modal-close').onclick = closeModal;
document.getElementById('modal-backdrop').onclick = closeModal;
function openModal(title, html){
  if(DOM.modalTitle) DOM.modalTitle.textContent = title; if(DOM.modalBody) DOM.modalBody.innerHTML = html;
  if(DOM.modal) DOM.modal.classList.remove('hidden'); if(DOM.modalBackdrop) DOM.modalBackdrop.classList.remove('hidden');
}
function closeModal(){ if(DOM.modal) DOM.modal.classList.add('hidden'); if(DOM.modalBackdrop) DOM.modalBackdrop.classList.add('hidden'); }

// --- Canvas info: selected node coords or selection center (bottom-left) ---
function updateCanvasInfo(){
  const coordsEl = DOM.coordsInd;
  if(!coordsEl) return;
  if(STATE.selection.length === 0){ coordsEl.textContent = '0, 0'; return; }
  // compute bounding box of selection and display center in canvas-space (account for transform)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  STATE.selection.forEach(id => {
    const n = STATE.nodes[id];
    if(!n) return;
    const el = document.getElementById(id);
    if(!el) { // fall back to stored x,y
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
    } else {
      // computed transform value
      const style = el.style.transform; // translate(xpx, ypx)
      const m = style.match(/translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
      if(m){ const x = parseFloat(m[1]), y = parseFloat(m[2]); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); } else { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    }
  });
  if(minX === Infinity){ coordsEl.textContent = '0, 0'; return; }
  const cx = Math.round((minX + maxX)/2), cy = Math.round((minY + maxY)/2);
  coordsEl.textContent = `${cx}, ${cy}`;
}

// --- Palette Search (fix) ---
function filterPalette(q){
  if(!DOM.palette) return;
  const query = (q||'').trim().toLowerCase();
  const blocks = DOM.palette.querySelectorAll('.palette-block');
  const headers = DOM.palette.querySelectorAll('.category-header');
  if(!query){
    blocks.forEach(b=> b.style.display = '');
    headers.forEach(h=> h.style.display = '');
    return;
  }
  blocks.forEach(b=>{
    const name = b.dataset.name || '';
    const type = b.dataset.type || '';
    const cat = b.dataset.cat || '';
    const match = name.includes(query) || type.includes(query) || cat.includes(query);
    b.style.display = match ? '' : 'none';
  });
  // hide headers with no visible children
  headers.forEach(h=>{
    const cat = h.dataset.category || '';
    let any = false;
    DOM.palette.querySelectorAll(`.palette-block[data-cat="${cat}"]`).forEach(pb => { if(pb.style.display !== 'none') any = true; });
    h.style.display = any ? '' : 'none';
  });
}
if(DOM.paletteSearch){
  DOM.paletteSearch.addEventListener('input', (e)=> filterPalette(e.target.value));
  // ensure placeholder clearing on ESC
  DOM.paletteSearch.addEventListener('keydown', (e)=> { if(e.key === 'Escape'){ DOM.paletteSearch.value=''; filterPalette(''); } });
}

// --- Initialization & default example ---
initPalette();
updateTransform();
renderPlugins();
updateVarPanel();
updateConnections();
updateCanvasInfo();

// If empty, add starter nodes so Run does something
if(Object.keys(STATE.nodes).length === 0){
  const s = addNode('evt.start', 80, 60);
  const l = addNode('console.log', 300, 80);
  STATE.nodes[l].inputs['msg'] = 'Hello world';
  STATE.connections.push({ from: s, fromPort: 'exec', to: l, toPort: 'exec' });
  updateConnections();
}

// expose some helpers for dev/testing
window.STATE = STATE;
window.registerNode = registerNode;
window.registerPlugin = registerPlugin;
window.log = (m,t='info') => log(m,t);
