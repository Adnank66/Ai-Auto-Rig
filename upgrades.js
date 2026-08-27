(function(){
  // Upgrade suggestions based on components.json and current budget
  const MIN_DELTA = 2000; // ₹2,000 baseline threshold

  let compsData = null; // { byCategory: Map<string, array> }
  let config = {
    percent: Number(localStorage.getItem('upgradePercent')||'5') || 5, // % of budget
    absolute: Number(localStorage.getItem('upgradeAbsolute')||'0') || 0, // ₹
    sort: localStorage.getItem('upgradeSort') || 'value', // 'cost' | 'value' | 'performance'
    profile: localStorage.getItem('upgradeProfile') || 'gaming', // 'gaming' | 'balanced' | 'workstation'
  };

  async function loadDB(){
    if (compsData) return compsData;
    async function fromJson(){
      const res = await fetch('/components.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('no json');
      const data = await res.json();
      const byCategory = new Map();
      (Array.isArray(data) ? data : (data.components||[])).forEach(c => {
        const cat = c.category || c.category_name || c.type || 'Unknown';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(c);
      });
      for (const [k, arr] of byCategory){
        arr.sort((a,b) => Number(a.price||a.cost||0) - Number(b.price||b.cost||0));
      }
      return { byCategory };
    }
    async function fromApi(){
      const res = await fetch('/api/components', { cache: 'no-store' });
      if (!res.ok) throw new Error('no api');
      const data = await res.json();
      const byCategory = new Map();
      (Array.isArray(data) ? data : []).forEach(c => {
        const cat = c.category_name || c.category || 'Unknown';
        const item = {
          id: Number(c.id),
          name: c.name,
          category: cat,
          category_name: cat,
          price: Number(c.price)||0,
          performance: c.performance || {},
          specs: c.specs || {},
        };
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(item);
      });
      for (const [k, arr] of byCategory){
        arr.sort((a,b) => Number(a.price||0) - Number(b.price||0));
      }
      return { byCategory };
    }
    try {
      compsData = await fromJson();
    } catch {
      try { compsData = await fromApi(); }
      catch { compsData = { byCategory:new Map() }; }
    }
    return compsData;
  }

  function priceOf(x){ return Number(x && (x.price||x.cost||0)) || 0; }
  function perfOf(x){
    // Optional performance index: higher is better (fallback to price if absent)
    const p = x && x.performance && (x.performance.index||x.performance.score);
    return Number(p)||priceOf(x);
  }

  function buildSelectedMap(){
    const summary = document.getElementById('summary-list');
    const map = new Map();
    if (!summary) return map;
    Array.from(summary.querySelectorAll('.item')).forEach(div => {
      const parts = (div.textContent||'').split(' - ');
      if (parts.length >= 2){
        const cat = parts[0].trim();
        const namePrice = parts[1].trim();
        const name = namePrice.replace(/\s*₹[\d,\.]+.*/, '').trim();
        map.set(cat, name);
      }
    });
    return map;
  }

  function priorityFor(cat){
    const profiles = {
      gaming: { GPU:5, CPU:4, RAM:3, Storage:2, PSU:1, Case:0 },
      balanced: { GPU:4, CPU:4, RAM:3, Storage:2, PSU:1, Case:0 },
      workstation: { CPU:5, RAM:4, Storage:3, GPU:2, PSU:1, Case:0 },
    };
    const m = profiles[config.profile] || profiles.gaming;
    return m[cat] || 0;
  }

  function ensureSettings(){
    const el = document.getElementById('upgrades-section');
    if (!el) return;
    let bar = document.getElementById('upgrade-settings');
    if (!bar){
      bar = document.createElement('div');
      bar.id = 'upgrade-settings';
      bar.className = 'row';
      el.prepend(bar);
    }
    bar.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <label>Extra budget: <input id="upg-percent" type="number" min="1" max="50" step="1" value="${config.percent}"> %</label>
        <label>or ₹ <input id="upg-abs" type="number" min="0" step="500" value="${config.absolute}"></label>
        <label>Sort by:
          <select id="upg-sort">
            <option value="value" ${config.sort==='value'?'selected':''}>Value (perf/₹)</option>
            <option value="cost" ${config.sort==='cost'?'selected':''}>Lowest extra cost</option>
            <option value="performance" ${config.sort==='performance'?'selected':''}>Performance gain</option>
          </select>
        </label>
        <label>Profile:
          <select id="upg-profile">
            <option value="gaming" ${config.profile==='gaming'?'selected':''}>Gaming</option>
            <option value="balanced" ${config.profile==='balanced'?'selected':''}>Balanced</option>
            <option value="workstation" ${config.profile==='workstation'?'selected':''}>Workstation</option>
          </select>
        </label>
      </div>
    `;
    const pEl = bar.querySelector('#upg-percent');
    const aEl = bar.querySelector('#upg-abs');
    const sEl = bar.querySelector('#upg-sort');
    const profEl = bar.querySelector('#upg-profile');
    pEl.onchange = ()=>{ config.percent = Math.max(1, Math.min(50, Number(pEl.value)||5)); localStorage.setItem('upgradePercent', String(config.percent)); triggerRefresh(); };
    aEl.onchange = ()=>{ config.absolute = Math.max(0, Number(aEl.value)||0); localStorage.setItem('upgradeAbsolute', String(config.absolute)); triggerRefresh(); };
    sEl.onchange = ()=>{ config.sort = sEl.value; localStorage.setItem('upgradeSort', config.sort); triggerRefresh(); };
    profEl.onchange = ()=>{ config.profile = profEl.value; localStorage.setItem('upgradeProfile', config.profile); triggerRefresh(); };
  }

  function suggestUpgrades(byCategory, selectedMap, budget){
    const out = [];
    const threshold = Math.max(MIN_DELTA, (Number(budget)||0) * (config.percent/100), Number(config.absolute)||0);
    for (const [cat, arr] of byCategory){
      const chosenName = selectedMap.get(cat);
      if (!chosenName) continue;
      const idx = arr.findIndex(x => String(x.name).toLowerCase() === String(chosenName).toLowerCase());
      if (idx < 0) continue;
      const chosen = arr[idx];
      const better = arr.slice(idx+1).find(x => perfOf(x) > perfOf(chosen));
      if (!better) continue;
      const delta = priceOf(better) - priceOf(chosen);
      const perfDelta = perfOf(better) - perfOf(chosen);
      const value = perfDelta > 0 && delta > 0 ? (perfDelta / delta) : 0;
      if (delta > 0 && delta <= threshold){
        out.push({ category: cat, from: chosen.name, to: better.name, extra: delta, perfDelta, value, priority: priorityFor(cat) });
      }
    }
    // Sort according to config
    const sorters = {
      value: (a,b) => b.value - a.value || b.priority - a.priority || a.extra - b.extra,
      cost: (a,b) => a.extra - b.extra || b.priority - a.priority || b.perfDelta - a.perfDelta,
      performance: (a,b) => b.perfDelta - a.perfDelta || b.priority - a.priority || a.extra - b.extra,
    };
    out.sort(sorters[config.sort] || sorters.value);
    return out.slice(0, 5);
  }

  function render(list){
    const wrap = document.getElementById('upgrades-section');
    const el = document.getElementById('upgrade-suggestions');
    if (!wrap || !el) return;
    ensureSettings();
    if (!list || !list.length) {
      el.innerHTML = '<div class="muted">No nearby upgrades found. Increase budget slightly or adjust selections.</div>';
      return;
    }
    el.innerHTML = list.map(s => (
      `<div class=\"row\">For ₹${s.extra.toLocaleString('en-IN')} more you can upgrade <strong>${s.category}</strong> from <em>${s.from}</em> → <strong>${s.to}</strong> <span class=\"muted\">(Δperf: ${Math.round(s.perfDelta)}, value: ${(s.value||0).toFixed(3)})</span></div>`
    )).join('');
  }

  function triggerRefresh(){
    const budgetEl = document.getElementById('budget');
    const budget = budgetEl ? Number(budgetEl.value) || null : null;
    window.dispatchEvent(new CustomEvent('pcbuilder:updated', { detail: { budget } }));
  }

  window.addEventListener('pcbuilder:updated', async (e) => {
    const budget = e && e.detail && e.detail.budget || null;
    const db = await loadDB();
    const selected = buildSelectedMap();
    const suggestions = suggestUpgrades(db.byCategory, selected, budget);
    render(suggestions);
  });
})();
