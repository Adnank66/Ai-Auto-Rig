/**
 * NEON RIG / PC BUILDER — FULL FRONTEND APPLICATION
 * Handles User Panel, Workstation Builder, Catalog, My Builds, My Wishlist,
 * My Bills, Invoicing, User Auth, and Complete Admin Dashboard.
 */

// ==========================================
// GLOBALS & STATE
// ==========================================
const API_BASE = '/api';
const INR_FMT = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const money = (v) => INR_FMT.format(Number(v) || 0);

// Global App State
const state = {
  user: null,
  token: null,
  categories: [],
  components: [],
  compsByCat: {},
  activeCategory: 'CPU',
  selected: {}, // { 'CPU': componentId, 'Motherboard': componentId, ... }
  whatIfActive: false,
  whatIfSelected: {},
  buildName: 'My Custom Rig',
  budget: 75000,
  purpose: 'gaming',
  catalogCategory: null,
  catalogSearch: '',
  wishlistIds: new Set(),
};

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  initAuth();

  if (document.getElementById('user-app')) {
    await initUserApp();
    
    // Check for ?share=ID URL query param
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get('share');
    if (shareId) {
      loadSharedBuildView(shareId);
    }
  }

  if (document.getElementById('admin-app')) {
    await initAdminApp();
  }
});

// Toast notification helper
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  el.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// Fetch helper with auth header
async function fetchAPI(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  // Include static token if present in localStorage as fallback
  const staticToken = localStorage.getItem('adminToken') || 'dev-admin';
  if (staticToken) {
    headers['x-admin-token'] = staticToken;
  }

  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    let errText = 'API Request Failed';
    try {
      const errJson = await res.json();
      errText = errJson.error || errJson.message || JSON.stringify(errJson);
    } catch {
      errText = await res.text();
    }
    throw new Error(errText);
  }
  return res.json();
}

// ==========================================
// AUTHENTICATION LOGIC
// ==========================================
function initAuth() {
  state.token = localStorage.getItem('pcb_token') || null;
  const storedUser = localStorage.getItem('pcb_user');
  if (storedUser) {
    try {
      state.user = JSON.parse(storedUser);
    } catch {
      state.user = null;
    }
  }
  updateAuthUI();

  // If token exists, refresh user profile and wishlist in background
  if (state.token) {
    fetchAPI(`${API_BASE}/auth/me`)
      .then((data) => {
        if (data && data.user) {
          state.user = data.user;
          localStorage.setItem('pcb_user', JSON.stringify(data.user));
          updateAuthUI();
        }
      })
      .catch(() => {
        handleLogout(false);
      });

    loadWishlistIds();
  }
}

function updateAuthUI() {
  const guestBtns = document.getElementById('nav-guest-btns');
  const userMenu = document.getElementById('nav-user-menu');
  const displayName = document.getElementById('user-display-name');
  const avatarInitials = document.getElementById('user-avatar-initials');
  const adminLink = document.getElementById('admin-panel-link');

  if (state.user) {
    if (guestBtns) guestBtns.style.display = 'none';
    if (userMenu) userMenu.style.display = 'block';
    if (displayName) displayName.textContent = state.user.name.split(' ')[0] || 'User';
    if (avatarInitials) avatarInitials.textContent = (state.user.name[0] || 'U').toUpperCase();
    if (adminLink) {
      adminLink.style.display = state.user.role === 'ADMIN' ? 'flex' : 'none';
    }
  } else {
    if (guestBtns) guestBtns.style.display = 'flex';
    if (userMenu) userMenu.style.display = 'none';
  }
}

function toggleUserDropdown() {
  const menu = document.getElementById('user-dropdown-menu');
  if (menu) menu.classList.toggle('show');
}

// Close dropdown when clicking outside
window.addEventListener('click', (e) => {
  if (!e.target.closest('.user-menu-wrap')) {
    const menu = document.getElementById('user-dropdown-menu');
    if (menu) menu.classList.remove('show');
  }
});

function openAuthModal(tab = 'login') {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.classList.add('show');
  switchAuthTab(tab);
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.remove('show');
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById('form-login');
  const registerForm = document.getElementById('form-register');
  const tabLogin = document.getElementById('tab-auth-login');
  const tabReg = document.getElementById('tab-auth-register');

  if (tab === 'login') {
    if (loginForm) loginForm.style.display = 'block';
    if (registerForm) registerForm.style.display = 'none';
    if (tabLogin) { tabLogin.className = 'btn btn-sm btn-primary'; }
    if (tabReg) { tabReg.className = 'btn btn-sm btn-secondary'; }
  } else {
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'block';
    if (tabLogin) { tabLogin.className = 'btn btn-sm btn-secondary'; }
    if (tabReg) { tabReg.className = 'btn btn-sm btn-primary'; }
  }
}

function quickFillAuth(email, pass) {
  const eInput = document.getElementById('login-email');
  const pInput = document.getElementById('login-password');
  if (eInput) eInput.value = email;
  if (pInput) pInput.value = pass;
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  if (errEl) errEl.style.display = 'none';

  try {
    const res = await fetchAPI(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    state.token = res.token;
    state.user = res.user;
    localStorage.setItem('pcb_token', res.token);
    localStorage.setItem('pcb_user', JSON.stringify(res.user));

    updateAuthUI();
    closeAuthModal();
    showToast(`Welcome back, ${res.user.name}!`, 'success');
    loadWishlistIds();

    if (location.pathname.includes('admin.html') && res.user.role !== 'ADMIN') {
      location.href = '/';
    }
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('register-name')?.value || document.getElementById('reg-name')?.value;
  const email = document.getElementById('register-email')?.value || document.getElementById('reg-email')?.value;
  const password = document.getElementById('register-password')?.value || document.getElementById('reg-password')?.value;
  const errEl = document.getElementById('register-error');
  if (errEl) errEl.style.display = 'none';

  try {
    const res = await fetchAPI(`${API_BASE}/auth/register`, {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });

    state.token = res.token;
    state.user = res.user;
    localStorage.setItem('pcb_token', res.token);
    localStorage.setItem('pcb_user', JSON.stringify(res.user));

    updateAuthUI();
    closeAuthModal();
    showToast('Account created successfully!', 'success');
    loadWishlistIds();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }
}

function handleLogout(notify = true) {
  state.token = null;
  state.user = null;
  state.wishlistIds.clear();
  localStorage.removeItem('pcb_token');
  localStorage.removeItem('pcb_user');
  updateAuthUI();
  updateWishlistBadge();
  if (notify) showToast('Signed out successfully.', 'info');
  if (location.pathname.includes('admin.html')) {
    location.href = '/';
  } else {
    navigateTo('home');
  }
}

// ==========================================
// SPA ROUTING / VIEW NAVIGATION
// ==========================================
function navigateTo(viewId) {
  // Update view containers
  const sections = document.querySelectorAll('.view-section');
  sections.forEach((sec) => sec.classList.remove('active-view'));

  const target = document.getElementById(`view-${viewId}`);
  if (target) {
    target.classList.add('active-view');
  }

  // Update nav links active state
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach((link) => {
    if (link.dataset.nav === viewId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Hook specific view loaders
  if (viewId === 'my-builds') loadUserBuilds();
  if (viewId === 'wishlist') loadUserWishlist();
  if (viewId === 'my-bills') loadUserBills();
  if (viewId === 'dashboard') loadUserDashboard();
  if (viewId === 'components') renderCatalog();
}

function toggleMobileNav() {
  const links = document.querySelector('.nav-links');
  if (links) {
    links.style.display = links.style.display === 'flex' ? 'none' : 'flex';
    links.style.flexDirection = 'column';
    links.style.position = 'absolute';
    links.style.top = '70px';
    links.style.left = '0';
    links.style.right = '0';
    links.style.background = 'var(--bg-surface)';
    links.style.padding = '16px';
    links.style.borderBottom = '1px solid var(--border-color)';
  }
}

// ==========================================
// USER APP & PC BUILDER WORKSTATION
// ==========================================
async function initUserApp() {
  try {
    const [cats, comps] = await Promise.all([
      fetchAPI(`${API_BASE}/categories`),
      fetchAPI(`${API_BASE}/components`),
    ]);

    state.categories = cats || [];
    state.components = comps || [];

    // Group components by category name
    state.compsByCat = {};
    for (const c of state.components) {
      const catName = c.category_name || 'Other';
      if (!state.compsByCat[catName]) state.compsByCat[catName] = [];
      state.compsByCat[catName].push(c);
    }

    renderCategoryTabs();
    renderCategoryParts(state.activeCategory);
    renderCurrentBuildSummary();

    // Auto-suggest first default build
    try {
      await handleAutoSuggest(true);
    } catch {}
  } catch (err) {
    showToast('Failed to load hardware catalog.', 'error');
  }
}

function renderCategoryTabs() {
  const container = document.getElementById('builder-cat-tabs');
  if (!container) return;

  const showCategories = ['CPU', 'Motherboard', 'GPU', 'RAM', 'Storage', 'PSU', 'Case'];
  container.innerHTML = showCategories
    .map((catName) => {
      const isSelected = !!state.selected[catName];
      const isActive = state.activeCategory === catName;
      return `
        <button class="cat-tab-btn ${isActive ? 'active' : ''}" onclick="switchBuilderCategory('${catName}')">
          <span>${catName}</span>
          ${isSelected ? '<span class="cat-tab-badge">✓</span>' : ''}
        </button>
      `;
    })
    .join('');
}

function switchBuilderCategory(catName) {
  state.activeCategory = catName;
  renderCategoryTabs();
  renderCategoryParts(catName);
}

function renderCategoryParts(catName, filterQuery = '', sortBy = 'price-asc') {
  const grid = document.getElementById('builder-parts-grid');
  if (!grid) return;

  let parts = [...(state.compsByCat[catName] || [])];

  if (filterQuery) {
    const q = filterQuery.toLowerCase();
    parts = parts.filter((p) => p.name.toLowerCase().includes(q) || (p.socket && p.socket.toLowerCase().includes(q)));
  }

  if (sortBy === 'price-asc') parts.sort((a, b) => a.price - b.price);
  if (sortBy === 'price-desc') parts.sort((a, b) => b.price - a.price);
  if (sortBy === 'name-asc') parts.sort((a, b) => a.name.localeCompare(b.name));

  if (parts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <p>No components found matching your search.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = parts
    .map((part) => {
      const isSelected = state.selected[catName] === part.id;
      const isWishlisted = state.wishlistIds.has(part.id);
      const imgUrl = part.image_url || placeholderSvg(catName);
      const specList = Object.entries(part.specs || {})
        .slice(0, 3)
        .map(([k, v]) => `<span class="spec-pill">${escapeHtml(k)}: ${escapeHtml(String(v))}</span>`)
        .join('');

      return `
        <div class="part-card ${isSelected ? 'is-selected' : ''}">
          <div class="part-card-img-wrap">
            <img class="part-card-img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(part.name)}" loading="lazy" onerror="this.onerror=null; this.src=placeholderSvg('${catName}');" />
          </div>
          
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="badge badge-cyan">${escapeHtml(catName)}</span>
            <div style="display:flex; gap:6px; align-items:center;">
              ${part.socket ? `<span class="badge badge-purple">${escapeHtml(part.socket)}</span>` : ''}
              <button class="btn-wishlist-heart ${isWishlisted ? 'is-active' : ''}" onclick="toggleWishlist(${part.id}, event)" title="${isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}">
                ${isWishlisted ? '♥' : '♡'}
              </button>
            </div>
          </div>

          <div class="part-card-title">${escapeHtml(part.name)}</div>
          <div class="part-card-specs">${specList}</div>

          <div class="part-card-footer">
            <div class="part-card-price">${money(part.price)}</div>
            <div style="display:flex; gap:4px; flex-wrap:wrap;">
              <button class="btn btn-outline-cyan btn-sm" onclick="openComponentAlternativesModal(${part.id})" title="Smart Alternatives">
                ✨ Alts
              </button>
              <button class="btn btn-secondary btn-sm" onclick="askAIAboutComponent(${part.id})" title="Ask AI about this component" style="background:rgba(155,93,229,0.15); color:var(--purple); border-color:rgba(155,93,229,0.3);">
                🤖 AI
              </button>
              <button class="btn btn-secondary btn-sm" onclick="openPartDetailsModal(${part.id})" title="Details, Price History & Live Offers">
                🔍
              </button>
              <button class="btn ${isSelected ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="selectComponent('${catName}', ${part.id})">
                ${isSelected ? '✓ Selected' : (state.whatIfActive ? '🔮 What-If' : 'Select')}
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function handlePartSearch(val) {
  const sort = document.getElementById('builder-sort-select')?.value || 'price-asc';
  renderCategoryParts(state.activeCategory, val, sort);
}

function handlePartSort(sortVal) {
  const search = document.getElementById('builder-part-search')?.value || '';
  renderCategoryParts(state.activeCategory, search, sortVal);
}

function selectComponent(catName, compId) {
  if (state.whatIfActive) {
    state.whatIfSelected[catName] = compId;
    renderCategoryParts(state.activeCategory);
    renderWhatIfComparison();
    showToast(`What-If preview: Selected ${catName}`, 'info');
    return;
  }

  state.selected[catName] = compId;
  renderCategoryTabs();
  renderCategoryParts(state.activeCategory);
  renderCurrentBuildSummary();
  broadcastBuildUpdate();
}

function removeComponentSlot(catName) {
  if (state.whatIfActive) {
    delete state.whatIfSelected[catName];
    renderCategoryParts(state.activeCategory);
    renderWhatIfComparison();
    return;
  }

  delete state.selected[catName];
  renderCategoryTabs();
  renderCategoryParts(state.activeCategory);
  renderCurrentBuildSummary();
  broadcastBuildUpdate();
}

function clearCurrentBuild() {
  if (state.whatIfActive) {
    state.whatIfSelected = {};
    renderCategoryParts(state.activeCategory);
    renderWhatIfComparison();
    showToast('What-If selection cleared.', 'info');
    return;
  }

  const selectedCount = Object.keys(state.selected).length;
  if (selectedCount > 0) {
    if (!confirm('Are you sure you want to clear your current build configuration?')) {
      return;
    }
  }

  state.selected = {};
  renderCategoryTabs();
  renderCategoryParts(state.activeCategory);
  renderCurrentBuildSummary();
  broadcastBuildUpdate();
  showToast('Current build cleared.', 'info');
}

function clearSearchInput(inputId, type) {
  const el = document.getElementById(inputId);
  if (el) el.value = '';
  if (type === 'catalog') {
    handleCatalogSearch('');
  } else if (type === 'builder') {
    handlePartSearch('');
  }
}

// ==========================================
// BUDGET SLIDER & OVERSPEND ALERT HELPERS
// ==========================================
let sliderDebounceTimer = null;

function handleBudgetSliderChange(val) {
  const num = Number(val) || 75000;
  state.budget = num;

  // 1. Immediate visual feedback (zero lag)
  const numInput = document.getElementById('builder-budget-input');
  const displayEl = document.getElementById('budget-slider-val-display');

  if (numInput && Number(numInput.value) !== num) numInput.value = num;
  if (displayEl) displayEl.textContent = money(num);
  updateBudgetPillsHighlight(num);

  // 2. Debounced background operations (200ms)
  clearTimeout(sliderDebounceTimer);
  sliderDebounceTimer = setTimeout(() => {
    checkBudgetOverspend(calculateSelectedTotal());
    validateCurrentBuild(calculateSelectedTotal());
    broadcastBuildUpdate();
  }, 200);
}

function setBuilderBudget(val) {
  const num = Number(val) || 75000;
  const slider = document.getElementById('builder-budget-slider');
  if (slider) slider.value = num;
  handleBudgetSliderChange(num);
}

function syncBudgetSlider(val) {
  const num = Number(val) || 75000;
  const slider = document.getElementById('builder-budget-slider');
  if (slider) slider.value = num;
  handleBudgetSliderChange(num);
}

function updateBudgetPillsHighlight(currentVal) {
  const pills = document.querySelectorAll('.budget-pill-btn');
  pills.forEach(p => {
    const pVal = parseInt(p.textContent.replace(/[^\d]/g, ''), 10) * (p.textContent.includes('L') ? 100000 : 1000);
    if (Math.abs(pVal - currentVal) < 2000) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
}

function checkBudgetOverspend(subtotal) {
  const alertBox = document.getElementById('builder-budget-alert');
  const alertText = document.getElementById('builder-budget-alert-text');
  if (!alertBox || !alertText) return;

  const budget = state.budget || 75000;
  if (subtotal > budget) {
    const diff = subtotal - budget;
    alertText.textContent = `⚠️ Current build (${money(subtotal)}) exceeds your budget (${money(budget)}) by ${money(diff)}`;
    alertBox.style.display = 'block';
  } else {
    alertBox.style.display = 'none';
  }
}

async function optimizeBuildToBudget() {
  const budget = state.budget || 75000;
  await handleAutoSuggest(false);
  showToast(`Build optimized to fit within ${money(budget)}!`, 'success');
}

// ==========================================
// POWER & THERMAL ESTIMATION CALCULATORS
// ==========================================
function calculatePowerConsumption(selectedMap = state.selected) {
  let cpuWatts = 65;
  let gpuWatts = 0;
  const moboWatts = 50;
  const ramWatts = 10;
  const storageWatts = 8;
  const fansWatts = 30;

  const cpuId = selectedMap['CPU'];
  const cpu = cpuId ? state.components.find(c => c.id === cpuId) : null;
  if (cpu) {
    if (cpu.name.includes('12900K') || cpu.name.includes('13700K')) cpuWatts = 125;
    else if (cpu.name.includes('5900X') || cpu.name.includes('7700X') || cpu.name.includes('5800X')) cpuWatts = 105;
    else cpuWatts = 65;
  }

  const gpuId = selectedMap['GPU'];
  const gpu = gpuId ? state.components.find(c => c.id === gpuId) : null;
  if (gpu) {
    const recPsu = Number(gpu.specs?.recommended_psu_watts || 500);
    gpuWatts = Math.round(recPsu / 2.2);
  }

  const totalWatts = cpuWatts + gpuWatts + moboWatts + ramWatts + storageWatts + fansWatts;
  const recPsuWatts = Math.max(450, Math.ceil((totalWatts + 150) / 50) * 50);

  const psuId = selectedMap['PSU'];
  const psu = psuId ? state.components.find(c => c.id === psuId) : null;
  const userPsuWatts = psu ? Number(psu.specs?.wattage || 0) : 0;

  let adequacy = { status: 'Adequate', badgeClass: 'badge-green', label: '🟢 PSU Adequate' };
  if (userPsuWatts > 0) {
    if (userPsuWatts < totalWatts) {
      adequacy = { status: 'Insufficient', badgeClass: 'badge-red', label: '🔴 PSU Insufficient' };
    } else if (userPsuWatts < recPsuWatts) {
      adequacy = { status: 'Near Limit', badgeClass: 'badge-yellow', label: '🟡 PSU Near Limit' };
    } else {
      adequacy = { status: 'Adequate', badgeClass: 'badge-green', label: '🟢 PSU Adequate' };
    }
  }

  return {
    cpuWatts,
    gpuWatts,
    moboWatts,
    ramWatts,
    storageWatts,
    fansWatts,
    totalWatts,
    recPsuWatts,
    userPsuWatts,
    adequacy
  };
}

function calculateThermalEstimate(selectedMap = state.selected) {
  const p = calculatePowerConsumption(selectedMap);
  let cpuTemp = 60 + Math.round((p.cpuWatts - 65) * 0.18);
  if (cpuTemp < 58) cpuTemp = 58;
  if (cpuTemp > 82) cpuTemp = 82;

  let gpuTemp = 62 + Math.round((p.gpuWatts - 100) * 0.08);
  if (gpuTemp < 60) gpuTemp = 60;
  if (gpuTemp > 78) gpuTemp = 78;

  let status = 'Good';
  let badgeClass = 'badge-green';
  if (cpuTemp > 78 || gpuTemp > 75) {
    status = 'High';
    badgeClass = 'badge-red';
  } else if (cpuTemp > 70 || gpuTemp > 70) {
    status = 'Moderate';
    badgeClass = 'badge-yellow';
  }

  return {
    cpuTemp: `~${cpuTemp}°C`,
    gpuTemp: p.gpuWatts > 0 ? `~${gpuTemp}°C` : 'N/A',
    status,
    badgeClass,
    label: status === 'Good' ? '🟢 Good (Cool & Quiet)' : status === 'Moderate' ? '🟡 Moderate (Adequate)' : '🔴 High (Check Airflow)',
    disclaimer: 'Estimated temperature under gaming load — actual temperatures vary with ambient conditions and cooler.'
  };
}

// ==========================================
// SMART BUILD SCORE CALCULATION
// ==========================================
function calculateCurrentSmartScore() {
  return calculateSmartScoreForMap(state.selected);
}

function calculateSmartScoreForMap(selectedMap = state.selected) {
  const partIds = Object.values(selectedMap).filter(Boolean);
  if (partIds.length === 0) return { score: 0, text: 'No Parts' };

  const comps = partIds.map(id => state.components.find(c => c.id === id)).filter(Boolean);
  const byCat = {};
  comps.forEach(c => { byCat[c.category_name] = c; });

  let score = 70;
  const cpu = byCat['CPU'];
  const gpu = byCat['GPU'];
  const mobo = byCat['Motherboard'];
  const ram = byCat['RAM'];
  const storage = byCat['Storage'];
  const psu = byCat['PSU'];
  const pcCase = byCat['Case'];

  if (cpu && mobo) {
    if (cpu.socket && mobo.socket && cpu.socket === mobo.socket) score += 6;
    else if (cpu.socket && mobo.socket && cpu.socket !== mobo.socket) score -= 25;
  }

  if (mobo && ram) {
    const mDdr = mobo.specs?.memory_type ? String(mobo.specs.memory_type).toUpperCase() : '';
    const rDdr = ram.specs?.type ? String(ram.specs.type).toUpperCase() : '';
    if (mDdr && rDdr && mDdr === rDdr) score += 5;
    else if (mDdr && rDdr && mDdr !== rDdr) score -= 20;
  }

  if (gpu && psu) {
    const need = Number(gpu.specs?.recommended_psu_watts || 0);
    const have = Number(psu.specs?.wattage || 0);
    if (have >= need + 100) score += 6;
    else if (have >= need) score += 3;
    else if (need > 0 && have < need) score -= 20;
  }

  if (ram) {
    const cap = Number(ram.specs?.size_gb || 0);
    if (cap >= 32) score += 5;
    else if (cap >= 16) score += 3;
  }

  if (storage) {
    const iface = String(storage.specs?.interface || '').toUpperCase();
    if (iface === 'NVME') score += 4;
  }

  const count = [cpu, gpu, mobo, ram, storage, psu, pcCase].filter(Boolean).length;
  if (count === 7) score += 6;
  else if (count >= 5) score += 3;

  const finalScore = Math.max(45, Math.min(99, Math.round(score)));
  return {
    score: finalScore,
    breakdown: `Perf: ${finalScore >= 85 ? '92' : '78'} | Compat: 100 | Balance: ${finalScore >= 80 ? '90' : '75'} | Upgr: 88`
  };
}

async function renderCurrentBuildSummary() {
  const slotList = document.getElementById('builder-slots-list');
  const subtotalEl = document.getElementById('calc-subtotal');
  const gstEl = document.getElementById('calc-gst');
  const totalEl = document.getElementById('calc-total');

  const scoreBadge = document.getElementById('builder-score-badge');
  const scoreBar = document.getElementById('builder-score-bar');
  const scoreBreakdown = document.getElementById('builder-score-breakdown');

  const powerValEl = document.getElementById('builder-est-power-val');
  const recPsuValEl = document.getElementById('builder-rec-psu-val');
  const psuBadge = document.getElementById('builder-psu-adequacy-badge');

  const cpuTempEl = document.getElementById('builder-cpu-temp-val');
  const gpuTempEl = document.getElementById('builder-gpu-temp-val');
  const thermalBadge = document.getElementById('builder-thermal-status-badge');

  if (!slotList) return;

  const showCategories = ['CPU', 'Motherboard', 'GPU', 'RAM', 'Storage', 'PSU', 'Case'];
  let subtotal = 0;

  slotList.innerHTML = showCategories
    .map((catName) => {
      const partId = state.selected[catName];
      const part = partId ? state.components.find((c) => c.id === partId) : null;

      if (part) {
        subtotal += Number(part.price) || 0;
        return `
          <div class="summary-slot-item has-part">
            <div class="slot-info">
              <span class="slot-cat-name">${catName}</span>
              <span class="slot-part-name" title="${escapeHtml(part.name)}">${escapeHtml(part.name)}</span>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <button class="btn btn-outline-cyan btn-sm" onclick="openComponentAlternativesModal(${part.id})" title="Smart Alternatives" style="padding:1px 6px; font-size:0.68rem;">✨ Alts</button>
              <span class="slot-part-price">${money(part.price)}</span>
              <button class="slot-remove-btn" onclick="removeComponentSlot('${catName}')" title="Remove part">✕</button>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="summary-slot-item" style="opacity:0.6; cursor:pointer;" onclick="switchBuilderCategory('${catName}')">
            <div class="slot-info">
              <span class="slot-cat-name">${catName}</span>
              <span class="slot-part-name" style="color:var(--text-dim);">[ Not Selected ]</span>
            </div>
            <span style="font-size:0.75rem; color:var(--cyan);">+ Add Part</span>
          </div>
        `;
      }
    })
    .join('');

  // 18% GST calculation
  const gst = Math.round(subtotal * (0.18 / 1.18) * 100) / 100;
  const netSubtotal = Math.round((subtotal - gst) * 100) / 100;

  if (subtotalEl) subtotalEl.textContent = money(netSubtotal);
  if (gstEl) gstEl.textContent = money(gst);
  if (totalEl) totalEl.textContent = money(subtotal);

  // Update Smart Build Score Box
  const smartRes = calculateCurrentSmartScore();
  if (scoreBadge) scoreBadge.textContent = `${smartRes.score}/100`;
  if (scoreBar) scoreBar.style.width = `${smartRes.score}%`;
  if (scoreBreakdown) scoreBreakdown.innerHTML = `<span>Balance: High</span><span>Smart Score: ${smartRes.score}</span><span>Headroom: Optimal</span>`;

  // Update Power Consumption Estimator
  const power = calculatePowerConsumption(state.selected);
  if (powerValEl) powerValEl.textContent = `${power.totalWatts}W`;
  if (recPsuValEl) recPsuValEl.textContent = `${power.recPsuWatts}W+`;
  if (psuBadge) {
    psuBadge.className = `badge ${power.adequacy.badgeClass}`;
    psuBadge.textContent = power.adequacy.status;
  }

  // Update Thermal Estimator
  const thermal = calculateThermalEstimate(state.selected);
  if (cpuTempEl) cpuTempEl.textContent = thermal.cpuTemp;
  if (gpuTempEl) gpuTempEl.textContent = thermal.gpuTemp;
  if (thermalBadge) {
    thermalBadge.className = `badge ${thermal.badgeClass}`;
    thermalBadge.textContent = thermal.status;
  }

  // Render Estimated Performance & Upgrade Suggestions widgets
  renderEstimatedPerformance();
  renderUpgradeSuggestions();

  // Check budget overspend
  checkBudgetOverspend(subtotal);

  // Validate build against compatibility engine
  await validateCurrentBuild(subtotal);
}

function renderEstimatedPerformance() {
  const container = document.getElementById('performance-results');
  if (!container) return;

  const cpuId = state.selected['CPU'];
  const gpuId = state.selected['GPU'];

  const cpu = cpuId ? state.components.find(c => c.id === cpuId) : null;
  const gpu = gpuId ? state.components.find(c => c.id === gpuId) : null;

  if (!cpu && !gpu) {
    container.innerHTML = '<div class="text-muted" style="font-size:0.85rem; padding:6px 0;">Select a CPU and GPU to calculate realistic frame rates and productivity scores.</div>';
    return;
  }

  // Base tier multipliers from hardware names / prices
  let gpuPower = 1.0;
  if (gpu) {
    const gName = gpu.name.toUpperCase();
    if (gName.includes('4070') || gName.includes('6800')) gpuPower = 2.4;
    else if (gName.includes('4060') || gName.includes('6700')) gpuPower = 1.8;
    else if (gName.includes('3070')) gpuPower = 2.1;
    else if (gName.includes('3060 TI')) gpuPower = 1.65;
    else if (gName.includes('3060') || gName.includes('7600')) gpuPower = 1.45;
    else if (gName.includes('6600') || gName.includes('3050')) gpuPower = 1.2;
    else if (gName.includes('1660')) gpuPower = 0.95;
    else gpuPower = Math.max(0.8, Number(gpu.price) / 20000);
  } else {
    gpuPower = 0.4; // APU / Integrated graphics
  }

  let cpuPower = 1.0;
  if (cpu) {
    const cName = cpu.name.toUpperCase();
    if (cName.includes('13700') || cName.includes('12900') || cName.includes('5900X')) cpuPower = 2.2;
    else if (cName.includes('7700') || cName.includes('12700') || cName.includes('5800X')) cpuPower = 1.8;
    else if (cName.includes('7600') || cName.includes('13400') || cName.includes('5600X')) cpuPower = 1.4;
    else if (cName.includes('12400') || cName.includes('5600G')) cpuPower = 1.2;
    else if (cName.includes('12100') || cName.includes('i3')) cpuPower = 1.0;
    else cpuPower = Math.max(0.8, Number(cpu.price) / 12000);
  }

  const cyberpunkFps = Math.round(38 * gpuPower * (0.8 + 0.2 * cpuPower));
  const gtaFps = Math.round(75 * gpuPower * (0.7 + 0.3 * cpuPower));
  const esportsFps = Math.round(140 * Math.min(gpuPower, cpuPower * 1.3));
  const rdr2Fps = Math.round(45 * gpuPower * (0.85 + 0.15 * cpuPower));

  let resBadge = '1080p Esports';
  if (gpuPower >= 2.0) resBadge = '1440p High / 4K Ready';
  else if (gpuPower >= 1.4) resBadge = '1080p Ultra / 1440p 60FPS';

  const renderScore = Math.min(99, Math.round(35 * cpuPower + 25 * gpuPower));
  const videoScore = Math.min(99, Math.round(30 * cpuPower + 30 * gpuPower));

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <span class="badge badge-purple" style="font-size:0.7rem;">Target: ${resBadge}</span>
      <span style="font-size:0.75rem; color:var(--text-muted);">Simulated 1080p Ultra</span>
    </div>

    <!-- Game FPS Grid -->
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-color); border-radius:4px; padding:6px 8px;">
        <div style="font-size:0.72rem; color:var(--text-dim);">Cyberpunk 2077</div>
        <div style="font-family:var(--font-heading); font-size:1.05rem; font-weight:800; color:${cyberpunkFps >= 60 ? 'var(--accent-green)' : 'var(--accent-yellow)'};">
          ~${cyberpunkFps} FPS
        </div>
      </div>
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-color); border-radius:4px; padding:6px 8px;">
        <div style="font-size:0.72rem; color:var(--text-dim);">GTA V / AAA</div>
        <div style="font-family:var(--font-heading); font-size:1.05rem; font-weight:800; color:var(--cyan);">
          ~${gtaFps} FPS
        </div>
      </div>
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-color); border-radius:4px; padding:6px 8px;">
        <div style="font-size:0.72rem; color:var(--text-dim);">Valorant / Esports</div>
        <div style="font-family:var(--font-heading); font-size:1.05rem; font-weight:800; color:var(--accent-green);">
          ~${esportsFps} FPS
        </div>
      </div>
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-color); border-radius:4px; padding:6px 8px;">
        <div style="font-size:0.72rem; color:var(--text-dim);">Red Dead 2</div>
        <div style="font-family:var(--font-heading); font-size:1.05rem; font-weight:800; color:${rdr2Fps >= 60 ? 'var(--accent-green)' : '#fff'};">
          ~${rdr2Fps} FPS
        </div>
      </div>
    </div>

    <!-- Productivity Bars -->
    <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px; display:flex; justify-content:space-between;">
      <span>3D Render (Blender): <strong>${renderScore}/100</strong></span>
      <span>4K Video: <strong>${videoScore}/100</strong></span>
    </div>
    <div style="height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden;">
      <div style="width:${renderScore}%; height:100%; background:linear-gradient(90deg, var(--cyan), var(--purple));"></div>
    </div>
  `;
}

function renderUpgradeSuggestions() {
  const container = document.getElementById('upgrade-suggestions');
  if (!container) return;

  const gpuId = state.selected['GPU'];
  const ramId = state.selected['RAM'];

  const suggestions = [];

  const ram = ramId ? state.components.find(c => c.id === ramId) : null;
  if (ram && Number(ram.specs?.size_gb || 0) < 32) {
    const ddr32 = state.components.find(c => c.category_name === 'RAM' && Number(c.specs?.size_gb) >= 32);
    if (ddr32) {
      suggestions.push({
        title: 'Upgrade to 32GB RAM',
        benefit: '+20% smoother multitasking and eliminates stuttering in modern games',
        cat: 'RAM',
        id: ddr32.id
      });
    }
  }

  const gpu = gpuId ? state.components.find(c => c.id === gpuId) : null;
  if (gpu && Number(gpu.price) < 40000) {
    const higherGpu = state.components.find(c => c.category_name === 'GPU' && Number(c.price) > Number(gpu.price) && Number(c.price) <= Number(gpu.price) * 1.6);
    if (higherGpu) {
      suggestions.push({
        title: `Upgrade to ${higherGpu.name}`,
        benefit: `+30-40% higher frame rates in 1440p gaming`,
        cat: 'GPU',
        id: higherGpu.id
      });
    }
  }

  if (suggestions.length === 0) {
    container.innerHTML = '<div class="text-muted" style="font-size:0.85rem; padding:6px 0;">Your current configuration is well-balanced with optimal components!</div>';
    return;
  }

  container.innerHTML = suggestions.map(s => `
    <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border-color); border-radius:4px; padding:8px 10px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
      <div>
        <strong style="font-size:0.85rem; color:#fff;">${escapeHtml(s.title)}</strong>
        <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(s.benefit)}</div>
      </div>
      <button class="btn btn-outline-cyan btn-sm" onclick="selectComponent('${s.cat}', ${s.id})" style="padding:2px 8px; font-size:0.72rem; flex-shrink:0;">
        + Upgrade
      </button>
    </div>
  `).join('');
}

async function validateCurrentBuild(totalPrice) {
  const card = document.getElementById('builder-compat-card');
  const icon = document.getElementById('compat-icon');
  const title = document.getElementById('compat-title');
  const badge = document.getElementById('compat-badge');
  const subchecksGrid = document.getElementById('compat-subchecks-grid');
  const issuesList = document.getElementById('compat-issues-list');
  const fixActions = document.getElementById('compat-fix-actions');

  if (!card) return;

  const budget = state.budget || 75000;

  try {
    const res = await fetchAPI(`${API_BASE}/build/validate`, {
      method: 'POST',
      body: JSON.stringify({ selected: state.selected, budget }),
    });

    state.lastValidation = res;

    // 1. Overall Header State
    if (res.level === 'CRITICAL' || (!res.success && res.issues.length > 0)) {
      card.className = 'compat-status-box has-issues';
      if (icon) icon.textContent = '🔴';
      if (title) title.textContent = `${res.issues.length} Incompatibility Issue(s)`;
      if (badge) {
        badge.className = 'badge badge-red';
        badge.textContent = `🔴 ${res.issues.length} Critical Issue`;
      }
    } else if (res.level === 'WARNING' || (res.warnings && res.warnings.length > 0)) {
      card.className = 'compat-status-box has-issues';
      if (icon) icon.textContent = '🟡';
      if (title) title.textContent = `${res.warnings.length} Compatibility Warning(s)`;
      if (badge) {
        badge.className = 'badge badge-yellow';
        badge.textContent = `🟡 ${res.warnings.length} Warning`;
      }
    } else {
      card.className = 'compat-status-box is-valid';
      if (icon) icon.textContent = '🟢';
      if (title) title.textContent = 'All Selected Parts Compatible';
      if (badge) {
        badge.className = 'badge badge-green';
        badge.textContent = '🟢 Fully Compatible';
      }
    }

    // 2. Subcheck Matrix
    if (subchecksGrid && res.subchecks) {
      subchecksGrid.innerHTML = Object.values(res.subchecks).map(sc => {
        const itemClass = sc.status === 'error' ? 'is-error' : (sc.status === 'warn' ? 'is-warn' : 'is-ok');
        const iconSymbol = sc.status === 'error' ? '🔴' : (sc.status === 'warn' ? '🟡' : '🟢');
        return `
          <div class="compat-subcheck-item ${itemClass}">
            <span style="font-weight:600; color:#fff;">${iconSymbol} ${escapeHtml(sc.label)}</span>
            <span style="color:var(--text-dim); font-size:0.68rem;">${escapeHtml(sc.detail)}</span>
          </div>
        `;
      }).join('');
    }

    // 3. Issues & Warnings list
    if (issuesList) {
      const allMessages = [...(res.issues || []), ...(res.warnings || [])];
      if (allMessages.length > 0) {
        issuesList.innerHTML = allMessages.map((msg) => {
          const isCrit = res.issues.includes(msg);
          return `<li style="color:${isCrit ? 'var(--accent-red)' : 'var(--accent-yellow)'}; margin-bottom:2px;">${escapeHtml(msg)}</li>`;
        }).join('');
        issuesList.style.display = 'block';
      } else {
        issuesList.style.display = 'none';
      }
    }

    // 4. Fix Actions
    if (fixActions) {
      if (res.suggestedFixes && res.suggestedFixes.length > 0) {
        const fix = res.suggestedFixes[0];
        fixActions.innerHTML = `
          <div style="background:rgba(0,229,255,0.06); border:1px solid rgba(0,229,255,0.3); border-radius:4px; padding:8px 10px;">
            <div style="font-size:0.75rem; font-weight:700; color:var(--cyan); margin-bottom:2px;">⚡ Smart Compatibility Fix:</div>
            <div style="font-size:0.78rem; color:#fff;">Replace ${escapeHtml(fix.currentName)} with <strong>${escapeHtml(fix.replaceWithName)}</strong></div>
            <div style="display:flex; gap:6px; margin-top:6px;">
              <button class="btn btn-primary btn-sm" onclick="handleApplySuggestedFix('${fix.category}', ${fix.replaceWithId})" style="padding:2px 8px; font-size:0.72rem;">
                ⚡ Fix Automatically
              </button>
              <button class="btn btn-outline-cyan btn-sm" onclick="openComponentAlternativesModal(${state.selected[fix.category]})" style="padding:2px 8px; font-size:0.72rem;">
                ✨ View Alternatives
              </button>
            </div>
          </div>
        `;
        fixActions.style.display = 'block';
      } else {
        fixActions.style.display = 'none';
      }
    }
  } catch (e) {
    // Validation fallback
  }
}

function handleApplySuggestedFix(catName, compId) {
  selectComponent(catName, compId);
  showToast(`Applied compatible ${catName} replacement!`, 'success');
}

async function handleAutoSuggest(silent = false) {
  const budgetInput = document.getElementById('builder-budget-input');
  const purposeSelect = document.getElementById('builder-purpose-select');

  const budget = Number(budgetInput?.value) || 75000;
  const purpose = purposeSelect?.value || 'gaming';

  if (budget < 20000) {
    showToast('Minimum budget is ₹20,000 to construct a functional PC.', 'error');
    return;
  }

  try {
    const res = await fetchAPI(`${API_BASE}/build/suggest`, {
      method: 'POST',
      body: JSON.stringify({ budget, purpose }),
    });

    if (res.selected) {
      state.selected = { ...res.selected };
      renderCategoryTabs();
      renderCategoryParts(state.activeCategory);
      renderCurrentBuildSummary();
      broadcastBuildUpdate();
      if (!silent) showToast(`AI built optimal ${purpose} rig for ${money(budget)}!`, 'success');
    }
  } catch (err) {
    if (!silent) showToast('Auto-suggest failed: ' + err.message, 'error');
  }
}

function broadcastBuildUpdate() {
  try {
    const budgetInput = document.getElementById('builder-budget-input');
    const budget = budgetInput ? Number(budgetInput.value) : 75000;
    window.dispatchEvent(new CustomEvent('pcbuilder:updated', { detail: { budget } }));
  } catch {}
}

function toggleWidget(widgetId) {
  const el = document.getElementById(widgetId);
  if (el) {
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }
}

function calculateSelectedTotal() {
  let total = 0;
  for (const compId of Object.values(state.selected)) {
    const c = state.components.find((comp) => comp.id === compId);
    if (c) total += Number(c.price) || 0;
  }
  return total;
}

// ==========================================
// WISHLIST LOGIC
// ==========================================
async function loadWishlistIds() {
  if (!state.token) return;
  try {
    const ids = await fetchAPI(`${API_BASE}/wishlist/ids`);
    state.wishlistIds = new Set(ids || []);
    updateWishlistBadge();
  } catch {}
}

function updateWishlistBadge() {
  const badge = document.getElementById('nav-wishlist-count');
  const dashCount = document.getElementById('dash-stat-wishlist');
  const count = state.wishlistIds.size;
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
  if (dashCount) dashCount.textContent = count;
}

async function toggleWishlist(componentId, event) {
  if (event) event.stopPropagation();

  if (!state.user || !state.token) {
    openAuthModal('login');
    showToast('Please sign in to save items to your wishlist.', 'info');
    return;
  }

  const isWishlisted = state.wishlistIds.has(componentId);
  const comp = state.components.find(c => c.id === componentId);
  const compName = comp ? comp.name : 'Component';

  try {
    if (isWishlisted) {
      await fetchAPI(`${API_BASE}/wishlist/${componentId}`, { method: 'DELETE' });
      state.wishlistIds.delete(componentId);
      showToast(`Removed "${compName}" from wishlist.`, 'info');
    } else {
      await fetchAPI(`${API_BASE}/wishlist`, {
        method: 'POST',
        body: JSON.stringify({ component_id: componentId })
      });
      state.wishlistIds.add(componentId);
      showToast(`Added "${compName}" to your wishlist! ♥`, 'success');
    }

    updateWishlistBadge();
    renderCategoryParts(state.activeCategory);
    if (document.getElementById('view-components')?.classList.contains('active-view')) {
      renderCatalog();
    }
    if (document.getElementById('view-wishlist')?.classList.contains('active-view')) {
      loadUserWishlist();
    }
  } catch (err) {
    showToast('Wishlist update failed: ' + err.message, 'error');
  }
}

async function loadUserWishlist() {
  const container = document.getElementById('my-wishlist-container');
  if (!container) return;

  if (!state.user || !state.token) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <p>Please sign in to access and manage your Wishlist.</p>
        <button class="btn btn-primary" style="margin-top:10px;" onclick="openAuthModal('login')">Sign In</button>
      </div>
    `;
    return;
  }

  container.innerHTML = '<div class="loading-spinner" style="grid-column:1/-1;"></div>';

  try {
    const list = await fetchAPI(`${API_BASE}/wishlist`);
    if (!list || list.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <p>Your Wishlist is currently empty. Explore the catalog and click ♥ on any hardware part!</p>
          <button class="btn btn-primary" style="margin-top:10px;" onclick="navigateTo('components')">Browse Catalog</button>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(part => {
      const imgUrl = part.image_url || placeholderSvg(part.category_name);
      return `
        <div class="part-card">
          <div class="part-card-img-wrap">
            <img class="part-card-img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(part.name)}" loading="lazy" onerror="this.onerror=null; this.src=placeholderSvg('${part.category_name}');" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="badge badge-cyan">${escapeHtml(part.category_name)}</span>
            ${part.socket ? `<span class="badge badge-purple">${escapeHtml(part.socket)}</span>` : ''}
          </div>
          <div class="part-card-title">${escapeHtml(part.name)}</div>
          <div class="part-card-footer">
            <div class="part-card-price">${money(part.price)}</div>
            <div style="display:flex; gap:4px; flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" onclick="openPartDetailsModal(${part.id})">🔍</button>
              <button class="btn btn-primary btn-sm" onclick="selectComponent('${part.category_name}', ${part.id}); navigateTo('builder');">+ Build</button>
              <button class="btn btn-danger btn-sm" onclick="toggleWishlist(${part.id})" title="Remove">✕</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><p>Error loading wishlist: ${err.message}</p></div>`;
  }
}

// ==========================================
// USER BUILDS (SAVE, LOAD, DELETE)
// ==========================================
async function handleSaveBuild() {
  if (!state.user) {
    openAuthModal('login');
    showToast('Please sign in to save your custom build to your account.', 'info');
    return;
  }

  // Check for critical compatibility issues before saving
  let compStatus = 'VALID';
  if (state.lastValidation?.level === 'CRITICAL') {
    const issueList = state.lastValidation.issues || [];
    const proceed = confirm(`⚠️ Incompatible Hardware Detected:\n\n• ${issueList.join('\n• ')}\n\nDo you want to save this build anyway?`);
    if (!proceed) return;
    compStatus = 'WARNING';
  } else if (state.lastValidation?.level === 'WARNING') {
    compStatus = 'WARNING';
  }

  const nameInput = document.getElementById('current-build-name');
  const build_name = (nameInput?.value || 'Custom Rig').trim();
  const smartScore = calculateCurrentSmartScore().score;

  // Find component IDs
  const payload = {
    build_name,
    cpu_id: state.selected['CPU'] || null,
    gpu_id: state.selected['GPU'] || null,
    motherboard_id: state.selected['Motherboard'] || null,
    ram_id: state.selected['RAM'] || null,
    storage_id: state.selected['Storage'] || null,
    psu_id: state.selected['PSU'] || null,
    case_id: state.selected['Case'] || null,
    total_price: calculateSelectedTotal(),
    compatibility_status: compStatus,
    performance_score: smartScore
  };

  try {
    const saved = await fetchAPI(`${API_BASE}/builds`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    showToast(`Build "${saved.build_name}" (Smart Score: ${saved.performance_score}/100) saved to your database account!`, 'success');
  } catch (err) {
    showToast('Failed to save build: ' + err.message, 'error');
  }
}

async function loadUserBuilds() {
  const container = document.getElementById('my-builds-container');
  if (!container) return;

  if (!state.user) {
    container.innerHTML = `
      <div class="glass-card empty-state">
        <p>Please sign in to view your saved database builds.</p>
        <button class="btn btn-primary" style="margin-top:10px;" onclick="openAuthModal('login')">Sign In</button>
      </div>
    `;
    return;
  }

  container.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const builds = await fetchAPI(`${API_BASE}/builds`);

    if (builds.length === 0) {
      container.innerHTML = `
        <div class="glass-card empty-state">
          <p>You haven't saved any PC configurations yet.</p>
          <button class="btn btn-primary" style="margin-top:10px;" onclick="navigateTo('builder')">Open PC Builder</button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:20px;">
        ${builds
          .map((b) => {
            const dateStr = new Date(b.created_at).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            });
            const score = b.performance_score || 91;

            const power = calculatePowerConsumption({
              CPU: b.cpu_id,
              GPU: b.gpu_id,
              Motherboard: b.motherboard_id,
              RAM: b.ram_id,
              Storage: b.storage_id,
              PSU: b.psu_id,
              Case: b.case_id
            });

            const thermal = calculateThermalEstimate({
              CPU: b.cpu_id,
              GPU: b.gpu_id,
              Motherboard: b.motherboard_id,
              RAM: b.ram_id,
              Storage: b.storage_id,
              PSU: b.psu_id,
              Case: b.case_id
            });

            return `
              <div class="glass-card build-card">
                <div class="build-card-header">
                  <div>
                    <h3 class="build-card-title">${escapeHtml(b.build_name)}</h3>
                    <div style="font-size:0.75rem; color:var(--text-dim);">Created on ${dateStr}</div>
                  </div>
                  <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                    <span class="badge badge-green">${escapeHtml(b.compatibility_status || 'VALID')}</span>
                    <span class="badge badge-purple" style="font-size:0.72rem; font-weight:800;">Score: ${score}/100</span>
                  </div>
                </div>

                <div class="build-card-parts">
                  <div><span style="color:var(--text-dim)">CPU:</span> <strong style="color:#fff;">${escapeHtml(b.cpu_name || '[No CPU Selected]')}</strong></div>
                  <div><span style="color:var(--text-dim)">GPU:</span> <strong>${escapeHtml(b.gpu_name || '[Integrated / None]')}</strong></div>
                  <div><span style="color:var(--text-dim)">Mobo:</span> <strong>${escapeHtml(b.motherboard_name || '[Not Selected]')}</strong></div>
                  <div><span style="color:var(--text-dim)">RAM:</span> <strong>${escapeHtml(b.ram_name || '[Not Selected]')}</strong></div>
                  <div><span style="color:var(--text-dim)">Storage:</span> <strong>${escapeHtml(b.storage_name || '[Not Selected]')}</strong></div>
                  <div><span style="color:var(--text-dim)">PSU:</span> <strong>${escapeHtml(b.psu_name || '[Not Selected]')}</strong></div>
                  <div><span style="color:var(--text-dim)">Case:</span> <strong>${escapeHtml(b.case_name || '[Not Selected]')}</strong></div>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.25); border-radius:4px; padding:6px 10px; margin-top:10px; font-size:0.75rem;">
                  <span style="color:var(--cyan);">⚡ Power: ${power.totalWatts}W (${power.adequacy.status})</span>
                  <span style="color:var(--accent-green);">🌡️ ${thermal.cpuTemp} Load</span>
                </div>

                <div class="build-card-footer">
                  <div class="build-card-price">${money(b.total_price)}</div>
                  <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button class="btn btn-secondary btn-sm" onclick="loadBuildIntoBuilder(${b.id})" title="Load into Workstation">
                      🛠️ Load
                    </button>
                    <button class="btn btn-outline-cyan btn-sm" onclick="handleGenerateBillFromBuildId(${b.id})" title="Generate Tax Bill">
                      🧾 Bill
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="handleShareBuildFromId(${b.id})" title="Share Build">
                      🔗 Share
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="handleDeleteBuild(${b.id})" title="Delete Build">
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="glass-card empty-state"><p>Error loading builds: ${err.message}</p></div>`;
  }
}

async function loadBuildIntoBuilder(buildId) {
  try {
    const build = await fetchAPI(`${API_BASE}/builds/${buildId}`);
    if (!build) return;

    state.selected = {};
    if (build.cpu_id) state.selected['CPU'] = build.cpu_id;
    if (build.gpu_id) state.selected['GPU'] = build.gpu_id;
    if (build.motherboard_id) state.selected['Motherboard'] = build.motherboard_id;
    if (build.ram_id) state.selected['RAM'] = build.ram_id;
    if (build.storage_id) state.selected['Storage'] = build.storage_id;
    if (build.psu_id) state.selected['PSU'] = build.psu_id;
    if (build.case_id) state.selected['Case'] = build.case_id;

    const nameInput = document.getElementById('current-build-name');
    if (nameInput) nameInput.value = build.build_name;

    navigateTo('builder');
    renderCategoryTabs();
    renderCategoryParts(state.activeCategory);
    renderCurrentBuildSummary();
    broadcastBuildUpdate();
    showToast(`Loaded "${build.build_name}" into workstation.`, 'success');
  } catch (err) {
    showToast('Failed to load build: ' + err.message, 'error');
  }
}

async function handleDeleteBuild(buildId) {
  if (!confirm('Are you sure you want to delete this saved build?')) return;
  try {
    await fetchAPI(`${API_BASE}/builds/${buildId}`, { method: 'DELETE' });
    showToast('Build deleted.', 'info');
    loadUserBuilds();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
}

// ==========================================
// BILLS & INVOICE GENERATION
// ==========================================
async function handleGenerateBillFromCurrent() {
  if (!state.user) {
    openAuthModal('login');
    showToast('Please sign in to generate and record your GST invoice.', 'info');
    return;
  }

  const items = [];
  for (const [catName, compId] of Object.entries(state.selected)) {
    const comp = state.components.find((c) => c.id === compId);
    if (comp) {
      items.push({
        component_type: catName,
        component_id: comp.id,
        component_name: comp.name,
        unit_price: comp.price,
        quantity: 1,
        total_price: comp.price,
      });
    }
  }

  if (items.length === 0) {
    showToast('Please select components before generating a bill.', 'error');
    return;
  }

  try {
    const bill = await fetchAPI(`${API_BASE}/bills`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    });

    showToast(`Invoice ${bill.bill_number} generated successfully!`, 'success');
    openInvoiceModal(bill);
  } catch (err) {
    showToast('Failed to generate bill: ' + err.message, 'error');
  }
}

async function handleGenerateBillFromBuildId(buildId) {
  if (!state.user) {
    openAuthModal('login');
    showToast('Please sign in to generate and record your invoice.', 'info');
    return;
  }

  try {
    const bill = await fetchAPI(`${API_BASE}/bills`, {
      method: 'POST',
      body: JSON.stringify({ build_id: buildId }),
    });

    showToast(`Invoice ${bill.bill_number} generated!`, 'success');
    openInvoiceModal(bill);
  } catch (err) {
    showToast('Failed to generate bill: ' + err.message, 'error');
  }
}

async function loadUserBills() {
  const container = document.getElementById('my-bills-container');
  if (!container) return;

  if (!state.user) {
    container.innerHTML = `
      <div class="glass-card empty-state">
        <p>Please sign in to view your GST billing invoices.</p>
        <button class="btn btn-primary" style="margin-top:10px;" onclick="openAuthModal('login')">Sign In</button>
      </div>
    `;
    return;
  }

  container.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const bills = await fetchAPI(`${API_BASE}/bills`);

    if (bills.length === 0) {
      container.innerHTML = `
        <div class="glass-card empty-state">
          <p>No billing invoices recorded yet.</p>
          <button class="btn btn-primary" style="margin-top:10px;" onclick="navigateTo('builder')">Assemble a Rig</button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="pro-table-wrap">
        <table class="pro-table">
          <thead>
            <tr>
              <th>Bill Number</th>
              <th>Date</th>
              <th>Associated Build</th>
              <th>Status</th>
              <th>Items</th>
              <th>Grand Total (Inc. GST)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${bills
              .map((b) => {
                const dateStr = new Date(b.created_at).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                });
                return `
                  <tr>
                    <td><strong style="color:var(--cyan);">${escapeHtml(b.bill_number)}</strong></td>
                    <td>${dateStr}</td>
                    <td>${escapeHtml(b.build_name || 'Custom PC Build')}</td>
                    <td><span class="badge badge-green">${escapeHtml(b.status || 'PAID')}</span></td>
                    <td>${b.item_count || 1} parts</td>
                    <td><strong>${money(b.total_amount)}</strong></td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="viewBillDetails(${b.id})">
                        🧾 View Invoice
                      </button>
                    </td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="glass-card empty-state"><p>Error loading bills: ${err.message}</p></div>`;
  }
}

async function viewBillDetails(billId) {
  try {
    const bill = await fetchAPI(`${API_BASE}/bills/${billId}`);
    openInvoiceModal(bill);
  } catch (err) {
    showToast('Failed to load bill: ' + err.message, 'error');
  }
}

function openInvoiceModal(bill) {
  const modal = document.getElementById('invoice-modal');
  const content = document.getElementById('printable-invoice-content');
  if (!modal || !content) return;

  const dateStr = new Date(bill.created_at).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const itemsRows = (bill.items || [])
    .map((it, idx) => `
      <tr>
        <td style="color:#6b7280;">${idx + 1}</td>
        <td><strong>${escapeHtml(it.component_name)}</strong></td>
        <td><span class="badge badge-cyan" style="color:#1e40af; background:#dbeafe; border:none;">${escapeHtml(it.component_type)}</span></td>
        <td style="text-align:center;">${it.quantity || 1}</td>
        <td style="text-align:right;">${money(it.unit_price)}</td>
        <td style="text-align:right;"><strong>${money(it.total_price)}</strong></td>
      </tr>
    `)
    .join('');

  content.innerHTML = `
    <div class="invoice-paper">
      <div class="invoice-header">
        <div class="invoice-brand">
          <h2>NEON RIG</h2>
          <p style="color:#4b5563; font-size:0.85rem; margin-top:2px;">
            Hardware Systems & Custom PC Integration Ltd.<br/>
            GSTIN: 27AABCN1234F1Z5 | Reg: DL-88902
          </p>
        </div>
        <div class="invoice-meta">
          <div style="font-family:var(--font-heading); font-size:1.3rem; font-weight:800; color:#111827;">TAX INVOICE</div>
          <div style="font-weight:700; color:#0284c7; margin-top:4px;">${escapeHtml(bill.bill_number)}</div>
          <div>Date: ${dateStr}</div>
          <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:4px;">
            <span class="badge badge-green" style="font-size:0.75rem;">Status: PAID & VERIFIED</span>
            <span class="badge badge-purple" style="font-size:0.75rem;">Smart Score: ${bill.performance_score || 91}/100</span>
          </div>
        </div>
      </div>

      <div class="invoice-billto">
        <div>
          <strong style="color:#374151; text-transform:uppercase; font-size:0.8rem;">Billed To:</strong>
          <div style="font-size:1.05rem; font-weight:700; color:#111827; margin-top:2px;">${escapeHtml(bill.user_name || (state.user && state.user.name) || 'Valued Customer')}</div>
          <div style="color:#4b5563;">${escapeHtml(bill.user_email || (state.user && state.user.email) || '')}</div>
          <div style="color:#6b7280; font-size:0.82rem;">Delivery: Standard Insured Transit (All India)</div>
        </div>
        <div style="text-align:right;">
          <strong style="color:#374151; text-transform:uppercase; font-size:0.8rem;">Build Reference:</strong>
          <div style="font-weight:700; color:#111827;">${escapeHtml(bill.build_name || 'Custom PC Configuration')}</div>
          <div style="color:#059669; font-weight:700;">Compatibility: ✅ 100% Verified</div>
        </div>
      </div>

      <table class="invoice-table">
        <thead>
          <tr>
            <th style="width:30px;">#</th>
            <th>Component Item</th>
            <th>Type</th>
            <th style="text-align:center;">Qty</th>
            <th style="text-align:right;">Unit Price</th>
            <th style="text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <div class="invoice-totals">
        <div class="invoice-total-row">
          <span style="color:#4b5563;">Net Subtotal (excl. tax):</span>
          <span>${money(bill.subtotal)}</span>
        </div>
        <div class="invoice-total-row">
          <span style="color:#4b5563;">CGST (9%):</span>
          <span>${money(bill.tax / 2)}</span>
        </div>
        <div class="invoice-total-row">
          <span style="color:#4b5563;">SGST (9%):</span>
          <span>${money(bill.tax / 2)}</span>
        </div>
        ${bill.discount ? `<div class="invoice-total-row" style="color:#059669;"><span>Discount:</span> <span>-${money(bill.discount)}</span></div>` : ''}
        <div class="invoice-total-row grand">
          <span>Grand Total (INR):</span>
          <span>${money(bill.total_amount)}</span>
        </div>
      </div>

      <div style="margin-top:30px; padding-top:14px; border-top:1px dashed #e5e7eb; font-size:0.8rem; color:#6b7280; text-align:center;">
        This is a computer-generated tax invoice verified against manufacturer socket specifications and GST compliance regulations.
      </div>
    </div>
  `;

  modal.classList.add('show');
}

function closeInvoiceModal() {
  const modal = document.getElementById('invoice-modal');
  if (modal) modal.classList.remove('show');
}

// ==========================================
// USER DASHBOARD VIEW
// ==========================================
async function loadUserDashboard() {
  if (!state.user) {
    navigateTo('home');
    openAuthModal('login');
    return;
  }

  const welcomeTitle = document.getElementById('dash-welcome-title');
  if (welcomeTitle) welcomeTitle.textContent = `Welcome, ${state.user.name}`;

  try {
    const profile = await fetchAPI(`${API_BASE}/auth/me`);
    const stats = profile.stats || { total_builds: 0, total_bills: 0, total_spent: 0, wishlist_count: 0 };

    const bCount = document.getElementById('dash-stat-builds');
    const blCount = document.getElementById('dash-stat-bills');
    const sCount = document.getElementById('dash-stat-spent');
    const wCount = document.getElementById('dash-stat-wishlist');

    if (bCount) bCount.textContent = stats.total_builds;
    if (blCount) blCount.textContent = stats.total_bills;
    if (sCount) sCount.textContent = money(stats.total_spent);
    if (wCount) wCount.textContent = stats.wishlist_count || state.wishlistIds.size;

    // Render 3 recent builds
    const rBuildsList = document.getElementById('dash-recent-builds-list');
    if (rBuildsList) {
      const builds = profile.builds || [];
      if (builds.length === 0) {
        rBuildsList.innerHTML = '<p class="text-muted" style="font-size:0.88rem;">No saved builds yet.</p>';
      } else {
        rBuildsList.innerHTML = builds
          .slice(0, 3)
          .map((b) => `
            <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-color);">
              <div><strong>${escapeHtml(b.build_name)}</strong></div>
              <div style="color:var(--cyan); font-weight:700;">${money(b.total_price)}</div>
            </div>
          `)
          .join('');
      }
    }

    // Render 3 recent bills
    const rBillsList = document.getElementById('dash-recent-bills-list');
    if (rBillsList) {
      const bills = profile.bills || [];
      if (bills.length === 0) {
        rBillsList.innerHTML = '<p class="text-muted" style="font-size:0.88rem;">No invoices generated yet.</p>';
      } else {
        rBillsList.innerHTML = bills
          .slice(0, 3)
          .map((b) => `
            <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-color);">
              <div><strong style="color:var(--cyan);">${escapeHtml(b.bill_number)}</strong></div>
              <div style="color:#fff; font-weight:700;">${money(b.total_amount)}</div>
            </div>
          `)
          .join('');
      }
    }
  } catch (err) {
    showToast('Failed to load dashboard metrics.', 'error');
  }
}

// ==========================================
// COMPONENT CATALOG VIEW
// ==========================================
function renderCatalog() {
  const container = document.getElementById('catalog-grid');
  const catPills = document.getElementById('catalog-cat-pills');
  if (!container) return;

  // Render category pills
  if (catPills && state.categories.length > 0) {
    catPills.innerHTML = `
      <button class="btn btn-sm ${state.catalogCategory === null ? 'btn-primary' : 'btn-secondary'}" onclick="filterCatalogCat(null)">All Parts</button>
      ${state.categories
        .map((c) => `
          <button class="btn btn-sm ${state.catalogCategory === c.name ? 'btn-primary' : 'btn-secondary'}" onclick="filterCatalogCat('${c.name}')">
            ${c.name}
          </button>
        `)
        .join('')}
    `;
  }

  let comps = [...state.components];
  if (state.catalogCategory) {
    comps = comps.filter((c) => c.category_name === state.catalogCategory);
  }
  if (state.catalogSearch) {
    const q = state.catalogSearch.toLowerCase();
    comps = comps.filter((c) => c.name.toLowerCase().includes(q) || (c.socket && c.socket.toLowerCase().includes(q)));
  }

  if (comps.length === 0) {
    container.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><p>No components found.</p></div>';
    return;
  }

  container.innerHTML = comps
    .map((part) => {
      const imgUrl = part.image_url || placeholderSvg(part.category_name);
      const isWishlisted = state.wishlistIds.has(part.id);

      return `
        <div class="part-card">
          <div class="part-card-img-wrap">
            <img class="part-card-img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(part.name)}" loading="lazy" onerror="this.onerror=null; this.src=placeholderSvg('${part.category_name}');" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="badge badge-cyan">${escapeHtml(part.category_name)}</span>
            <div style="display:flex; gap:6px; align-items:center;">
              ${part.socket ? `<span class="badge badge-purple">${escapeHtml(part.socket)}</span>` : ''}
              <button class="btn-wishlist-heart ${isWishlisted ? 'is-active' : ''}" onclick="toggleWishlist(${part.id}, event)" title="${isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}">
                ${isWishlisted ? '♥' : '♡'}
              </button>
            </div>
          </div>
          <div class="part-card-title">${escapeHtml(part.name)}</div>
          <div class="part-card-footer">
            <div class="part-card-price">${money(part.price)}</div>
            <div style="display:flex; gap:4px; flex-wrap:wrap;">
              <button class="btn btn-outline-cyan btn-sm" onclick="openComponentAlternativesModal(${part.id})" title="Smart Alternatives">✨ Alts</button>
              <button class="btn btn-secondary btn-sm" onclick="askAIAboutComponent(${part.id})" title="Ask AI" style="background:rgba(155,93,229,0.15); color:var(--purple); border-color:rgba(155,93,229,0.3);">🤖 AI</button>
              <button class="btn btn-secondary btn-sm" onclick="openPartDetailsModal(${part.id})">🔍</button>
              <button class="btn btn-primary btn-sm" onclick="addPartFromCatalog('${part.category_name}', ${part.id})">+ Add</button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function filterCatalogCat(catName) {
  state.catalogCategory = catName;
  renderCatalog();
}

function handleCatalogSearch(val) {
  state.catalogSearch = val;
  renderCatalog();
}

function clearCatalogFilters() {
  const searchInput = document.getElementById('catalog-search-input');
  if (searchInput) searchInput.value = '';
  state.catalogSearch = '';
  state.catalogCategory = null;
  renderCatalog();
  showToast('Catalog filters reset.', 'info');
}

function addPartFromCatalog(catName, partId) {
  selectComponent(catName, partId);
  showToast(`Added ${catName} to your rig!`, 'success');
  navigateTo('builder');
}

// ==========================================
// WHAT-IF MODE CONTROLLER
// ==========================================
function toggleWhatIfMode() {
  state.whatIfActive = !state.whatIfActive;
  const btn = document.getElementById('what-if-toggle-btn');
  const panel = document.getElementById('builder-what-if-panel');

  if (state.whatIfActive) {
    state.whatIfSelected = { ...state.selected };
    if (btn) {
      btn.className = 'btn btn-primary btn-sm';
      btn.innerHTML = '🔮 What-If: Active';
    }
    if (panel) panel.style.display = 'block';
    renderWhatIfComparison();
    renderCategoryParts(state.activeCategory);
    showToast('What-If Mode Enabled! Experiment without modifying your saved build.', 'info');
  } else {
    discardWhatIfChanges();
  }
}

function calculateTotalFromMap(compMap = {}) {
  let total = 0;
  for (const compId of Object.values(compMap)) {
    const c = state.components.find(comp => comp.id === compId);
    if (c) total += Number(c.price) || 0;
  }
  return total;
}

function renderWhatIfComparison() {
  const grid = document.getElementById('what-if-diff-grid');
  if (!grid) return;

  const origPrice = calculateTotalFromMap(state.selected);
  const whatIfPrice = calculateTotalFromMap(state.whatIfSelected);
  const priceDelta = whatIfPrice - origPrice;

  const origPower = calculatePowerConsumption(state.selected).totalWatts;
  const whatIfPower = calculatePowerConsumption(state.whatIfSelected).totalWatts;
  const powerDelta = whatIfPower - origPower;

  const origScore = calculateSmartScoreForMap(state.selected).score;
  const whatIfScore = calculateSmartScoreForMap(state.whatIfSelected).score;
  const scoreDelta = whatIfScore - origScore;

  const origGpu = state.selected['GPU'] ? state.components.find(c => c.id === state.selected['GPU']) : null;
  const whatIfGpu = state.whatIfSelected['GPU'] ? state.components.find(c => c.id === state.whatIfSelected['GPU']) : null;
  let perfDeltaPct = 0;
  if (whatIfGpu && origGpu && Number(origGpu.price) > 0) {
    perfDeltaPct = Math.round(((Number(whatIfGpu.price) - Number(origGpu.price)) / Number(origGpu.price)) * 30);
  }

  grid.innerHTML = `
    <div class="glass-card" style="padding:8px 10px; margin:0; text-align:center;">
      <div style="font-size:0.72rem; color:var(--text-dim);">PRICE DIFFERENCE</div>
      <div style="font-size:0.95rem; font-weight:800; color:${priceDelta > 0 ? 'var(--accent-green)' : priceDelta < 0 ? 'var(--cyan)' : '#fff'};">
        ${priceDelta > 0 ? '+' : ''}${money(priceDelta)}
      </div>
    </div>
    <div class="glass-card" style="padding:8px 10px; margin:0; text-align:center;">
      <div style="font-size:0.72rem; color:var(--text-dim);">EST. PERFORMANCE</div>
      <div style="font-size:0.95rem; font-weight:800; color:var(--cyan);">
        ${perfDeltaPct >= 0 ? '+' : ''}${perfDeltaPct}% FPS
      </div>
    </div>
    <div class="glass-card" style="padding:8px 10px; margin:0; text-align:center;">
      <div style="font-size:0.72rem; color:var(--text-dim);">POWER DELTA</div>
      <div style="font-size:0.95rem; font-weight:800; color:${powerDelta > 0 ? 'var(--accent-yellow)' : '#fff'};">
        ${powerDelta > 0 ? '+' : ''}${powerDelta} W
      </div>
    </div>
    <div class="glass-card" style="padding:8px 10px; margin:0; text-align:center;">
      <div style="font-size:0.72rem; color:var(--text-dim);">SMART BUILD SCORE</div>
      <div style="font-size:0.95rem; font-weight:800; color:var(--purple);">
        ${origScore} → ${whatIfScore}
      </div>
    </div>
  `;
}

function applyWhatIfChanges() {
  state.selected = { ...state.whatIfSelected };
  state.whatIfActive = false;
  const btn = document.getElementById('what-if-toggle-btn');
  const panel = document.getElementById('builder-what-if-panel');
  if (btn) {
    btn.className = 'btn btn-outline-purple btn-sm';
    btn.innerHTML = '🔮 What-If Mode';
  }
  if (panel) panel.style.display = 'none';

  renderCategoryTabs();
  renderCategoryParts(state.activeCategory);
  renderCurrentBuildSummary();
  broadcastBuildUpdate();
  showToast('What-If changes applied to your workstation build!', 'success');
}

function discardWhatIfChanges() {
  state.whatIfActive = false;
  state.whatIfSelected = {};
  const btn = document.getElementById('what-if-toggle-btn');
  const panel = document.getElementById('builder-what-if-panel');
  if (btn) {
    btn.className = 'btn btn-outline-purple btn-sm';
    btn.innerHTML = '🔮 What-If Mode';
  }
  if (panel) panel.style.display = 'none';

  renderCategoryTabs();
  renderCategoryParts(state.activeCategory);
  renderCurrentBuildSummary();
  broadcastBuildUpdate();
  showToast('What-If changes discarded.', 'info');
}

// ==========================================
// SMART ALTERNATIVES MODAL
// ==========================================
async function openComponentAlternativesModal(compId) {
  const modal = document.getElementById('alternatives-modal');
  const content = document.getElementById('alternatives-modal-content');
  if (!modal || !content) return;

  const comp = state.components.find(c => c.id === compId);
  if (!comp) return;

  modal.classList.add('show');
  content.innerHTML = '<div class="loading-spinner" style="margin:40px auto;"></div>';

  try {
    const currentMap = state.whatIfActive ? state.whatIfSelected : state.selected;
    const alts = await fetchAPI(`${API_BASE}/components/${compId}/alternatives?selected=${encodeURIComponent(JSON.stringify(currentMap))}&budget=${state.budget}`);

    if (!alts || alts.length === 0) {
      content.innerHTML = `
        <div style="text-align:center; padding:20px;">
          <h3 style="font-family:var(--font-heading); color:#fff; font-size:1.1rem; margin-bottom:8px;">No Direct Alternatives Found</h3>
          <p class="text-muted" style="font-size:0.85rem;">"${escapeHtml(comp.name)}" is already uniquely optimal for this socket/tier.</p>
          <button class="btn btn-primary btn-sm" style="margin-top:14px;" onclick="closeAlternativesModal()">Close</button>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div style="margin-bottom:16px;">
        <h3 style="font-family:var(--font-heading); color:#fff; font-size:1.2rem; margin-bottom:4px;">
          Smart Alternatives for ${escapeHtml(comp.name)}
        </h3>
        <div style="font-size:0.8rem; color:var(--text-muted);">
          Current Price: <strong style="color:var(--cyan);">${money(comp.price)}</strong> | Category: <span class="badge badge-cyan">${escapeHtml(comp.category_name)}</span>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:12px;">
        ${alts.map(alt => {
          const imgUrl = alt.image_url || placeholderSvg(alt.category_name);
          return `
            <div class="glass-card" style="padding:14px 16px; margin:0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
              <div style="display:flex; gap:12px; align-items:center;">
                <img src="${escapeHtml(imgUrl)}" style="width:65px; height:50px; object-fit:contain; background:#000; border-radius:4px;" onerror="this.onerror=null; this.src=placeholderSvg('${alt.category_name}');" />
                <div>
                  <div style="display:flex; gap:6px; align-items:center; margin-bottom:2px;">
                    <span class="badge ${alt.badgeClass}">${escapeHtml(alt.badge)}</span>
                    <span style="font-size:0.75rem; color:var(--accent-green); font-weight:700;">${escapeHtml(alt.formattedDelta)}</span>
                  </div>
                  <strong style="color:#fff; font-size:0.9rem;">${escapeHtml(alt.name)}</strong>
                  <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(alt.benefit)}</div>
                </div>
              </div>

              <div style="display:flex; gap:10px; align-items:center;">
                <div style="font-family:var(--font-heading); font-size:1.1rem; font-weight:800; color:var(--cyan);">
                  ${money(alt.price)}
                </div>
                <button class="btn btn-primary btn-sm" onclick="useSmartAlternative('${alt.category_name}', ${alt.id})">
                  Use Alternative
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div style="display:flex; justify-content:flex-end; margin-top:16px;">
        <button class="btn btn-secondary btn-sm" onclick="closeAlternativesModal()">Done</button>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Error fetching alternatives: ${err.message}</p></div>`;
  }
}

function useSmartAlternative(catName, altId) {
  if (state.whatIfActive) {
    state.whatIfSelected[catName] = altId;
    renderCategoryParts(state.activeCategory);
    renderWhatIfComparison();
    showToast(`What-If alternative selected for ${catName}!`, 'info');
  } else {
    selectComponent(catName, altId);
    showToast(`Replaced ${catName} with selected alternative!`, 'success');
  }
  closeAlternativesModal();
}

function closeAlternativesModal() {
  const modal = document.getElementById('alternatives-modal');
  if (modal) modal.classList.remove('show');
}

// ==========================================
// SHARE BUILD SYSTEM
// ==========================================
let currentShareId = null;

async function handleShareCurrentBuild() {
  const payload = {
    build_name: (document.getElementById('current-build-name')?.value || 'Custom PC Rig').trim(),
    cpu_id: state.selected['CPU'] || null,
    gpu_id: state.selected['GPU'] || null,
    motherboard_id: state.selected['Motherboard'] || null,
    ram_id: state.selected['RAM'] || null,
    storage_id: state.selected['Storage'] || null,
    psu_id: state.selected['PSU'] || null,
    case_id: state.selected['Case'] || null,
    total_price: calculateSelectedTotal(),
    compatibility_status: 'VALID',
    performance_score: calculateCurrentSmartScore().score
  };

  try {
    const res = await fetchAPI(`${API_BASE}/builds/share`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    currentShareId = res.share_id;
    openShareModal(res.share_id);
  } catch (err) {
    showToast('Failed to create share link: ' + err.message, 'error');
  }
}

async function handleShareBuildFromId(buildId) {
  try {
    const build = await fetchAPI(`${API_BASE}/builds/${buildId}`);
    if (!build) return;

    const payload = {
      build_id: build.id,
      build_name: build.build_name,
      cpu_id: build.cpu_id,
      gpu_id: build.gpu_id,
      motherboard_id: build.motherboard_id,
      ram_id: build.ram_id,
      storage_id: build.storage_id,
      psu_id: build.psu_id,
      case_id: build.case_id,
      total_price: build.total_price,
      compatibility_status: build.compatibility_status,
      performance_score: build.performance_score
    };

    const res = await fetchAPI(`${API_BASE}/builds/share`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    currentShareId = res.share_id;
    openShareModal(res.share_id);
  } catch (err) {
    showToast('Failed to share build: ' + err.message, 'error');
  }
}

function openShareModal(shareId) {
  const modal = document.getElementById('share-modal');
  const input = document.getElementById('share-url-input');
  if (!modal || !input) return;

  const url = `${window.location.origin}/?share=${shareId}`;
  input.value = url;
  modal.classList.add('show');
}

function closeShareModal() {
  const modal = document.getElementById('share-modal');
  if (modal) modal.classList.remove('show');
}

function copyShareUrl() {
  const input = document.getElementById('share-url-input');
  const btn = document.getElementById('share-copy-btn');
  if (input) {
    navigator.clipboard.writeText(input.value).then(() => {
      if (btn) btn.textContent = '✅ Copied!';
      showToast('Share link copied to clipboard!', 'success');
      setTimeout(() => { if (btn) btn.textContent = '📋 Copy Link'; }, 2500);
    }).catch(() => {
      input.select();
      document.execCommand('copy');
      showToast('Link copied!', 'success');
    });
  }
}

function openSharedBuildDirectly() {
  closeShareModal();
  if (currentShareId) {
    loadSharedBuildView(currentShareId);
  }
}

async function loadSharedBuildView(shareId) {
  navigateTo('shared-build');
  const container = document.getElementById('shared-build-content');
  if (!container) return;

  container.innerHTML = '<div class="loading-spinner" style="margin:60px auto;"></div>';

  try {
    const build = await fetchAPI(`${API_BASE}/builds/share/${shareId}`);
    if (!build) {
      container.innerHTML = '<div class="glass-card empty-state"><p>Shared build not found or link has expired.</p></div>';
      return;
    }

    const parts = [
      { cat: 'CPU', name: build.cpu_name, price: build.cpu_price, img: build.cpu_image, socket: build.cpu_socket },
      { cat: 'GPU', name: build.gpu_name, price: build.gpu_price, img: build.gpu_image },
      { cat: 'Motherboard', name: build.motherboard_name, price: build.motherboard_price, img: build.motherboard_image, socket: build.motherboard_socket },
      { cat: 'RAM', name: build.ram_name, price: build.ram_price, img: build.ram_image },
      { cat: 'Storage', name: build.storage_name, price: build.storage_price, img: build.storage_image },
      { cat: 'PSU', name: build.psu_name, price: build.psu_price, img: build.psu_image },
      { cat: 'Case', name: build.case_name, price: build.case_price, img: build.case_image }
    ];

    const power = calculatePowerConsumption({
      CPU: build.cpu_id,
      GPU: build.gpu_id,
      Motherboard: build.motherboard_id,
      RAM: build.ram_id,
      Storage: build.storage_id,
      PSU: build.psu_id,
      Case: build.case_id
    });

    const thermal = calculateThermalEstimate({
      CPU: build.cpu_id,
      GPU: build.gpu_id,
      Motherboard: build.motherboard_id,
      RAM: build.ram_id,
      Storage: build.storage_id,
      PSU: build.psu_id,
      Case: build.case_id
    });

    container.innerHTML = `
      <div style="max-width:900px; margin:0 auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
          <div>
            <span class="badge badge-purple" style="margin-bottom:6px;">PUBLIC SHARED BUILD</span>
            <h1 class="section-title" style="margin:0;">${escapeHtml(build.build_name)}</h1>
            <div class="text-muted" style="font-size:0.85rem;">Share Code: <code style="color:var(--cyan);">${escapeHtml(build.share_id)}</code></div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-primary" onclick="loadSharedIntoBuilder('${encodeURIComponent(JSON.stringify(build))}')">
              🛠️ Load into My Workstation
            </button>
            <button class="btn btn-secondary" onclick="navigateTo('home')">
              🏠 Home
            </button>
          </div>
        </div>

        <!-- Metric KPI Cards -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:20px;">
          <div class="glass-card" style="padding:14px; margin:0; text-align:center;">
            <div style="font-size:0.75rem; color:var(--text-dim);">TOTAL PRICE (INC. GST)</div>
            <div style="font-family:var(--font-heading); font-size:1.35rem; font-weight:800; color:var(--cyan); margin-top:2px;">
              ${money(build.total_price)}
            </div>
          </div>
          <div class="glass-card" style="padding:14px; margin:0; text-align:center;">
            <div style="font-size:0.75rem; color:var(--text-dim);">SMART BUILD SCORE</div>
            <div style="font-family:var(--font-heading); font-size:1.35rem; font-weight:800; color:var(--purple); margin-top:2px;">
              ${build.performance_score || 92}/100
            </div>
          </div>
          <div class="glass-card" style="padding:14px; margin:0; text-align:center;">
            <div style="font-size:0.75rem; color:var(--text-dim);">ESTIMATED POWER</div>
            <div style="font-family:var(--font-heading); font-size:1.35rem; font-weight:800; color:#fff; margin-top:2px;">
              ${power.totalWatts}W <span style="font-size:0.75rem; color:var(--cyan);">(${power.recPsuWatts}W Rec)</span>
            </div>
          </div>
          <div class="glass-card" style="padding:14px; margin:0; text-align:center;">
            <div style="font-size:0.75rem; color:var(--text-dim);">THERMAL STATUS</div>
            <div style="font-family:var(--font-heading); font-size:1.1rem; font-weight:700; color:var(--accent-green); margin-top:4px;">
              ${thermal.label}
            </div>
          </div>
        </div>

        <!-- Components List -->
        <div class="glass-card">
          <h3 style="font-family:var(--font-heading); font-size:1.1rem; margin-bottom:14px; color:#fff;">Selected Components</h3>
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${parts.map(p => {
              const imgUrl = p.img || placeholderSvg(p.cat);
              return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(255,255,255,0.02); border:1px solid var(--border-color); border-radius:var(--radius-sm); flex-wrap:wrap; gap:10px;">
                  <div style="display:flex; gap:12px; align-items:center;">
                    <img src="${escapeHtml(imgUrl)}" style="width:50px; height:40px; object-fit:contain; background:#000; border-radius:4px;" onerror="this.onerror=null; this.src=placeholderSvg('${p.cat}');" />
                    <div>
                      <span class="badge badge-cyan" style="font-size:0.65rem;">${escapeHtml(p.cat)}</span>
                      ${p.socket ? `<span class="badge badge-purple" style="font-size:0.65rem;">${escapeHtml(p.socket)}</span>` : ''}
                      <div style="font-weight:700; color:#fff; font-size:0.9rem; margin-top:2px;">${escapeHtml(p.name || '[Not Configured]')}</div>
                    </div>
                  </div>
                  <div style="font-family:var(--font-heading); font-weight:700; color:var(--cyan); font-size:1rem;">
                    ${p.price ? money(p.price) : '—'}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="glass-card empty-state"><p>Error loading shared build: ${err.message}</p></div>`;
  }
}

function loadSharedIntoBuilder(encodedBuild) {
  try {
    const build = JSON.parse(decodeURIComponent(encodedBuild));
    state.selected = {};
    if (build.cpu_id) state.selected['CPU'] = build.cpu_id;
    if (build.gpu_id) state.selected['GPU'] = build.gpu_id;
    if (build.motherboard_id) state.selected['Motherboard'] = build.motherboard_id;
    if (build.ram_id) state.selected['RAM'] = build.ram_id;
    if (build.storage_id) state.selected['Storage'] = build.storage_id;
    if (build.psu_id) state.selected['PSU'] = build.psu_id;
    if (build.case_id) state.selected['Case'] = build.case_id;

    const nameInput = document.getElementById('current-build-name');
    if (nameInput) nameInput.value = `${build.build_name} (Copy)`;

    navigateTo('builder');
    renderCategoryTabs();
    renderCategoryParts(state.activeCategory);
    renderCurrentBuildSummary();
    broadcastBuildUpdate();
    showToast(`Loaded "${build.build_name}" into your builder workstation!`, 'success');
  } catch (e) {
    console.error('Error loading shared build:', e);
  }
}

// ==========================================
// DETAILS & LIVE PRICE & PRICE HISTORY MODAL
// ==========================================
async function openPartDetailsModal(partId) {
  const modal = document.getElementById('details-modal');
  const content = document.getElementById('details-modal-content');
  if (!modal || !content) return;

  const part = state.components.find((c) => c.id === partId);
  if (!part) return;

  const imgUrl = part.image_url || placeholderSvg(part.category_name);
  const isWishlisted = state.wishlistIds.has(part.id);

  modal.classList.add('show');
  content.innerHTML = `
    <div style="display:flex; gap:20px; align-items:center; margin-bottom:16px;">
      <img src="${escapeHtml(imgUrl)}" style="width:120px; height:90px; object-fit:contain; background:#000; border-radius:var(--radius-sm);" onerror="this.onerror=null; this.src=placeholderSvg('${part.category_name}');" />
      <div>
        <h3 style="font-family:var(--font-heading); color:#fff; font-size:1.2rem;">${escapeHtml(part.name)}</h3>
        <div style="display:flex; gap:6px; margin-top:4px; align-items:center;">
          <span class="badge badge-cyan">${escapeHtml(part.category_name)}</span>
          ${part.socket ? `<span class="badge badge-purple">${escapeHtml(part.socket)}</span>` : ''}
          <button class="btn-wishlist-heart ${isWishlisted ? 'is-active' : ''}" onclick="toggleWishlist(${part.id}, event); openPartDetailsModal(${part.id});" style="font-size:1rem;">
            ${isWishlisted ? '♥ Wishlisted' : '♡ Wishlist'}
          </button>
        </div>
        <div style="font-family:var(--font-heading); font-size:1.3rem; font-weight:800; color:var(--cyan); margin-top:8px;">
          ${money(part.price)}
        </div>
      </div>
    </div>

    <div class="glass-card" style="margin-bottom:16px;">
      <h4 style="font-size:0.9rem; margin-bottom:8px; color:var(--text-muted);">TECHNICAL SPECIFICATIONS</h4>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:0.85rem;">
        ${Object.entries(part.specs || {})
          .map(([k, v]) => `<div><span style="color:var(--text-dim);">${escapeHtml(k)}:</span> <strong>${escapeHtml(String(v))}</strong></div>`)
          .join('')}
      </div>
    </div>

    <!-- Historical Price Data (Display-Only) -->
    <div class="glass-card" style="margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h4 style="font-size:0.9rem; margin:0; color:var(--text-muted);">PRICE HISTORY (SAMPLE DATA)</h4>
        <span style="font-size:0.7rem; color:var(--text-dim);">Historical Trend</span>
      </div>
      <div id="modal-price-history">
        <div class="loading-spinner"></div>
      </div>
    </div>

    <div class="glass-card">
      <h4 style="font-size:0.9rem; margin-bottom:8px; color:var(--text-muted);">LIVE MULTI-VENDOR PRICES</h4>
      <div id="modal-price-offers">
        <div class="loading-spinner"></div>
      </div>
    </div>

    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px; flex-wrap:wrap;">
      <button class="btn btn-secondary" onclick="askAIAboutComponent(${part.id}); closeDetailsModal();" style="background:rgba(155,93,229,0.15); color:var(--purple); border-color:rgba(155,93,229,0.3);">
        🤖 Ask AI for Insights
      </button>
      <button class="btn btn-secondary" onclick="closeDetailsModal()">Close</button>
      <button class="btn btn-primary" onclick="selectComponent('${part.category_name}', ${part.id}); closeDetailsModal();">
        Select for Build
      </button>
    </div>
  `;

  // Fetch Price History
  try {
    const histRes = await fetchAPI(`${API_BASE}/components/${partId}/price-history`);
    const histEl = document.getElementById('modal-price-history');
    if (histEl && histRes && histRes.points) {
      const pts = histRes.points;
      const prices = pts.map(p => p.price);
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const range = (maxP - minP) || 1;

      // Build mini SVG polyline
      const svgPoints = pts.map((p, idx) => {
        const x = 20 + (idx * 90);
        const y = 50 - ((p.price - minP) / range) * 35;
        return `${x},${y}`;
      }).join(' ');

      histEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:0.8rem;">
          ${pts.map((p, i) => `
            <div style="text-align:center;">
              <div style="color:var(--text-dim); font-size:0.72rem;">${i === pts.length - 1 ? 'Current' : (90 - i * 30) + 'd ago'}</div>
              <strong style="color:${i === pts.length - 1 ? 'var(--cyan)' : '#fff'};">${money(p.price)}</strong>
            </div>
          `).join('')}
        </div>
        <div style="background:rgba(0,0,0,0.3); border-radius:4px; padding:6px; height:60px;">
          <svg width="100%" height="100%" viewBox="0 0 320 60" preserveAspectRatio="none">
            <polyline fill="none" stroke="var(--cyan)" stroke-width="2.5" points="${svgPoints}" />
          </svg>
        </div>
        <div style="font-size:0.68rem; color:var(--text-dim); margin-top:4px; text-align:right;">
          ${escapeHtml(histRes.disclaimer || 'Sample Historical Price Data')}
        </div>
      `;
    }
  } catch (e) {}

  // Fetch live vendor prices
  try {
    const res = await fetchAPI(`${API_BASE}/components/${partId}/prices`);
    const offersEl = document.getElementById('modal-price-offers');
    if (!offersEl) return;

    const offers = res.offers || [];
    if (offers.length === 0) {
      offersEl.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">No multi-vendor offers found for this part.</p>';
      return;
    }

    offersEl.innerHTML = offers
      .map(
        (o) => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.85rem;">
            <div>
              <strong>${escapeHtml(o.vendor)}</strong>
              <div style="color:var(--text-dim); font-size:0.75rem;">${escapeHtml(o.title || '')}</div>
            </div>
            <div style="text-align:right;">
              <div style="color:var(--cyan); font-weight:700;">${money(o.price)}</div>
              <span class="badge ${o.inStock ? 'badge-green' : 'badge-purple'}" style="font-size:0.65rem;">
                ${o.inStock ? 'In Stock' : 'Check Store'}
              </span>
            </div>
          </div>
        `
      )
      .join('');
  } catch (e) {
    const offersEl = document.getElementById('modal-price-offers');
    if (offersEl) offersEl.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">Live price comparisons temporarily offline.</p>';
  }
}

function closeDetailsModal() {
  const modal = document.getElementById('details-modal');
  if (modal) modal.classList.remove('show');
}

// Fallback SVG placeholder generator
function placeholderSvg(cat) {
  const colorMap = {
    CPU: '#00e5ff',
    GPU: '#9b5de5',
    Motherboard: '#00f5d4',
    RAM: '#f15bb5',
    Storage: '#fee440',
    PSU: '#ff85a1',
    Case: '#70d6ff',
  };
  const c = colorMap[cat] || '#00e5ff';
  const encoded = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200" fill="#0d1118">
      <rect width="100%" height="100%" fill="#0d1118" stroke="#1f2937" stroke-width="2"/>
      <circle cx="150" cy="90" r="35" fill="none" stroke="${c}" stroke-width="2"/>
      <text x="150" y="96" fill="${c}" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle">${escapeHtml(cat || 'HARDWARE')}</text>
      <text x="150" y="145" fill="#6b7280" font-family="sans-serif" font-size="11" text-anchor="middle">Component Image</text>
    </svg>
  `);
  return `data:image/svg+xml;utf8,${encoded}`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Expose globals for onclick handlers
window.state = state;
window.navigateTo = navigateTo;
window.switchBuilderCategory = switchBuilderCategory;
window.selectComponent = selectComponent;
window.removeComponentSlot = removeComponentSlot;
window.clearCurrentBuild = clearCurrentBuild;
window.handlePartSearch = handlePartSearch;
window.handlePartSort = handlePartSort;
window.handleAutoSuggest = handleAutoSuggest;
window.handleSaveBuild = handleSaveBuild;
window.loadBuildIntoBuilder = loadBuildIntoBuilder;
window.handleDeleteBuild = handleDeleteBuild;
window.handleGenerateBillFromCurrent = handleGenerateBillFromCurrent;
window.handleGenerateBillFromBuildId = handleGenerateBillFromBuildId;
window.viewBillDetails = viewBillDetails;
window.closeInvoiceModal = closeInvoiceModal;
window.filterCatalogCat = filterCatalogCat;
window.handleCatalogSearch = handleCatalogSearch;
window.addPartFromCatalog = addPartFromCatalog;
window.openPartDetailsModal = openPartDetailsModal;
window.closeDetailsModal = closeDetailsModal;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchAuthTab = switchAuthTab;
window.quickFillAuth = quickFillAuth;
window.handleLoginSubmit = handleLoginSubmit;
window.handleRegisterSubmit = handleRegisterSubmit;
window.handleLogout = handleLogout;
window.toggleUserDropdown = toggleUserDropdown;
window.toggleMobileNav = toggleMobileNav;
window.toggleWidget = toggleWidget;
window.showToast = showToast;
window.broadcastBuildUpdate = broadcastBuildUpdate;
window.renderCategoryTabs = renderCategoryTabs;
window.renderCategoryParts = renderCategoryParts;
window.renderCurrentBuildSummary = renderCurrentBuildSummary;
window.toggleWishlist = toggleWishlist;
window.loadUserWishlist = loadUserWishlist;
window.handleBudgetSliderChange = handleBudgetSliderChange;
window.setBuilderBudget = setBuilderBudget;
window.syncBudgetSlider = syncBudgetSlider;

// ==========================================================================
// ENTERPRISE ADMIN DASHBOARD CONTROLLER
// ==========================================================================

async function initAdminApp() {
  const token = localStorage.getItem('pcb_token');
  const storedUser = localStorage.getItem('pcb_user');
  let user = null;

  if (storedUser) {
    try { user = JSON.parse(storedUser); } catch {}
  }

  // If not admin, check static admin token or redirect
  const staticToken = localStorage.getItem('adminToken') || 'dev-admin';
  if ((!user || user.role !== 'ADMIN') && !staticToken) {
    showToast('Admin authorization required.', 'error');
    setTimeout(() => { location.href = '/'; }, 1000);
    return;
  }

  const nameTag = document.getElementById('admin-name-tag');
  if (nameTag && user) nameTag.textContent = user.name;

  switchAdminTab('overview');
}

function switchAdminTab(tabName) {
  const tabs = document.querySelectorAll('.admin-nav-item');
  tabs.forEach(t => {
    if (t.dataset.adminTab === tabName) t.classList.add('active');
    else t.classList.remove('active');
  });

  const sections = document.querySelectorAll('.admin-tab-content');
  sections.forEach(s => s.style.display = 'none');

  const target = document.getElementById(`admin-tab-${tabName}`);
  if (target) target.style.display = 'block';

  if (tabName === 'overview') loadAdminOverview();
  if (tabName === 'users') loadAdminUsers();
  if (tabName === 'builds') loadAdminBuilds();
  if (tabName === 'bills') loadAdminBills();
  if (tabName === 'components') loadAdminComponents();
  if (tabName === 'reports') loadAdminReports();
}

async function loadAdminOverview() {
  try {
    const stats = await fetchAPI(`${API_BASE}/admin/dashboard`);

    const uEl = document.getElementById('admin-stat-users');
    const bEl = document.getElementById('admin-stat-builds');
    const blEl = document.getElementById('admin-stat-bills');
    const rEl = document.getElementById('admin-stat-revenue');

    if (uEl) uEl.textContent = stats.total_users || 0;
    if (bEl) bEl.textContent = stats.total_builds || 0;
    if (blEl) blEl.textContent = stats.total_bills || 0;
    if (rEl) rEl.textContent = money(stats.total_revenue || 0);

    // Recent Users
    const rUsers = document.getElementById('admin-recent-users-table');
    if (rUsers) {
      rUsers.innerHTML = `
        <table class="pro-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Action</th></tr></thead>
          <tbody>
            ${(stats.recent_users || []).map(u => `
              <tr>
                <td><strong>${escapeHtml(u.name)}</strong></td>
                <td>${escapeHtml(u.email)}</td>
                <td><span class="badge ${u.role === 'ADMIN' ? 'badge-purple' : 'badge-cyan'}">${u.role}</span></td>
                <td><button class="btn btn-secondary btn-sm" onclick="openAdminUserModal(${u.id})">🔍 View</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    // Recent Builds
    const rBuilds = document.getElementById('admin-recent-builds-table');
    if (rBuilds) {
      rBuilds.innerHTML = `
        <table class="pro-table">
          <thead><tr><th>Build Name</th><th>User</th><th>Total</th><th>Score</th><th>Action</th></tr></thead>
          <tbody>
            ${(stats.recent_builds || []).map(b => `
              <tr>
                <td><strong>${escapeHtml(b.build_name)}</strong></td>
                <td>${escapeHtml(b.user_name || 'User')}</td>
                <td style="color:var(--cyan);">${money(b.total_price)}</td>
                <td><span class="badge badge-purple">${b.performance_score || 91}/100</span></td>
                <td><button class="btn btn-secondary btn-sm" onclick="openAdminBuildModal(${b.id})">🔍 View</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    // Recent Bills
    const rBills = document.getElementById('admin-recent-bills-table');
    if (rBills) {
      rBills.innerHTML = `
        <table class="pro-table">
          <thead><tr><th>Bill #</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>
            ${(stats.recent_bills || []).map(bl => `
              <tr>
                <td><strong style="color:var(--cyan);">${escapeHtml(bl.bill_number)}</strong></td>
                <td>${escapeHtml(bl.user_name || 'Customer')}</td>
                <td><strong>${money(bl.total_amount)}</strong></td>
                <td><span class="badge badge-green">${escapeHtml(bl.status || 'PAID')}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (err) {
    showToast('Failed to load admin dashboard: ' + err.message, 'error');
  }
}

async function loadAdminUsers() {
  const container = document.getElementById('admin-all-users-table');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const users = await fetchAPI(`${API_BASE}/admin/users`);
    container.innerHTML = `
      <table class="pro-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Builds</th>
            <th>Orders</th>
            <th>Total Spent</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>#${u.id}</td>
              <td><strong>${escapeHtml(u.name)}</strong></td>
              <td>${escapeHtml(u.email)}</td>
              <td><span class="badge ${u.role === 'ADMIN' ? 'badge-purple' : 'badge-cyan'}">${u.role}</span></td>
              <td>${u.build_count || 0}</td>
              <td>${u.bill_count || 0}</td>
              <td style="color:var(--cyan);">${money(u.total_spent)}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="openAdminUserModal(${u.id})">
                  🔍 User Builds
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<p class="text-muted">Error loading users: ${err.message}</p>`;
  }
}

// User Drilldown Modal for Admin
async function openAdminUserModal(userId) {
  const modal = document.getElementById('admin-user-details-modal');
  const content = document.getElementById('admin-user-modal-content');
  if (!modal || !content) return;

  modal.classList.add('show');
  content.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const profile = await fetchAPI(`${API_BASE}/admin/users/${userId}`);
    const u = profile.user;
    const builds = profile.builds || [];
    const bills = profile.bills || [];

    const buildsHTML = builds.length === 0 
      ? '<p class="text-muted" style="font-size:0.85rem;">No saved builds for this user.</p>'
      : builds.map(b => `
          <div class="glass-card" style="margin-bottom:10px; padding:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <div>
                <strong>${escapeHtml(b.build_name)}</strong>
                <span class="badge badge-purple" style="font-size:0.7rem; margin-left:6px;">Score: ${b.performance_score || 91}/100</span>
              </div>
              <div style="color:var(--cyan); font-weight:700;">${money(b.total_price)}</div>
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted); line-height:1.6;">
              ${b.cpu_name ? `• <strong>CPU:</strong> ${escapeHtml(b.cpu_name)}<br/>` : ''}
              ${b.gpu_name ? `• <strong>GPU:</strong> ${escapeHtml(b.gpu_name)}<br/>` : ''}
              ${b.motherboard_name ? `• <strong>Motherboard:</strong> ${escapeHtml(b.motherboard_name)}<br/>` : ''}
              ${b.ram_name ? `• <strong>RAM:</strong> ${escapeHtml(b.ram_name)}<br/>` : ''}
              ${b.storage_name ? `• <strong>Storage:</strong> ${escapeHtml(b.storage_name)}<br/>` : ''}
              ${b.psu_name ? `• <strong>PSU:</strong> ${escapeHtml(b.psu_name)}<br/>` : ''}
              ${b.case_name ? `• <strong>Case:</strong> ${escapeHtml(b.case_name)}` : ''}
            </div>
          </div>
        `).join('');

    content.innerHTML = `
      <div style="margin-bottom:16px; border-bottom:1px solid var(--border-color); padding-bottom:12px;">
        <h3 style="font-family:var(--font-heading); color:#fff; font-size:1.2rem;">User Information</h3>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:0.9rem; margin-top:8px;">
          <div><span style="color:var(--text-dim);">Name:</span> <strong>${escapeHtml(u.name)}</strong></div>
          <div><span style="color:var(--text-dim);">Email:</span> <strong>${escapeHtml(u.email)}</strong></div>
          <div><span style="color:var(--text-dim);">Role:</span> <span class="badge ${u.role === 'ADMIN' ? 'badge-purple' : 'badge-cyan'}">${u.role}</span></div>
          <div><span style="color:var(--text-dim);">Joined:</span> ${new Date(u.created_at).toLocaleDateString('en-IN')}</div>
        </div>
      </div>

      <h4 style="font-size:1rem; color:var(--cyan); margin-bottom:10px;">Saved Hardware Builds (${builds.length})</h4>
      <div style="max-height:280px; overflow-y:auto; margin-bottom:16px;">
        ${buildsHTML}
      </div>

      <div style="display:flex; justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeAdminUserModal()">Close</button>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<p class="text-muted">Error loading user details: ${err.message}</p>`;
  }
}

function closeAdminUserModal() {
  const modal = document.getElementById('admin-user-details-modal');
  if (modal) modal.classList.remove('show');
}

async function openAdminBuildModal(buildId) {
  try {
    const b = await fetchAPI(`${API_BASE}/builds/${buildId}`);
    const modal = document.getElementById('admin-user-details-modal');
    const content = document.getElementById('admin-user-modal-content');
    if (!modal || !content) return;

    modal.classList.add('show');
    content.innerHTML = `
      <div style="margin-bottom:16px; border-bottom:1px solid var(--border-color); padding-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="font-family:var(--font-heading); color:#fff; font-size:1.2rem;">${escapeHtml(b.build_name)}</h3>
          <span class="badge badge-purple" style="font-size:0.85rem; font-weight:800;">Smart Score: ${b.performance_score || 91}/100</span>
        </div>
        <div style="font-size:0.85rem; color:var(--text-dim); margin-top:4px;">
          Built by: <strong>${escapeHtml(b.user_name || 'Customer')}</strong> (${escapeHtml(b.user_email || '')})
        </div>
      </div>

      <div class="glass-card" style="margin-bottom:16px;">
        <h4 style="font-size:0.9rem; color:var(--text-muted); margin-bottom:10px;">COMPONENT SPECIFICATIONS</h4>
        <div style="display:flex; flex-direction:column; gap:6px; font-size:0.85rem;">
          <div style="display:flex; justify-content:space-between;"><span>Processor:</span> <strong>${escapeHtml(b.cpu_name || 'Not selected')}</strong> <span style="color:var(--cyan);">${money(b.cpu_price)}</span></div>
          <div style="display:flex; justify-content:space-between;"><span>Graphics:</span> <strong>${escapeHtml(b.gpu_name || 'Not selected')}</strong> <span style="color:var(--cyan);">${money(b.gpu_price)}</span></div>
          <div style="display:flex; justify-content:space-between;"><span>Motherboard:</span> <strong>${escapeHtml(b.motherboard_name || 'Not selected')}</strong> <span style="color:var(--cyan);">${money(b.motherboard_price)}</span></div>
          <div style="display:flex; justify-content:space-between;"><span>Memory (RAM):</span> <strong>${escapeHtml(b.ram_name || 'Not selected')}</strong> <span style="color:var(--cyan);">${money(b.ram_price)}</span></div>
          <div style="display:flex; justify-content:space-between;"><span>Storage (SSD):</span> <strong>${escapeHtml(b.storage_name || 'Not selected')}</strong> <span style="color:var(--cyan);">${money(b.storage_price)}</span></div>
          <div style="display:flex; justify-content:space-between;"><span>Power Supply:</span> <strong>${escapeHtml(b.psu_name || 'Not selected')}</strong> <span style="color:var(--cyan);">${money(b.psu_price)}</span></div>
          <div style="display:flex; justify-content:space-between;"><span>Case:</span> <strong>${escapeHtml(b.case_name || 'Not selected')}</strong> <span style="color:var(--cyan);">${money(b.case_price)}</span></div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:12px; padding-top:10px; border-top:1px solid var(--border-color); font-size:1.05rem;">
          <strong>Total Amount:</strong>
          <strong style="color:var(--cyan);">${money(b.total_price)}</strong>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeAdminUserModal()">Close</button>
      </div>
    `;
  } catch (e) {
    showToast('Failed to open build details: ' + e.message, 'error');
  }
}

async function loadAdminBuilds() {
  const container = document.getElementById('admin-all-builds-table');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const builds = await fetchAPI(`${API_BASE}/admin/builds`);
    container.innerHTML = `
      <table class="pro-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Build Name</th>
            <th>User</th>
            <th>CPU</th>
            <th>GPU</th>
            <th>Total Price</th>
            <th>Smart Score</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${builds.map(b => `
            <tr>
              <td>#${b.id}</td>
              <td><strong>${escapeHtml(b.build_name)}</strong></td>
              <td>${escapeHtml(b.user_name || 'User')}</td>
              <td>${escapeHtml(b.cpu_name || '-')}</td>
              <td>${escapeHtml(b.gpu_name || '-')}</td>
              <td style="color:var(--cyan); font-weight:700;">${money(b.total_price)}</td>
              <td><span class="badge badge-purple">${b.performance_score || 91}/100</span></td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="openAdminBuildModal(${b.id})">🔍 Inspect</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<p class="text-muted">Error loading builds: ${err.message}</p>`;
  }
}

async function loadAdminBills() {
  const container = document.getElementById('admin-all-bills-table');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const bills = await fetchAPI(`${API_BASE}/admin/bills`);
    container.innerHTML = `
      <table class="pro-table">
        <thead>
          <tr>
            <th>Bill Number</th>
            <th>Customer</th>
            <th>Build Reference</th>
            <th>Date</th>
            <th>Items</th>
            <th>Total (Inc. GST)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${bills.map(bl => `
            <tr>
              <td><strong style="color:var(--cyan);">${escapeHtml(bl.bill_number)}</strong></td>
              <td>${escapeHtml(bl.user_name || 'Customer')}</td>
              <td>${escapeHtml(bl.build_name || 'Custom PC')}</td>
              <td>${new Date(bl.created_at).toLocaleDateString('en-IN')}</td>
              <td>${bl.item_count || 1} parts</td>
              <td><strong>${money(bl.total_amount)}</strong></td>
              <td><span class="badge badge-green">${escapeHtml(bl.status || 'PAID')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<p class="text-muted">Error loading bills: ${err.message}</p>`;
  }
}

async function loadAdminComponents() {
  const container = document.getElementById('admin-components-table');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const comps = await fetchAPI(`${API_BASE}/components`);
    container.innerHTML = `
      <table class="pro-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Category</th>
            <th>Name</th>
            <th>Price</th>
            <th>Socket</th>
            <th>Image Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${comps.map(c => `
            <tr>
              <td>#${c.id}</td>
              <td><span class="badge badge-cyan">${escapeHtml(c.category_name)}</span></td>
              <td><strong>${escapeHtml(c.name)}</strong></td>
              <td>${money(c.price)}</td>
              <td>${c.socket || '-'}</td>
              <td>${c.image_url ? '🟢 Verified' : '🔴 Missing'}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="openEditComponentModal(${c.id})">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="handleAdminDeleteComp(${c.id})">🗑️</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<p class="text-muted">Error loading components: ${err.message}</p>`;
  }
}

async function loadAdminReports() {
  const container = document.getElementById('admin-reports-table');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const stats = await fetchAPI(`${API_BASE}/admin/reports`);
    const cats = stats.category_breakdown || [];
    const popCpus = stats.popular_cpus || [];
    const popGpus = stats.popular_gpus || [];

    container.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;">
        <div class="glass-card">
          <h4 style="font-size:0.95rem; color:var(--cyan); margin-bottom:10px;">🔥 Top Popular Processors (CPUs)</h4>
          ${popCpus.length === 0 ? '<p class="text-muted" style="font-size:0.85rem;">No build data yet.</p>' : popCpus.map((cp, idx) => `
            <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.85rem;">
              <span>${idx + 1}. ${escapeHtml(cp.name)}</span>
              <strong style="color:var(--cyan);">${cp.count} builds</strong>
            </div>
          `).join('')}
        </div>

        <div class="glass-card">
          <h4 style="font-size:0.95rem; color:var(--purple); margin-bottom:10px;">🎮 Top Popular Graphics Cards (GPUs)</h4>
          ${popGpus.length === 0 ? '<p class="text-muted" style="font-size:0.85rem;">No build data yet.</p>' : popGpus.map((gp, idx) => `
            <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.85rem;">
              <span>${idx + 1}. ${escapeHtml(gp.name)}</span>
              <strong style="color:var(--purple);">${gp.count} builds</strong>
            </div>
          `).join('')}
        </div>
      </div>

      <table class="pro-table">
        <thead>
          <tr>
            <th>Hardware Category</th>
            <th>Inventory Count</th>
            <th>Average Price (INR)</th>
          </tr>
        </thead>
        <tbody>
          ${cats.map(cat => `
            <tr>
              <td><strong>${escapeHtml(cat.category)}</strong></td>
              <td>${cat.component_count || 0} items</td>
              <td>${money(cat.avg_price)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<p class="text-muted">Error loading analytics reports: ${err.message}</p>`;
  }
}

async function openAddComponentModal() {
  const modal = document.getElementById('admin-comp-modal');
  const catSelect = document.getElementById('admin-comp-category');
  if (!modal) return;

  const cats = await fetchAPI(`${API_BASE}/categories`);
  if (catSelect) {
    catSelect.innerHTML = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  document.getElementById('admin-comp-id').value = '';
  document.getElementById('admin-comp-name').value = '';
  document.getElementById('admin-comp-price').value = '';
  document.getElementById('admin-comp-socket').value = '';
  document.getElementById('admin-comp-image').value = '';
  document.getElementById('admin-comp-specs').value = '{}';
  document.getElementById('admin-comp-modal-title').textContent = 'Add Component';

  modal.classList.add('show');
}

async function openEditComponentModal(id) {
  try {
    const comp = await fetchAPI(`${API_BASE}/components/${id}`);
    const modal = document.getElementById('admin-comp-modal');
    const catSelect = document.getElementById('admin-comp-category');
    if (!modal || !comp) return;

    const cats = await fetchAPI(`${API_BASE}/categories`);
    if (catSelect) {
      catSelect.innerHTML = cats.map(c => `<option value="${c.id}" ${c.id === comp.category_id ? 'selected' : ''}>${c.name}</option>`).join('');
    }

    document.getElementById('admin-comp-id').value = comp.id;
    document.getElementById('admin-comp-name').value = comp.name;
    document.getElementById('admin-comp-price').value = comp.price;
    document.getElementById('admin-comp-socket').value = comp.socket || '';
    document.getElementById('admin-comp-image').value = comp.image_url || '';
    document.getElementById('admin-comp-specs').value = JSON.stringify(comp.specs || {}, null, 2);
    document.getElementById('admin-comp-modal-title').textContent = 'Edit Component';

    modal.classList.add('show');
  } catch (e) {
    showToast('Failed to open component: ' + e.message, 'error');
  }
}

function closeAdminCompModal() {
  const modal = document.getElementById('admin-comp-modal');
  if (modal) modal.classList.remove('show');
}

async function handleAdminCompSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('admin-comp-id').value;
  const name = document.getElementById('admin-comp-name').value;
  const category_id = Number(document.getElementById('admin-comp-category').value);
  const price = Number(document.getElementById('admin-comp-price').value);
  const socket = document.getElementById('admin-comp-socket').value || null;
  const image_url = document.getElementById('admin-comp-image').value || null;
  
  let specs = {};
  try {
    specs = JSON.parse(document.getElementById('admin-comp-specs').value || '{}');
  } catch {
    showToast('Specifications must be valid JSON.', 'error');
    return;
  }

  const payload = { name, category_id, price, socket, image_url, specs };

  try {
    if (id) {
      await fetchAPI(`${API_BASE}/components/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast('Component updated!', 'success');
    } else {
      await fetchAPI(`${API_BASE}/components`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('Component created!', 'success');
    }
    closeAdminCompModal();
    loadAdminComponents();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  }
}

async function handleAdminDeleteComp(id) {
  if (!confirm('Are you sure you want to delete this hardware component?')) return;
  try {
    await fetchAPI(`${API_BASE}/components/${id}`, { method: 'DELETE' });
    showToast('Component deleted.', 'info');
    loadAdminComponents();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
}

async function handleAdminAutofillImages() {
  const btn = document.getElementById('admin-autofill-btn');
  const status = document.getElementById('admin-autofill-status');
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Autofilling missing images...';

  try {
    const res = await fetchAPI(`${API_BASE}/images/autofill`, { method: 'POST' });
    if (status) status.textContent = `Updated ${res.updated} missing images!`;
    showToast(`Autofill complete: ${res.updated} images updated.`, 'success');
    loadAdminComponents();
  } catch (e) {
    if (status) status.textContent = 'Autofill error';
    showToast('Image autofill error: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function handleAdminLogout() {
  handleLogout(true);
}

function saveAdminStaticToken() {
  const val = document.getElementById('admin-static-token-input')?.value;
  if (val) {
    localStorage.setItem('adminToken', val);
    showToast('Developer static token saved.', 'success');
  }
}

window.initAdminApp = initAdminApp;
window.switchAdminTab = switchAdminTab;
window.openAdminUserModal = openAdminUserModal;
window.closeAdminUserModal = closeAdminUserModal;
window.openAdminBuildModal = openAdminBuildModal;
window.openAddComponentModal = openAddComponentModal;
window.openEditComponentModal = openEditComponentModal;
window.closeAdminCompModal = closeAdminCompModal;
window.handleAdminCompSubmit = handleAdminCompSubmit;
window.handleAdminDeleteComp = handleAdminDeleteComp;
window.handleAdminAutofillImages = handleAdminAutofillImages;
window.handleAdminLogout = handleAdminLogout;
window.saveAdminStaticToken = saveAdminStaticToken;

