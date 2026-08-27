(function(){
  // Advisor: propose future upgrade path based on current build
  let compsData = null;
  async function loadDB(){
    if (compsData) return compsData;
    try {
      const res = await fetch('/components.json', { cache: 'no-store' });
      const data = await res.json();
      const byId = new Map();
      (Array.isArray(data) ? data : (data.components||[])).forEach(c => byId.set(Number(c.id||c.ID||c.Id), c));
      compsData = { byId };
      return compsData;
    } catch (e){ return { byId:new Map() }; }
  }

  function parseSelected(){
    const summary = document.getElementById('summary-list');
    if (!summary) return [];
    return Array.from(summary.querySelectorAll('.item')).map(div => (div.textContent||''));
  }

  function inferHints(selectedTexts){
    const txt = selectedTexts.join('\n').toLowerCase();
    // Assemble hint items with categories
    const items = [];
    // RAM
    let ramHint = null;
    if (/ram\b/i.test(selectedTexts.join(' '))){
      const m = selectedTexts.join(' ').match(/(\d+)\s?gb/i);
      const cap = m ? Number(m[1]) : null;
      if (!cap || cap < 16) ramHint = { cat: 'RAM', text:'Add more RAM (aim for 16–32 GB).' };
    } else {
      ramHint = { cat: 'RAM', text:'Add RAM for better multitasking.' };
    }
    if (ramHint) items.push(ramHint);
    // Storage
    if (/storage|ssd|hdd|nvme/i.test(txt)){
      if (!/nvme/i.test(txt)) items.push({ cat:'Storage', text:'Upgrade to an NVMe SSD for faster load times.' });
      if (!/(1tb|2000|2tb)/i.test(txt)) items.push({ cat:'Storage', text:'Increase storage capacity (target 1TB or more).' });
    } else {
      items.push({ cat:'Storage', text:'Add an NVMe SSD (1TB) for responsiveness.' });
    }
    // GPU
    items.push({ cat:'GPU', text:'Upgrade GPU for higher FPS in modern titles.' });
    // CPU
    items.push({ cat:'CPU', text:'Later, upgrade CPU to avoid bottlenecks.' });
    // PSU
    items.push({ cat:'PSU', text:'Ensure PSU wattage and quality for future GPU upgrades.' });

    // Order by upgrade profile
    const profile = localStorage.getItem('upgradeProfile') || 'gaming';
    function prio(cat){
      const maps = {
        gaming: { GPU:5, CPU:4, RAM:3, Storage:2, PSU:1, Case:0 },
        balanced: { GPU:4, CPU:4, RAM:3, Storage:2, PSU:1, Case:0 },
        workstation: { CPU:5, RAM:4, Storage:3, GPU:2, PSU:1, Case:0 },
      };
      const m = maps[profile] || maps.gaming; return m[cat]||0;
    }
    items.sort((a,b) => prio(b.cat)-prio(a.cat));
    return items.map(i=>i.text).slice(0,5);
  }

  function render(hints){
    const el = document.getElementById('upgrade-path');
    if (!el) return;
    if (!hints || !hints.length) {
      el.innerHTML = '<div class="muted">No advice available.</div>';
      return;
    }
    el.innerHTML = '<ul>' + hints.map(h => `<li>${h}</li>`).join('') + '</ul>';
  }

  window.addEventListener('pcbuilder:updated', async (e) => {
    await loadDB(); // not strictly needed, but keeps consistent
    const selectedTexts = parseSelected();
    const hints = inferHints(selectedTexts);
    render(hints);
  });
})();
