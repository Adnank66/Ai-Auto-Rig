(function(){
  // Performance module: uses components.json to estimate FPS and productivity
  // Adds presets (resolution/quality) and dynamic game listing
  const PRESETS = {
    '1080p-low': { label: '1080p Low', mul: 1.15 },
    '1080p-medium': { label: '1080p Medium', mul: 1.00 },
    '1080p-high': { label: '1080p High', mul: 0.85 },
    '1440p-high': { label: '1440p High', mul: 0.70 },
    '4k-ultra': { label: '4K Ultra', mul: 0.50 }
  };
  let state = {
    preset: localStorage.getItem('perfPreset') || '1080p-medium',
    gamesMode: localStorage.getItem('perfGamesMode') || 'top3', // 'top3' | 'all'
  };

  let compsData = null; // { byId, byCategory }

  async function loadDB(){
    if (compsData) return compsData;
    async function fromJson(){
      const res = await fetch('/components.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('no json');
      const data = await res.json();
      const byId = new Map();
      const byCategory = new Map();
      (Array.isArray(data) ? data : (data.components||[])).forEach(c => {
        byId.set(Number(c.id||c.ID||c.Id), c);
        const cat = c.category || c.category_name || c.type || 'Unknown';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(c);
      });
      return { byId, byCategory };
    }
    async function fromApi(){
      const res = await fetch('/api/components', { cache: 'no-store' });
      if (!res.ok) throw new Error('no api');
      const data = await res.json();
      const byId = new Map();
      const byCategory = new Map();
      (Array.isArray(data) ? data : []).forEach(c => {
        const id = Number(c.id);
        const cat = c.category_name || c.category || 'Unknown';
        const item = {
          id,
          name: c.name,
          category: cat,
          category_name: cat,
          price: Number(c.price)||0,
          specs: c.specs || {},
          performance: c.performance || {},
        };
        byId.set(id, item);
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(item);
      });
      // Hydrate performance heuristics if missing
      hydratePerformance(byCategory);
      return { byId, byCategory };
    }
    try {
      compsData = await fromJson();
    } catch {
      try {
        compsData = await fromApi();
      } catch {
        compsData = { byId:new Map(), byCategory:new Map() };
      }
    }
    return compsData;
  }

  function hydratePerformance(byCategory){
    const cpus = byCategory.get('CPU') || byCategory.get('Cpu') || byCategory.get('Processor') || [];
    const gpus = byCategory.get('GPU') || byCategory.get('Graphics Card') || byCategory.get('Gpu') || [];
    const cpuPrices = cpus.map(c=>Number(c.price)||0);
    const gpuPrices = gpus.map(g=>Number(g.price)||0);
    const cpuMin = Math.min(...cpuPrices, 1), cpuMax = Math.max(...cpuPrices, 1);
    const gpuMin = Math.min(...gpuPrices, 1), gpuMax = Math.max(...gpuPrices, 1);
    function norm(v,min,max){ return max>min ? (v-min)/(max-min) : 0.5; }
    // CPU: set cpuBoundFactor and productivity if missing
    for (const c of cpus){
      const n = norm(Number(c.price)||0, cpuMin, cpuMax);
      if (!c.performance) c.performance = {};
      if (c.performance.cpuBoundFactor == null) c.performance.cpuBoundFactor = Math.round((0.7 + n*0.3)*100)/100; // 0.7..1.0
      if (c.performance.productivity == null) c.performance.productivity = Math.round(100 + n*300); // 100..400
      if (c.performance.index == null) c.performance.index = c.performance.productivity;
    }
    // GPU: set fps table if missing
    for (const g of gpus){
      const n = norm(Number(g.price)||0, gpuMin, gpuMax);
      if (!g.performance) g.performance = {};
      if (!g.performance.fps){
        g.performance.fps = {
          'Valorant': Math.round(60 + n*120),   // 60..180
          'GTA V': Math.round(45 + n*75),       // 45..120
          'Cyberpunk 2077': Math.round(30 + n*60) // 30..90
        };
      }
      if (g.performance.index == null) g.performance.index = Math.round(100 + n*300);
    }
  }

  function safeNum(x, def=null){ const n = Number(x); return Number.isFinite(n)?n:def; }

  function pickGames(gpu){
    const gperf = (gpu && gpu.performance && gpu.performance.fps) || {};
    const keys = Object.keys(gperf);
    if (!keys.length) return [];
    if (state.gamesMode === 'all') return keys.slice(0, 10);
    // top3 by baseline fps
    return keys.sort((a,b) => safeNum(gperf[b],0)-safeNum(gperf[a],0)).slice(0,3);
  }

  function estimateFPS(cpu, gpu, mul, games){
    const out = {};
    const gperf = (gpu && gpu.performance && gpu.performance.fps) || {};
    const cpuLimit = safeNum(cpu && cpu.performance && cpu.performance.cpuBoundFactor, 1.0); // 0..1
    for (const game of games){
      const base = safeNum(gperf[game], null);
      out[game] = base != null ? Math.max(1, Math.round(base * Math.min(1, cpuLimit) * mul)) : null;
    }
    return out;
  }

  function extractProductivity(cpu){
    return safeNum(cpu && cpu.performance && (cpu.performance.productivity || cpu.performance.cinebench || cpu.performance.score), null);
  }

  function ensureControls(el){
    let ctrl = document.getElementById('perf-controls');
    if (!ctrl){
      ctrl = document.createElement('div');
      ctrl.id = 'perf-controls';
      ctrl.className = 'row';
      el.prepend(ctrl);
    }
    ctrl.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <label>Preset:
          <select id="perf-preset">
            ${Object.entries(PRESETS).map(([k,v])=>`<option value="${k}" ${state.preset===k?'selected':''}>${v.label}</option>`).join('')}
          </select>
        </label>
        <label>Games:
          <select id="perf-games-mode">
            <option value="top3" ${state.gamesMode==='top3'?'selected':''}>Top 3</option>
            <option value="all" ${state.gamesMode==='all'?'selected':''}>All available</option>
          </select>
        </label>
      </div>
    `;
    const presetSel = ctrl.querySelector('#perf-preset');
    const modeSel = ctrl.querySelector('#perf-games-mode');
    presetSel.onchange = ()=>{ state.preset = presetSel.value; localStorage.setItem('perfPreset', state.preset); triggerRefresh(); };
    modeSel.onchange = ()=>{ state.gamesMode = modeSel.value; localStorage.setItem('perfGamesMode', state.gamesMode); triggerRefresh(); };
  }

  function render(results){
    const el = document.getElementById('performance-results');
    if (!el) return;
    ensureControls(el);
    const out = document.createElement('div');
    out.id = 'perf-output';
    if (!results || !results.gpu || !results.cpu){
      out.innerHTML = '<div class="muted">Select a CPU and GPU to see estimated FPS and productivity scores.</div>';
      el.querySelector('#perf-output')?.remove();
      el.appendChild(out);
      return;
    }
    const rows = [];
    rows.push('<div class="row head"><div>Game</div><div>Estimated FPS</div></div>');
    const games = Object.keys(results.fps);
    for (const g of games){
      const v = results.fps[g];
      rows.push(`<div class="row"><div>${g}</div><div>${v!=null?v:'N/A'}</div></div>`);
    }
    const prod = results.productivity != null ? `${results.productivity}` : 'N/A';

    out.innerHTML = `
      <div class="perf-table">${rows.join('')}</div>
      <div class="hint" style="margin-top:8px">CPU Productivity Score: ${prod} — Preset: ${PRESETS[state.preset].label}</div>
    `;
    el.querySelector('#perf-output')?.remove();
    el.appendChild(out);
  }

  async function updateFromSelection(budget){
    const db = await loadDB();
    const summary = document.getElementById('summary-list');
    if (!summary) return render(null);
    const items = Array.from(summary.querySelectorAll('.item')).map(div => div.textContent || '');
    let cpu = null, gpu = null;
    for (const [id, c] of db.byId){
      if (!cpu && /cpu/i.test(String(c.category||c.category_name||''))) {
        if (items.some(t => t.includes(c.name))) cpu = c;
      }
      if (!gpu && /(gpu|graphics)/i.test(String(c.category||c.category_name||''))) {
        if (items.some(t => t.includes(c.name))) gpu = c;
      }
    }
    if (!cpu || !gpu) return render(null);

    const mul = PRESETS[state.preset]?.mul || 1;
    const games = pickGames(gpu);
    const fps = estimateFPS(cpu, gpu, mul, games);
    const productivity = extractProductivity(cpu);
    render({ cpu, gpu, fps, productivity, budget });
  }

  function triggerRefresh(){
    const budgetEl = document.getElementById('budget');
    const budget = budgetEl ? Number(budgetEl.value) || null : null;
    window.dispatchEvent(new CustomEvent('pcbuilder:updated', { detail: { budget } }));
  }

  window.addEventListener('pcbuilder:updated', (e) => {
    updateFromSelection(e && e.detail && e.detail.budget || null);
  });
})();
