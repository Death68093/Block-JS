(() => {
    const DOM = {
        viewport: document.getElementById('canvas-viewport'),
        canvas: document.getElementById('canvasInner'),
        svg: document.getElementById('connections'),
        palette: document.getElementById('block-palette')
    };

    const STATE = {
        blocks: {}, connections: [], plugins: {},
        pan: { x: 0, y: 0 }, drag: null, 
        selection: null
    };

    const GRID = 25;
    const uid = () => 'n_' + Math.random().toString(36).substr(2, 9);

    // --- 1. NODE REGISTRY ---
    function reg(type, name, cat, inputs = {}, outputs = ['exec'], shape = 'statement') {
        STATE.plugins[type] = { type, name, cat, inputs, outputs, shape };
    }

    // Logic & Flow
    reg('logic.if', 'If / Else', 'Logic', { condition: 'true' }, ['then', 'else']);
    reg('logic.while', 'While Loop', 'Logic', { condition: 'true' }, ['loop', 'exit']);
    reg('logic.for', 'For Loop', 'Logic', { from: 0, to: 10 }, ['loop', 'done']);
    reg('logic.wait', 'Wait (ms)', 'Logic', { ms: 1000 });
    reg('logic.and', 'And', 'Logic', { a: 'true', b: 'true' }, ['value'], 'expression');
    reg('logic.not', 'Not', 'Logic', { val: 'true' }, ['value'], 'expression');

    // Math
    reg('math.add', 'Add', 'Math', { a: 0, b: 0 }, ['value'], 'expression');
    reg('math.sub', 'Subtract', 'Math', { a: 0, b: 0 }, ['value'], 'expression');
    reg('math.mul', 'Multiply', 'Math', { a: 1, b: 1 }, ['value'], 'expression');
    reg('math.div', 'Divide', 'Math', { a: 1, b: 1 }, ['value'], 'expression');
    reg('math.random', 'Random Float', 'Math', { min: 0, max: 1 }, ['value'], 'expression');
    reg('math.clamp', 'Clamp', 'Math', { val: 0, min: 0, max: 100 }, ['value'], 'expression');
    reg('math.sin', 'Sine', 'Math', { deg: 0 }, ['value'], 'expression');

    // Strings
    reg('str.concat', 'Concatenate', 'Strings', { a: 'Hello', b: 'World' }, ['value'], 'expression');
    reg('str.len', 'Length', 'Strings', { text: '' }, ['value'], 'expression');
    reg('str.upper', 'Uppercase', 'Strings', { text: 'hi' }, ['value'], 'expression');
    reg('str.template', 'Template', 'Strings', { tpl: 'Hello ${name}' }, ['value'], 'expression');

    // Variables
    reg('var.set', 'Set Variable', 'Data', { name: 'myVar', val: 0 });
    reg('var.get', 'Get Variable', 'Data', { name: 'myVar' }, ['value'], 'expression');
    reg('data.json_p', 'JSON Parse', 'Data', { json: '{}' }, ['value'], 'expression');

    // DOM & Browser
    reg('dom.query', 'Query Selector', 'DOM', { query: '#id' }, ['element'], 'expression');
    reg('dom.set_text', 'Set Text', 'DOM', { query: '.el', text: 'Hello' });
    reg('browser.alert', 'Alert', 'Browser', { msg: 'Warning!' });
    reg('browser.local_s', 'LocalStorage Set', 'Browser', { key: 'score', val: 100 });

    // Time
    reg('time.now', 'Timestamp', 'Time', {}, ['value'], 'expression');
    reg('time.interval', 'On Interval', 'Time', { ms: 1000 }, ['exec'], 'event');

    // --- 2. PALETTE GENERATION ---
    function buildPalette() {
        const cats = {};
        Object.values(STATE.plugins).forEach(p => {
            if (!cats[p.cat]) cats[p.cat] = [];
            cats[p.cat].push(p);
        });

        Object.keys(cats).sort().forEach(catName => {
            const wrap = document.createElement('div');
            wrap.className = 'category-wrap';
            wrap.innerHTML = `<h4>${catName}</h4>`;
            cats[catName].forEach(p => {
                const b = document.createElement('div');
                b.className = 'block';
                b.textContent = p.name;
                b.dataset.type = p.type;
                b.onpointerdown = (e) => spawnFromPalette(e, p.type);
                wrap.appendChild(b);
            });
            DOM.palette.appendChild(wrap);
        });
    }

    // --- 3. CORE INTERACTION ---
    function spawnFromPalette(e, type) {
        const id = uid();
        const rect = DOM.viewport.getBoundingClientRect();
        const x = (e.clientX - rect.left - STATE.pan.x);
        const y = (e.clientY - rect.top - STATE.pan.y);
        
        STATE.blocks[id] = { id, type, x, y, inputs: { ...STATE.plugins[type].inputs } };
        renderBlock(id);
        STATE.drag = { type: 'node', id, ox: e.clientX - x, oy: e.clientY - y };
    }

    function renderBlock(id) {
        const node = STATE.blocks[id];
        const def = STATE.plugins[node.type];
        const el = document.createElement('div');
        el.className = `workspace-block ${def.shape}`;
        el.id = id;
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';

        // Ports - Left (Inputs)
        const left = document.createElement('div'); left.className = 'ports';
        if (def.shape !== 'event') {
            const p = document.createElement('div'); p.className = 'port in exec'; p.dataset.port = 'exec';
            left.appendChild(p);
        }
        Object.keys(def.inputs).forEach(k => {
            const p = document.createElement('div'); p.className = 'port in value'; p.dataset.port = k;
            left.appendChild(p);
        });

        // Body
        const body = document.createElement('div'); body.className = 'node-body';
        body.innerHTML = `<div class="node-title">${def.name}</div>`;
        Object.keys(node.inputs).forEach(k => {
            const input = document.createElement('input');
            input.value = node.inputs[k];
            input.style.width = '100%';
            input.onchange = (e) => { node.inputs[k] = e.target.value; };
            body.appendChild(input);
        });

        // Ports - Right (Outputs)
        const right = document.createElement('div'); right.className = 'ports';
        def.outputs.forEach(o => {
            const p = document.createElement('div');
            const isExec = (o === 'exec' || o === 'then' || o === 'else' || o === 'loop' || o === 'done');
            p.className = `port out ${isExec ? 'exec' : 'value'}`;
            p.dataset.port = o;
            p.onpointerdown = (e) => startWire(e, id, o);
            right.appendChild(p);
        });

        el.append(left, body, right);
        el.onpointerdown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.classList.contains('port')) return;
            STATE.drag = { type: 'node', id, ox: e.clientX - node.x, oy: e.clientY - node.y };
            e.stopPropagation();
        };

        DOM.canvas.appendChild(el);
    }

    // --- 4. LINE DRAWING ---
    function startWire(e, id, port) {
        e.stopPropagation();
        STATE.drag = { type: 'wire', from: id, fPort: port };
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.id = 'temp-line';
        line.setAttribute('stroke', '#00ff88');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('fill', 'none');
        DOM.svg.appendChild(line);
    }

    function updateTempWire(tx, ty) {
        const s = getPortPos(STATE.drag.from, STATE.drag.fPort, 'out');
        const path = document.getElementById('temp-line');
        const d = `M ${s.x} ${s.y} C ${s.x + 50} ${s.y}, ${tx - 50} ${ty}, ${tx} ${ty}`;
        path.setAttribute('d', d);
    }

    function getPortPos(id, portName, kind) {
        const node = STATE.blocks[id];
        const el = document.getElementById(id);
        const p = el.querySelector(`.port.${kind}[data-port="${portName}"]`);
        return { x: node.x + p.offsetLeft + 6, y: node.y + p.offsetTop + 6 };
    }

    window.onpointermove = (e) => {
        if (!STATE.drag) return;
        if (STATE.drag.type === 'node') {
            const node = STATE.blocks[STATE.drag.id];
            node.x = Math.round((e.clientX - STATE.drag.ox) / 5) * 5;
            node.y = Math.round((e.clientY - STATE.drag.oy) / 5) * 5;
            const el = document.getElementById(STATE.drag.id);
            el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
            drawAllLines();
        } else if (STATE.drag.type === 'wire') {
            const rect = DOM.viewport.getBoundingClientRect();
            updateTempWire(e.clientX - rect.left - STATE.pan.x, e.clientY - rect.top - STATE.pan.y);
        }
    };

    window.onpointerup = (e) => {
        if (STATE.drag?.type === 'wire') {
            const target = e.target.closest('.port.in');
            if (target) {
                const toId = target.closest('.workspace-block').id;
                STATE.connections.push({ from: STATE.drag.from, fPort: STATE.drag.fPort, to: toId, tPort: target.dataset.port });
            }
            document.getElementById('temp-line')?.remove();
            drawAllLines();
        }
        STATE.drag = null;
    };

    function drawAllLines() {
        DOM.svg.innerHTML = '';
        STATE.connections.forEach(c => {
            const s = getPortPos(c.from, c.fPort, 'out');
            const e = getPortPos(c.to, c.tPort, 'in');
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('d', `M ${s.x} ${s.y} C ${s.x + 50} ${s.y}, ${e.x - 50} ${e.y}, ${e.x} ${e.y}`);
            p.setAttribute('stroke', '#777');
            p.setAttribute('fill', 'none');
            p.setAttribute('stroke-width', '2');
            DOM.svg.appendChild(p);
        });
    }

    // Initialize
    buildPalette();
    reg('event.start', 'On Start', 'Events', {}, ['exec'], 'event');
    const startId = uid();
    STATE.blocks[startId] = { id: startId, type: 'event.start', x: 100, y: 100, inputs: {} };
    renderBlock(startId);

})();