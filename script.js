// --- CORE CONFIGURATION & STATE ---
const CONFIG = {
    gridSize: 20,
    snapRadius: 15,
    colors: {
        exec: 'exec',
        string: 'string',
        number: 'number',
        boolean: 'boolean',
        object: 'object',
        any: 'any'
    }
};

const STATE = {
    nodes: {},          // Map<ID, NodeData>
    connections: [],    // Array<{from, fromPort, to, toPort}>
    variables: {},      // Map<Name, Value>
    transform: { x: 0, y: 0, k: 1 }, // Pan/Zoom
    dragging: null,     // { type, id, ... }
    selection: [],      // Array<ID>
    nextId: 1,
    isRunning: false,
    breakpoints: new Set(),
    plugins: {},        // plugin store
    functions: {},      // defined functions by user
    timers: {},         // node timers/intervals
    runWindow: null     // external runtime window
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
    modalBody: document.getElementById('modal-body')
};

// --- UTILITIES ---
const uid = () => 'n_' + Math.random().toString(36).substr(2, 9);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// --- NODE REGISTRY & DEFINITIONS ---
const REGISTRY = {};

function registerNode(type, cat, name, inputs, outputs, execFunc = null) {
    REGISTRY[type] = { type, cat, name, inputs, outputs, execFunc };
}

// Convenience registration helpers for many nodes requested
// EVENTS
registerNode('evt.start', 'Events', 'On Start', [], [{id:'exec', type:'exec'}]);

registerNode('evt.interval', 'Events', 'Interval', [{id:'ms', type:'number', val:1000}], [{id:'exec', type:'exec'}], async (ctx) => {
    // Start interval when node executes; store timer ID on node
    const node = ctx.node;
    const ms = Number(await ctx.eval('ms'));
    if (STATE.timers[node.id]) clearInterval(STATE.timers[node.id]);
    STATE.timers[node.id] = setInterval(() => {
        // trigger connected exec outputs
        ctx.trigger('exec').catch(e => log('Interval trigger err: '+e.message,'error'));
    }, ms);
    return null;
});

registerNode('evt.click', 'Events', 'On DOM Click', [{id:'sel', type:'string', val:'#btn'}], [{id:'exec', type:'exec'}], async (ctx) => {
    const sel = await ctx.eval('sel');
    const node = ctx.node;
    const el = document.querySelector(sel);
    if (!el) return null;
    const handler = () => {
        ctx.trigger('exec').catch(e => log('Click handler err: '+e.message,'error'));
    };
    // store handler to allow removal if reloaded
    node._handler = handler;
    el.addEventListener('click', handler);
    return null;
});

// LOG & DEBUG nodes
registerNode('console.log', 'Console & Debugging', 'Console Log', [{id:'exec', type:'exec'}, {id:'msg', type:'any'}], [{id:'exec', type:'exec'}], async (ctx) => {
    const m = await ctx.eval('msg');
    log(m, 'info');
    forwardToRunWindow('log', m);
    return 'exec';
});
registerNode('console.warn', 'Console & Debugging', 'Console Warn', [{id:'exec', type:'exec'}, {id:'msg', type:'any'}], [{id:'exec', type:'exec'}], async (ctx) => {
    const m = await ctx.eval('msg');
    log(m, 'warn'); forwardToRunWindow('warn', m);
    return 'exec';
});
registerNode('console.error', 'Console & Debugging', 'Console Error', [{id:'exec', type:'exec'}, {id:'msg', type:'any'}], [{id:'exec', type:'exec'}], async (ctx) => {
    const m = await ctx.eval('msg');
    log(m, 'error'); forwardToRunWindow('error', m);
    return 'exec';
});
registerNode('console.clear', 'Console & Debugging', 'Console Clear', [{id:'exec', type:'exec'}], [{id:'exec', type:'exec'}], async (ctx) => {
    DOM.console.innerHTML = ''; if (STATE.runWindow && !STATE.runWindow.closed) STATE.runWindow.document.getElementById('run-console').innerHTML = '';
    return 'exec';
});

// BROWSER INTERACTIONS
registerNode('browser.alert', 'Browser Interactions', 'Alert', [{id:'exec', type:'exec'}, {id:'msg', type:'string'}], [{id:'exec', type:'exec'}], async (ctx) => {
    const txt = await ctx.eval('msg');
    alert(txt);
    return 'exec';
});
registerNode('browser.prompt', 'Browser Interactions', 'Prompt', [{id:'exec', type:'exec'}, {id:'msg', type:'string'}], [{id:'res', type:'string'}], async (ctx) => {
    const r = prompt(await ctx.eval('msg')) || '';
    return r;
});
registerNode('browser.confirm', 'Browser Interactions', 'Confirm', [{id:'exec', type:'exec'}, {id:'msg', type:'string'}], [{id:'res', type:'boolean'}], async (ctx) => {
    return confirm(await ctx.eval('msg'));
});
registerNode('browser.open', 'Browser Interactions', 'Open URL', [{id:'url', type:'string'}], [], async (ctx) => {
    const u = await ctx.eval('url');
    window.open(u, '_blank');
});

// VARIABLES & DATA
registerNode('var.set', 'Variables', 'Set Variable', [{id:'exec', type:'exec'}, {id:'name', type:'string', val:'myVar'}, {id:'val', type:'any'}], [{id:'exec', type:'exec'}], async (ctx) => {
    const name = await ctx.eval('name');
    const val = await ctx.eval('val');
    STATE.variables[name] = val;
    updateVarPanel();
    return 'exec';
});
registerNode('var.get', 'Variables', 'Get Variable', [{id:'name', type:'string', val:'myVar'}], [{id:'val', type:'any'}], async (ctx) => {
    return STATE.variables[await ctx.eval('name')];
});
registerNode('var.const', 'Variables', 'Create Constant', [{id:'name', type:'string'}, {id:'val', type:'any'}], [], async (ctx) => {
    const name = await ctx.eval('name');
    const val = await ctx.eval('val');
    Object.defineProperty(STATE.variables, name, { value: val, writable:false, configurable:false, enumerable:true });
    updateVarPanel();
    return null;
});
registerNode('var.typeof', 'Variables', 'Type Of', [{id:'val', type:'any'}], [{id:'res', type:'string'}], async (ctx) => {
    const v = await ctx.eval('val'); return typeof v;
});

// LOGIC & CONTROL FLOW
registerNode('logic.if', 'Logic', 'If / Else', 
    [{id:'exec', type:'exec'}, {id:'cond', type:'boolean'}], 
    [{id:'true', type:'exec', label:'Then'}, {id:'false', type:'exec', label:'Else'}],
    async (ctx) => {
        const cond = await ctx.eval('cond');
        return cond ? 'true' : 'false';
    }
);
registerNode('logic.compare', 'Logic', 'Comparison', [{id:'a', type:'any'}, {id:'op', type:'string', val:'=='}, {id:'b', type:'any'}], [{id:'res', type:'boolean'}], async (ctx) => {
    const a = await ctx.eval('a'); const b = await ctx.eval('b'); const op = ctx.input('op');
    switch(op) {
        case '==': return a == b;
        case '===': return a === b;
        case '!=': return a != b;
        case '>': return a > b;
        case '<': return a < b;
        case '>=': return a >= b;
        case '<=': return a <= b;
        default: return false;
    }
});
registerNode('logic.logical', 'Logic', 'Logical Operators', [{id:'a', type:'boolean'}, {id:'op', type:'string', val:'AND'}, {id:'b', type:'boolean'}], [{id:'res', type:'boolean'}], async (ctx) => {
    const a = await ctx.eval('a'); const b = await ctx.eval('b');
    return ctx.input('op') === 'AND' ? (a && b) : (a || b);
});
registerNode('flow.wait', 'Logic', 'Wait (ms)', [{id:'exec', type:'exec'}, {id:'ms', type:'number', val:1000}], [{id:'exec', type:'exec'}], async (ctx) => {
    const ms = await ctx.eval('ms'); await new Promise(r => setTimeout(r, Number(ms))); return 'exec';
});
registerNode('flow.interval', 'Logic', 'Interval', [{id:'exec', type:'exec'}, {id:'ms', type:'number', val:1000}], [{id:'tick', type:'exec'}], async (ctx) => {
    const node = ctx.node; const ms = Number(await ctx.eval('ms'));
    if (STATE.timers[node.id]) clearInterval(STATE.timers[node.id]);
    STATE.timers[node.id] = setInterval(() => { ctx.trigger('tick').catch(()=>{}); }, ms);
    return null;
});
registerNode('flow.clear_interval', 'Logic', 'Clear Interval', [{id:'exec', type:'exec'}], [{id:'exec', type:'exec'}], async (ctx) => { const node = ctx.node; if(STATE.timers[node.id]) clearInterval(STATE.timers[node.id]); return 'exec'; });

// LOOPS & ITERATION
registerNode('flow.for', 'Loops', 'For Loop', [{id:'exec', type:'exec'}, {id:'start', type:'number', val:0}, {id:'end', type:'number', val:10}], [{id:'loop', type:'exec', label:'Loop'}, {id:'done', type:'exec', label:'Done'}, {id:'idx', type:'number'}], async (ctx) => {
    const s = Number(await ctx.eval('start')); const e = Number(await ctx.eval('end'));
    for(let i=s; i<e; i++) { if(!STATE.isRunning) break; ctx.setTempOutput('idx', i); await ctx.trigger('loop'); }
    return 'done';
});
registerNode('flow.while', 'Loops', 'While Loop', [{id:'exec', type:'exec'}, {id:'cond', type:'boolean'}], [{id:'loop', type:'exec'}], async (ctx) => {
    while(await ctx.eval('cond')) { if(!STATE.isRunning) break; await ctx.trigger('loop'); }
    return null;
});
registerNode('flow.foreach', 'Loops', 'For Each', [{id:'exec', type:'exec'}, {id:'arr', type:'array'}], [{id:'item', type:'any'}, {id:'idx', type:'number'}, {id:'loop', type:'exec'}], async (ctx) => {
    const arr = await ctx.eval('arr') || [];
    for(let i=0;i<arr.length;i++){ ctx.setTempOutput('item', arr[i]); ctx.setTempOutput('idx', i); await ctx.trigger('loop'); if(!STATE.isRunning) break; }
    return null;
});

// MATH
registerNode('math.op', 'Math', 'Math Op', [{id:'a', type:'number'}, {id:'op', type:'string', val:'+'}, {id:'b', type:'number'}], [{id:'res', type:'number'}], async (ctx) => {
    const a = Number(await ctx.eval('a')); const b = Number(await ctx.eval('b')); const op = ctx.input('op');
    switch(op) { case '+': return a+b; case '-': return a-b; case '*': return a*b; case '/': return a/b; case '%': return a%b; case '^': return Math.pow(a,b); default: return 0; }
});
registerNode('math.rand', 'Math', 'Random', [{id:'min', type:'number', val:0}, {id:'max', type:'number', val:1}], [{id:'res', type:'number'}], async (ctx) => { const min = Number(await ctx.eval('min')); const max = Number(await ctx.eval('max')); return Math.random()*(max-min)+min; });
registerNode('math.round', 'Math', 'Round', [{id:'n', type:'number'}], [{id:'res', type:'number'}], async (ctx) => Math.round(Number(await ctx.eval('n'))));
registerNode('math.floor', 'Math', 'Floor', [{id:'n', type:'number'}], [{id:'res', type:'number'}], async (ctx)=>Math.floor(Number(await ctx.eval('n'))));
registerNode('math.ceil', 'Math', 'Ceil', [{id:'n', type:'number'}], [{id:'res', type:'number'}], async (ctx)=>Math.ceil(Number(await ctx.eval('n'))));
registerNode('math.pow', 'Math', 'Power', [{id:'a', type:'number'},{id:'b', type:'number'}], [{id:'res', type:'number'}], async (ctx)=>Math.pow(Number(await ctx.eval('a')),Number(await ctx.eval('b'))));
registerNode('math.sqrt', 'Math', 'Sqrt', [{id:'n', type:'number'}], [{id:'res', type:'number'}], async (ctx)=>Math.sqrt(Number(await ctx.eval('n'))));

// STRINGS
registerNode('str.join', 'Strings', 'Join Text', [{id:'a', type:'string'},{id:'b', type:'string'},{id:'sep', type:'string', val:''}], [{id:'res', type:'string'}], async (ctx)=> `${await ctx.eval('a')}${await ctx.eval('sep')}${await ctx.eval('b')}`);
registerNode('str.len', 'Strings', 'Text Length', [{id:'s', type:'string'}], [{id:'res', type:'number'}], async (ctx)=> (String(await ctx.eval('s'))).length);
registerNode('str.case', 'Strings', 'Change Case', [{id:'s', type:'string'},{id:'mode', type:'string', val:'upper'}], [{id:'res', type:'string'}], async (ctx)=> ctx.input('mode') === 'upper' ? String(await ctx.eval('s')).toUpperCase() : String(await ctx.eval('s')).toLowerCase());
registerNode('str.substr', 'Strings', 'Substring', [{id:'s', type:'string'},{id:'start', type:'number', val:0},{id:'len', type:'number', val:5}], [{id:'res', type:'string'}], async (ctx)=> (String(await ctx.eval('s'))).substr(Number(await ctx.eval('start')), Number(await ctx.eval('len'))));

// ARRAYS
registerNode('arr.create', 'Arrays', 'Create Empty Array', [], [{id:'arr', type:'array'}], async (ctx)=>[]);
registerNode('arr.push', 'Arrays', 'Add to Array', [{id:'arr', type:'array'},{id:'val', type:'any'}], [{id:'arr', type:'array'}], async (ctx)=>{ const a = await ctx.eval('arr') || []; a.push(await ctx.eval('val')); return a; });
registerNode('arr.pop', 'Arrays', 'Remove Last', [{id:'arr', type:'array'}], [{id:'res', type:'any'}, {id:'arr', type:'array'}], async (ctx)=>{ const a = await ctx.eval('arr') || []; const v = a.pop(); return {res:v, arr:a}; });
registerNode('arr.indexof', 'Arrays', 'Get Index', [{id:'arr', type:'array'},{id:'item', type:'any'}], [{id:'res', type:'number'}], async (ctx)=> (await ctx.eval('arr') || []).indexOf(await ctx.eval('item')));
registerNode('arr.item', 'Arrays', 'Item at Index', [{id:'arr', type:'array'},{id:'idx', type:'number'}], [{id:'res', type:'any'}], async (ctx)=> { const a = await ctx.eval('arr')||[]; return a[Number(await ctx.eval('idx'))]; });

// DOM Manipulation
registerNode('dom.get_by_id', 'DOM Manipulation', 'Get Element by ID', [{id:'id', type:'string'}], [{id:'el', type:'object'}], async (ctx) => document.getElementById(await ctx.eval('id')));
registerNode('dom.set_text', 'DOM Manipulation', 'Set Inner Text', [{id:'exec', type:'exec'}, {id:'sel', type:'string'}, {id:'text', type:'string'}], [{id:'exec', type:'exec'}], async (ctx) => {
    try {
        const sel = await ctx.eval('sel'); const txt = await ctx.eval('text');
        const el = document.querySelector(sel);
        if(!el) throw new Error('Selector not found: '+sel);
        el.innerText = txt;
        forwardToRunWindow('info', `DOM set text success: ${sel}`);
        return 'exec';
    } catch(e) {
        forwardToRunWindow('error', `DOM error: ${e.message}`);
        throw e;
    }
});
registerNode('dom.set_html', 'DOM Manipulation', 'Set Inner HTML', [{id:'exec', type:'exec'}, {id:'sel', type:'string'}, {id:'html', type:'string'}], [{id:'exec', type:'exec'}], async (ctx) => {
    try {
        const sel = await ctx.eval('sel'); const html = await ctx.eval('html');
        const el = document.querySelector(sel); if(!el) throw new Error('Selector not found: '+sel);
        el.innerHTML = html;
        forwardToRunWindow('info', `DOM set html success: ${sel}`);
        return 'exec';
    } catch(e) { forwardToRunWindow('error', `DOM error: ${e.message}`); throw e; }
});
registerNode('dom.set_style', 'DOM Manipulation', 'Set Style', [{id:'exec', type:'exec'}, {id:'sel', type:'string'}, {id:'prop', type:'string'}, {id:'val', type:'string'}], [{id:'exec', type:'exec'}], async (ctx) => {
    try {
        const sel = await ctx.eval('sel'); const prop = await ctx.eval('prop'); const val = await ctx.eval('val');
        const el = document.querySelector(sel); if(!el) throw new Error('Selector not found: '+sel);
        el.style[prop] = val;
        forwardToRunWindow('info', `DOM set style success: ${sel} ${prop}=${val}`);
        return 'exec';
    } catch(e) { forwardToRunWindow('error', `DOM error: ${e.message}`); throw e; }
});
registerNode('dom.on', 'DOM Manipulation', 'Event Listener', [{id:'sel', type:'string'}, {id:'event', type:'string', val:'click'}], [{id:'exec', type:'exec'}], async (ctx) => {
    const sel = await ctx.eval('sel'); const ev = await ctx.eval('event'); const els = document.querySelectorAll(sel);
    if(!els || els.length===0) return null;
    els.forEach(el => {
        const handler = () => { ctx.trigger('exec').catch(()=>{}); };
        el.addEventListener(ev, handler);
        // store for potential cleanup
        ctx.node._listeners = ctx.node._listeners || [];
        ctx.node._listeners.push({el, ev, handler});
    });
    return null;
});

// FUNCTIONS
registerNode('fn.define', 'Functions', 'Define Function', [{id:'name', type:'string'},{id:'code', type:'string'}], [], async (ctx) => {
    const name = await ctx.eval('name'); const code = await ctx.eval('code');
    // store a JS function that receives (args, context, log)
    STATE.functions[name] = code;
    return null;
});
registerNode('fn.call', 'Functions', 'Call Function', [{id:'name', type:'string'},{id:'args', type:'array'}], [{id:'res', type:'any'}], async (ctx) => {
    const name = await ctx.eval('name');
    const args = await ctx.eval('args') || [];
    const code = STATE.functions[name];
    if(!code) throw new Error('Function not found: '+name);
    // sandboxed-ish: provide args and a relay 'log' function
    try {
        const fn = new Function('args','state','log','return ('+code+')(args,state,log);');
        const result = fn(args, STATE, (m)=>{ forwardToRunWindow('log', '[fn] '+m); log('[fn] '+m,'info'); });
        return result;
    } catch(e) {
        throw new Error('Function exec error: '+e.message);
    }
});

// LITERAL DATA nodes
registerNode('data.string', 'Variables', 'String Literal', [], [{id:'val', type:'string', val:''}], (ctx)=>ctx.input('val'));
registerNode('data.number', 'Variables', 'Number Literal', [], [{id:'val', type:'number', val:0}], (ctx)=>parseFloat(ctx.input('val')));
registerNode('data.array', 'Arrays', 'Array Literal', [], [{id:'val', type:'array', val:[] }], (ctx)=>ctx.input('val'));

// --- RENDERER & INTERACTION ---
function initPalette() {
    DOM.palette.innerHTML = '';
    const cats = {};
    Object.values(REGISTRY).forEach(def => {
        if (!cats[def.cat]) cats[def.cat] = [];
        cats[def.cat].push(def);
    });

    Object.keys(cats).sort().forEach(c => {
        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = c;
        DOM.palette.appendChild(header);

        cats[c].forEach(def => {
            const el = document.createElement('div');
            el.className = 'palette-block';
            el.innerHTML = `<i class="material-icons" style="font-size:14px">extension</i> ${def.name} <span class="meta">${def.type}</span>`;
            el.dataset.type = def.type;
            el.draggable = true;
            el.ondragstart = (e) => { e.dataTransfer.setData('type', def.type); };
            el.ondblclick = () => addNode(def.type, 100 - STATE.transform.x, 100 - STATE.transform.y);
            DOM.palette.appendChild(el);
        });
    });
}

function addNode(type, x, y, id = null, initialData = {}) {
    const def = REGISTRY[type];
    if (!def) return;
    const nId = id || uid();
    
    // Create Data Model
    const nodeData = {
        id: nId, type, x, y,
        inputs: {}, // store input raw values by id
        outputs: {},
        _meta: def
    };

    // populate default inputs
    def.inputs.forEach(inp => {
        nodeData.inputs[inp.id] = initialData[inp.id] !== undefined ? initialData[inp.id] : (inp.val !== undefined ? inp.val : '');
    });

    STATE.nodes[nId] = nodeData;

    // Create DOM
    const el = document.createElement('div');
    el.className = 'node';
    el.id = nId;
    el.dataset.cat = def.cat;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.left = '0px'; el.style.top = '0px';
    
    // Header
    const head = document.createElement('div');
    head.className = 'node-header';
    head.innerHTML = `<span>${def.name}</span><span class="small">${def.type}</span>`;
    el.appendChild(head);

    // Body
    const body = document.createElement('div');
    body.className = 'node-body';
    
    // Inputs (Left)
    const leftCol = document.createElement('div'); leftCol.className = 'col';
    def.inputs.forEach(inp => {
        const row = document.createElement('div');
        row.className = 'socket in';
        row.innerHTML = `<div class="port in type-${inp.type} ${inp.type === 'exec' ? 'exec' : ''}" data-port="${inp.id}" data-type="${inp.type}" title="${inp.type}"></div>`;
        
        if (inp.type !== 'exec') {
            const inputField = document.createElement('input');
            inputField.className = 'node-input';
            inputField.value = nodeData.inputs[inp.id];
            inputField.dataset.node = nId;
            inputField.dataset.inp = inp.id;
            inputField.onchange = (e) => { STATE.nodes[e.target.dataset.node].inputs[e.target.dataset.inp] = e.target.value; showProperties(nId); };
            inputField.onmousedown = (e) => e.stopPropagation();
            row.appendChild(inputField);
            
            const lbl = document.createElement('span'); lbl.textContent = inp.id; lbl.style.marginLeft = '6px';
            row.appendChild(lbl);
        } else {
             const lbl = document.createElement('span'); lbl.textContent = inp.label || inp.id; row.appendChild(lbl);
        }
        leftCol.appendChild(row);
    });

    // Outputs (Right)
    const rightCol = document.createElement('div'); rightCol.className = 'col';
    def.outputs.forEach(out => {
        const row = document.createElement('div');
        row.className = 'socket out';
        const lbl = document.createElement('span'); lbl.textContent = out.label || out.id;
        row.appendChild(lbl);
        const portHtml = `<div class="port out type-${out.type} ${out.type === 'exec' ? 'exec' : ''}" data-port="${out.id}" data-type="${out.type}" title="${out.type}"></div>`;
        row.innerHTML += portHtml;
        rightCol.appendChild(row);
    });

    body.append(leftCol, rightCol);
    el.appendChild(body);

    // Events
    el.onmousedown = (e) => {
        if(e.target.classList.contains('port') || e.target.tagName === 'INPUT') return;
        startDragNode(e, nId);
    };
    
    // Click to Select
    el.onclick = (e) => {
        if (STATE.dragging) return;
        selectNode(nId, e.shiftKey);
        e.stopPropagation();
    };

    DOM.canvas.appendChild(el);
    return nId;
}

function selectNode(id, multi) {
    if (!multi) {
        document.querySelectorAll('.node.selected').forEach(n => n.classList.remove('selected'));
        STATE.selection = [];
    }
    const el = document.getElementById(id);
    if(el) {
        el.classList.add('selected');
        if(!STATE.selection.includes(id)) STATE.selection.push(id);
        showProperties(id);
    }
}

// --- CONNECTIONS & DRAWING ---
function updateConnections() {
    // Clear lines
    DOM.svg.innerHTML = '';
    
    STATE.connections.forEach(conn => {
        const fromEl = document.getElementById(conn.from);
        const toEl = document.getElementById(conn.to);
        if(!fromEl || !toEl) return;

        const p1 = getPortPos(conn.from, conn.fromPort, 'out');
        const p2 = getPortPos(conn.to, conn.toPort, 'in');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        
        const dx = Math.abs(p1.x - p2.x);
        const c1x = p1.x + dx * 0.5;
        const c2x = p2.x - dx * 0.5;
        const d = `M ${p1.x} ${p1.y} C ${c1x} ${p1.y} ${c2x} ${p2.y} ${p2.x} ${p2.y}`;
        
        path.setAttribute('d', d);
        
        // Color based on port type
        const fromPortEl = fromEl.querySelector(`.port[data-port="${conn.fromPort}"]`);
        const type = fromPortEl ? fromPortEl.dataset.type : 'any';
        const stroke = (type && CONFIG.colors[type]) ? colorByType(type) : '#fff';
        path.setAttribute('stroke', stroke);
        path.setAttribute('stroke-width', '3');
        path.setAttribute('fill', 'none');
        path.classList.add('conn-line');
        
        // Click to delete
        path.onclick = (e) => {
            if (e.altKey) {
                STATE.connections = STATE.connections.filter(c => c !== conn);
                updateConnections();
            }
        };

        DOM.svg.appendChild(path);
    });
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

function getPortPos(nodeId, portId, dir) {
    const nodeEl = document.getElementById(nodeId);
    if(!nodeEl) return {x:0, y:0};
    const portEl = nodeEl.querySelector(`.port.${dir}[data-port="${portId}"]`) || nodeEl.querySelector(`.port[data-port="${portId}"]`);
    if(!portEl) return {x:0, y:0};
    
    // Calculate center relative to canvasInner
    const rect = portEl.getBoundingClientRect();
    const canRect = DOM.canvas.getBoundingClientRect();
    const scale = STATE.transform.k;
    
    return {
        x: (rect.left - canRect.left + rect.width/2) / scale,
        y: (rect.top - canRect.top + rect.height/2) / scale
    };
}

// --- INTERACTION LOGIC (Drag, Pan, Zoom) ---
DOM.viewport.addEventListener('mousedown', (e) => {
    if(e.target === DOM.viewport || e.target === DOM.svg) {
        // Pan Start
        STATE.dragging = { type: 'pan', lx: e.clientX, ly: e.clientY };
    }
});

DOM.viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const oldK = STATE.transform.k;
    const delta = -Math.sign(e.deltaY) * 0.1;
    const newK = clamp(oldK + delta, 0.2, 5);
    STATE.transform.k = newK;
    updateTransform();
});

// Port Logic (Wiring)
document.addEventListener('mousedown', (e) => {
    if(e.target.classList.contains('port') && e.target.classList.contains('out')) {
        e.stopPropagation();
        const nodeId = e.target.closest('.node').id;
        const portId = e.target.dataset.port;
        STATE.dragging = { type: 'wire', from: nodeId, port: portId };
        
        // Create Temp Line (curved)
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('stroke', '#fff');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-dasharray', '5,5');
        path.id = 'temp-wire';
        DOM.svg.appendChild(path);
    }
});

document.addEventListener('mousemove', (e) => {
    if(!STATE.dragging) return;

    if(STATE.dragging.type === 'pan') {
        const dx = e.clientX - STATE.dragging.lx;
        const dy = e.clientY - STATE.dragging.ly;
        STATE.transform.x += dx;
        STATE.transform.y += dy;
        STATE.dragging.lx = e.clientX;
        STATE.dragging.ly = e.clientY;
        updateTransform();
    }
    else if(STATE.dragging.type === 'node') {
        const node = STATE.nodes[STATE.dragging.id];
        const scale = STATE.transform.k;
        const dx = (e.clientX - STATE.dragging.lx) / scale;
        const dy = (e.clientY - STATE.dragging.ly) / scale;
        
        node.x += dx;
        node.y += dy;
        
        // Snap to grid
        const sx = Math.round(node.x / CONFIG.gridSize) * CONFIG.gridSize;
        const sy = Math.round(node.y / CONFIG.gridSize) * CONFIG.gridSize;
        
        const el = document.getElementById(STATE.dragging.id);
        el.style.transform = `translate(${sx}px, ${sy}px)`;
        
        STATE.dragging.lx = e.clientX;
        STATE.dragging.ly = e.clientY;
        updateConnections(); // Re-render lines
    }
    else if(STATE.dragging.type === 'wire') {
        const p1 = getPortPos(STATE.dragging.from, STATE.dragging.port, 'out');
        const rect = DOM.canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / STATE.transform.k;
        const my = (e.clientY - rect.top) / STATE.transform.k;
        
        const dx = Math.abs(p1.x - mx);
        const c1x = p1.x + dx * 0.5;
        const c2x = mx - dx * 0.5;
        const d = `M ${p1.x} ${p1.y} C ${c1x} ${p1.y} ${c2x} ${my} ${mx} ${my}`;
        document.getElementById('temp-wire').setAttribute('d', d);
    }
});

document.addEventListener('mouseup', (e) => {
    if (STATE.dragging?.type === 'wire') {
        const target = e.target;
        if(target.classList.contains('port') && target.classList.contains('in')) {
            const toNode = target.closest('.node').id;
            const toPort = target.dataset.port;
            
            if (toNode !== STATE.dragging.from) {
                // Remove existing connection to this input if single-input
                STATE.connections = STATE.connections.filter(c => !(c.to === toNode && c.toPort === toPort));
                STATE.connections.push({
                    from: STATE.dragging.from, fromPort: STATE.dragging.port,
                    to: toNode, toPort: toPort
                });
                updateConnections();
            }
        }
        document.getElementById('temp-wire')?.remove();
    }
    STATE.dragging = null;
});

// Drop from Palette
DOM.viewport.addEventListener('dragover', e => e.preventDefault());
DOM.viewport.addEventListener('drop', e => {
    e.preventDefault();
    const type = e.dataTransfer.getData('type');
    if(type) {
        const rect = DOM.viewport.getBoundingClientRect();
        const x = (e.clientX - rect.left - STATE.transform.x) / STATE.transform.k;
        const y = (e.clientY - rect.top - STATE.transform.y) / STATE.transform.k;
        addNode(type, x, y);
    }
});

function startDragNode(e, id) {
    STATE.dragging = { type: 'node', id, lx: e.clientX, ly: e.clientY };
    selectNode(id, false);
}

function updateTransform() {
    DOM.canvas.style.transform = `translate(${STATE.transform.x}px, ${STATE.transform.y}px) scale(${STATE.transform.k})`;
    DOM.zoomInd.textContent = Math.round(STATE.transform.k * 100) + '%';
    DOM.viewport.style.backgroundPosition = `${STATE.transform.x}px ${STATE.transform.y}px`;
    DOM.viewport.style.backgroundSize = `${CONFIG.gridSize * STATE.transform.k}px ${CONFIG.gridSize * STATE.transform.k}px`;
}

// --- EXECUTION ENGINE ---
async function runEngine() {
    if(STATE.isRunning) return;
    // open run window
    openRunWindow();
    STATE.isRunning = true;
    log('--- Execution Started ---', 'info');
    document.querySelectorAll('.node').forEach(n => n.classList.remove('error', 'running'));
    
    // Find Start Nodes
    const starts = Object.values(STATE.nodes).filter(n => n.type === 'evt.start');
    
    try {
        await Promise.all(starts.map(n => executeNode(n.id)));
    } catch (err) {
        log('Runtime Error: ' + (err && err.message ? err.message : String(err)), 'error');
        forwardToRunWindow('error', 'Runtime Error: ' + (err && err.message ? err.message : String(err)));
    }
    
    STATE.isRunning = false;
    log('--- Execution Finished ---', 'info');
}

async function executeNode(nodeId) {
    if(!STATE.isRunning) return;
    
    const node = STATE.nodes[nodeId];
    if(!node) return;
    const def = REGISTRY[node.type];
    if(!def) return;

    // Visual Highlight
    const el = document.getElementById(nodeId);
    el.classList.add('running');
    await new Promise(r => setTimeout(r, 40)); // Visual tick
    el.classList.remove('running');

    // Context for Node Execution
    const ctx = {
        node,
        input: (name) => {
            // fallback to raw input
            return node.inputs[name];
        },
        eval: async (portName) => {
            // find connection into this node for that input
            const conn = STATE.connections.find(c => c.to === nodeId && c.toPort === portName);
            if(conn) {
                // Recursively evaluate the source node for data
                return await evaluateDataNode(conn.from, conn.fromPort);
            }
            // fallback to manual input stored
            return node.inputs[portName];
        },
        trigger: async (outPort) => {
            const conns = STATE.connections.filter(c => c.from === nodeId && c.fromPort === outPort);
            for(let c of conns) {
                await executeNode(c.to);
            }
        },
        setTempOutput: (port, val) => {
            node.outputs = node.outputs || {};
            node.outputs[port] = val;
        }
    };

    try {
        if(def.execFunc) {
            const result = await def.execFunc(ctx);
            if(typeof result === 'string') {
                await ctx.trigger(result);
            }
        } else {
            // if no execFunc but outputs exist, try data outputs
            // nothing to do
        }
    } catch(e) {
        el.classList.add('error');
        log('Node Error ('+def.name+'): '+e.message, 'error');
        forwardToRunWindow('error', 'Node Error ('+def.name+'): '+e.message);
        throw e;
    }
}

// Evaluate a node strictly for DATA (not flow)
async function evaluateDataNode(nodeId, outPort) {
    const node = STATE.nodes[nodeId];
    const def = REGISTRY[node.type];
    if(!node || !def) return null;
    
    // temporary stored outputs
    if(node.outputs && node.outputs[outPort] !== undefined) return node.outputs[outPort];

    // data context
    const ctx = {
        eval: async (p) => {
            const c = STATE.connections.find(x => x.to === nodeId && x.toPort === p);
            if(c) return await evaluateDataNode(c.from, c.fromPort);
            return node.inputs[p];
        },
        input: (p) => node.inputs[p]
    };

    if(def.execFunc) {
        // some nodes return objects for multiple outputs; handle that
        const res = await def.execFunc({ ...ctx, node });
        // If res is object and outPort maps, try to return matching field
        if(res && typeof res === 'object' && res[outPort] !== undefined) return res[outPort];
        return res;
    }
    return null;
}

// --- UI HELPERS & SERIALIZATION ---
function log(msg, type='info') {
    const div = document.createElement('div');
    div.className = `log-line ${type}`;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${String(msg)}`;
    DOM.console.appendChild(div);
    DOM.console.scrollTop = DOM.console.scrollHeight;
}

// Forward logs to opened run window if present
function forwardToRunWindow(level, msg) {
    if(!STATE.runWindow || STATE.runWindow.closed) return;
    try {
        const rc = STATE.runWindow.document.getElementById('run-console');
        const line = document.createElement('div');
        line.className = `log-line ${level}`;
        line.textContent = `[${new Date().toLocaleTimeString()}] ${String(msg)}`;
        rc.appendChild(line);
        rc.scrollTop = rc.scrollHeight;
    } catch(e) {
        // ignore cross-window issues
    }
}

function showProperties(id) {
    const node = STATE.nodes[id];
    DOM.props.innerHTML = '';
    if(!node) { DOM.props.innerHTML = '<p class="empty-msg">Select a node to edit properties.</p>'; return; }
    
    const def = REGISTRY[node.type];
    DOM.modalTitle && (DOM.modalTitle.textContent = def.name + ' — Properties');
    def.inputs.forEach(inp => {
        const div = document.createElement('div');
        div.className = 'prop-row';
        div.innerHTML = `<label>${inp.id} (${inp.type})</label>`;
        if(inp.type === 'boolean') {
            const sel = document.createElement('select');
            sel.innerHTML = `<option value="true">true</option><option value="false">false</option>`;
            sel.value = node.inputs[inp.id];
            sel.onchange = (e) => { node.inputs[inp.id] = e.target.value === 'true'; updateNodeInputUI(id, inp.id, e.target.value); };
            div.appendChild(sel);
        } else {
            const input = document.createElement('input');
            input.value = node.inputs[inp.id];
            input.onchange = (e)=>{ node.inputs[inp.id] = e.target.value; updateNodeInputUI(id, inp.id, e.target.value); };
            div.appendChild(input);
        }
        DOM.props.appendChild(div);
    });
}

function updateNodeInputUI(nodeId, inputId, val) {
    const inputEl = document.querySelector(`#${nodeId} .node-input[data-inp="${inputId}"]`);
    if(inputEl) inputEl.value = val;
}

function updateVarPanel() {
    DOM.vars.innerHTML = '';
    Object.keys(STATE.variables).forEach(k => {
        const el = document.createElement('div');
        el.className = 'var-item';
        el.innerHTML = `<span>${k}</span><span class="var-val">${String(STATE.variables[k])}</span>`;
        DOM.vars.appendChild(el);
    });
}

// Save & Load
document.getElementById('saveBtn').onclick = () => {
    const json = JSON.stringify({ nodes: STATE.nodes, connections: STATE.connections, variables: STATE.variables });
    const blob = new Blob([json], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project.json';
    a.click();
};

document.getElementById('loadBtn').onclick = () => document.getElementById('fileInput').click();

document.getElementById('fileInput').onchange = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            STATE.nodes = {};
            STATE.connections = [];
            DOM.canvas.innerHTML = '<svg id="connections"></svg>';
            DOM.svg = document.getElementById('connections');
            
            Object.values(data.nodes).forEach(n => {
                addNode(n.type, n.x, n.y, n.id, n.inputs);
            });
            STATE.connections = data.connections || [];
            STATE.variables = data.variables || {};
            updateConnections();
            updateVarPanel();
            log('Project loaded successfully');
        } catch(err) {
            log('Load Error: ' + err, 'error');
        }
    };
    reader.readAsText(file);
};

// Controls
document.getElementById('runBtn').onclick = runEngine;
document.getElementById('stopBtn').onclick = () => { stopEngine(); log('Execution Stopped'); };
document.getElementById('clearBtn').onclick = () => {
    if(confirm("Clear all?")) {
        // cleanup timers/listeners
        Object.values(STATE.nodes).forEach(n => { if(n._listeners) n._listeners.forEach(l=>l.el.removeEventListener(l.ev, l.handler)); if(n._handler){ /* can't easily remove w/out selector */ } });
        Object.keys(STATE.timers).forEach(k=>clearInterval(STATE.timers[k]));
        STATE.nodes = {}; STATE.connections = [];
        DOM.canvas.innerHTML = '<svg id="connections"></svg>';
        DOM.svg = document.getElementById('connections');
    }
};

function stopEngine() {
    STATE.isRunning = false;
    // clear timers set by nodes
    Object.keys(STATE.timers).forEach(k=>{ try{ clearInterval(STATE.timers[k]); }catch(e){} delete STATE.timers[k]; });
}

// Search palette
document.getElementById('paletteSearch').addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase();
    document.querySelectorAll('.palette-block').forEach(el => {
        el.style.display = el.textContent.toLowerCase().includes(val) ? 'flex' : 'none';
    });
});

document.getElementById('addVarBtn').onclick = () => {
    const name = prompt("Variable Name:");
    if(name) { STATE.variables[name] = 0; updateVarPanel(); }
};

document.getElementById('clearLogBtn').onclick = () => DOM.console.innerHTML = '';
document.getElementById('themeBtn').onclick = () => document.body.classList.toggle('dark');

// Plugin UI / Docs UI
document.getElementById('pluginBtn').onclick = () => openModal('Plugin Manager', pluginManagerHtml());
document.getElementById('docsBtn').onclick = () => openModal('Docs', docsHtml());
document.getElementById('addPluginBtn').onclick = () => {
    const code = prompt('Paste plugin JS (it should call registerPlugin or registerNode):');
    if(!code) return;
    try {
        const fn = new Function('registerNode','registerPlugin','log','return ('+code+')');
        fn(registerNode, registerPlugin, (m)=>log('[plugin] '+m,'info'));
        log('Plugin loaded', 'info');
        renderPlugins();
        initPalette();
    } catch(e) { log('Plugin error: '+e.message,'error'); }
};
document.getElementById('plugins-list').addEventListener('click', (e)=>{ if(e.target.dataset.plugin) removePlugin(e.target.dataset.plugin); });

// Modal wiring
document.getElementById('modal-close').onclick = closeModal;
document.getElementById('modal-backdrop').onclick = closeModal;
function openModal(title, html) {
    DOM.modalTitle.textContent = title;
    DOM.modalBody.innerHTML = html;
    DOM.modal.classList.remove('hidden'); DOM.modalBackdrop.classList.remove('hidden');
}
function closeModal() { DOM.modal.classList.add('hidden'); DOM.modalBackdrop.classList.add('hidden'); }

// Plugin system
function registerPlugin(id, meta) {
    STATE.plugins[id] = meta || { id, name: id };
    renderPlugins();
}
function removePlugin(id) {
    delete STATE.plugins[id];
    renderPlugins();
}
function renderPlugins() {
    DOM.pluginsList.innerHTML = '';
    Object.keys(STATE.plugins).forEach(k=>{
        const p = STATE.plugins[k];
        const el = document.createElement('div');
        el.style.display='flex'; el.style.justifyContent='space-between'; el.style.alignItems='center'; el.style.marginBottom='6px';
        el.innerHTML = `<div><strong>${p.name||p.id}</strong><div style="font-size:12px;color:var(--text-dim)">${p.id}</div></div><div><button data-plugin="${k}" class="icon-btn" title="Remove Plugin"><i class="material-icons">delete</i></button></div>`;
        DOM.pluginsList.appendChild(el);
    });
}

// Docs content
function docsHtml() {
    return `<h3>Plugin API & How to make plugins</h3>
    <p>Plugins may register new nodes or expose functions. Use the provided helpers:</p>
    <pre style="background:#111;padding:8px;border-radius:6px;color:#9ef">registerNode(type, category, name, inputs, outputs, execFunc)</pre>
    <pre style="background:#111;padding:8px;border-radius:6px;color:#9ef">registerPlugin(id, meta)</pre>
    <p>Example plugin that adds a "Say Hello" node:</p>
    <pre style="background:#111;padding:8px;border-radius:6px;color:#9ef">
(function(){
  registerNode('hello.say','Plugins','Say Hello', [{id:'exec',type:'exec'},{id:'name',type:'string',val:'You'}],[{id:'exec',type:'exec'}], async (ctx)=>{
    const n = await ctx.eval('name');
    log('Hello '+n);
    return 'exec';
  });
  registerPlugin('hello-plugin',{name:'Hello Plugin'});
})();
    </pre>
    <p>Functions: use define/call function nodes. Define expects valid JS (it should return a function):</p>
    <pre style="background:#111;padding:8px;border-radius:6px;color:#9ef">
(args,state,log) => {
  // args is array
  log('running with '+JSON.stringify(args));
  return args[0] * 2;
}
    </pre>
    <p>When run is pressed, a runtime window opens and all console/log/warn/error messages are forwarded there.</p>`;
}

// Plugin manager HTML
function pluginManagerHtml() {
    let html = '<p>Installed plugins:</p><div id="plugin-list-inner">';
    html += '</div><p>Use the "Add Plugin" button (top-right) to paste JS that calls <code>registerNode</code> or <code>registerPlugin</code>.</p>';
    return html;
}

// Open run window and set up console area
function openRunWindow() {
    try {
        if(STATE.runWindow && !STATE.runWindow.closed) { STATE.runWindow.focus(); return; }
        const w = window.open('', 'titan-run', 'width=700,height=600');
        const doc = w.document;
        doc.open();
        doc.write(`<!doctype html><html><head><title>Titan Runtime</title><style>
          body{background:#0b0b0d;color:#f0f0f0;font-family:Consolas,monospace;padding:8px}
          #run-console{height:90vh;overflow:auto;border:1px solid #222;padding:8px;background:#050506}
          .log-line{margin-bottom:6px}
          .log-line.warn{color:#ffb74d}
          .log-line.error{color:#ff6b6b}
          .log-line.info{color:#81d4fa}
        </style></head><body>
        <h3>Titan Run Console</h3>
        <div id="run-console"></div>
        <script>
          // capture console in this window page
          (function(){
            const rc = document.getElementById('run-console');
            console._orig = { log:console.log, warn:console.warn, error:console.error };
            console.log = function(){ const m = Array.from(arguments).join(' '); const div=document.createElement('div'); div.className='log-line info'; div.textContent=new Date().toLocaleTimeString()+' '+m; rc.appendChild(div); rc.scrollTop=rc.scrollHeight; console._orig.log.apply(console, arguments); };
            console.warn = function(){ const m = Array.from(arguments).join(' '); const div=document.createElement('div'); div.className='log-line warn'; div.textContent=new Date().toLocaleTimeString()+' '+m; rc.appendChild(div); rc.scrollTop=rc.scrollHeight; console._orig.warn.apply(console, arguments); };
            console.error = function(){ const m = Array.from(arguments).join(' '); const div=document.createElement('div'); div.className='log-line error'; div.textContent=new Date().toLocaleTimeString()+' '+m; rc.appendChild(div); rc.scrollTop=rc.scrollHeight; console._orig.error.apply(console, arguments); };
          })();
        </script>
        </body></html>`);
        doc.close();
        STATE.runWindow = w;
    } catch(e) {
        log('Could not open run window: '+e.message,'error');
    }
}

document.getElementById('openRunWindowBtn').onclick = openRunWindow;

// --- Initialization ---
initPalette();
updateTransform();
renderPlugins();

// --- Extra: allow right-click to delete nodes/connections (basic) ---
document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if(e.target.closest('.node')) {
        const id = e.target.closest('.node').id;
        if(confirm('Delete node?')) {
            // cleanup listeners/timers
            const n = STATE.nodes[id];
            if(n && n._listeners) n._listeners.forEach(l=>l.el.removeEventListener(l.ev, l.handler));
            delete STATE.nodes[id];
            // remove connections that reference it
            STATE.connections = STATE.connections.filter(c=>c.from!==id && c.to!==id);
            document.getElementById(id)?.remove();
            updateConnections();
            DOM.props.innerHTML = '<p class="empty-msg">Select a node to edit properties.</p>';
        }
    }
});

// expose registerPlugin globally so pasted plugin code can call it
window.registerPlugin = registerPlugin;
window.registerNode = registerNode;
window.log = (m,t='info') => log(m,t);

