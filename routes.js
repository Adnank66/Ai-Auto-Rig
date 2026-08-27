const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  listCategories,
  getAllComponents,
  getComponentById,
  createComponent,
  updateComponent,
  deleteComponent,
  getComponentsByIds,
  loadCompatibility,
  // User operations
  createUser,
  getUserByEmail,
  getUserById,
  getAllUsers,
  getUserProfileWithStats,
  updateUser,
  deleteUser,
  // Build operations
  calculateSmartBuildScore,
  createBuild,
  getBuildById,
  getBuildsByUserId,
  getAllBuilds,
  updateBuild,
  deleteBuild,
  // Bill operations
  createBill,
  getBillById,
  getBillsByUserId,
  getAllBills,
  deleteBill,
  // Wishlist operations
  addToWishlist,
  removeFromWishlist,
  getWishlistByUserId,
  getWishlistIdsByUserId,
  // Price history
  getPriceHistoryByComponentId,
  // Shared Builds & Alternatives
  createSharedBuild,
  getSharedBuildByShareId,
  getSmartAlternatives,
  // Admin stats
  getAdminDashboardStats,
} = require('./database');
const {
  verifyPassword,
  generateToken,
  authenticateToken,
  optionalAuth,
  requireAdmin,
} = require('./auth');
const { searchPrices } = require('./services/priceProviders');
const { searchImages } = require('./services/imageProviders');
const aiRoutes = require('./ai/routes');

const router = express.Router();

// Mount AI Assistant routes
router.use('/ai', aiRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'NEON RIG PC Builder API is healthy and database connected.', timestamp: new Date().toISOString() });
});

// Currency formatter for consistent pricing (INR)
const INR_FORMATTER = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const fmtMoney = (n) => INR_FORMATTER.format(Number(n) || 0);

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

router.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    const user = await createUser({ name, email, password, role: 'USER' });
    const token = generateToken({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      message: 'Registration successful!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed.', details: String(err) });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = verifyPassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = generateToken({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });

    res.json({
      message: 'Login successful!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.', details: String(err) });
  }
});

router.get('/auth/me', authenticateToken, async (req, res) => {
  try {
    const userProfile = await getUserProfileWithStats(req.user.id);
    if (!userProfile) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(userProfile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile.', details: String(err) });
  }
});

router.get('/users/me', authenticateToken, async (req, res) => {
  try {
    const userProfile = await getUserProfileWithStats(req.user.id);
    if (!userProfile) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(userProfile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user.', details: String(err) });
  }
});

// ==========================================
// USER BUILDS ROUTES
// ==========================================

router.get('/builds', authenticateToken, async (req, res) => {
  try {
    const builds = await getBuildsByUserId(req.user.id);
    res.json(builds);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch builds.', details: String(err) });
  }
});

router.post('/builds', authenticateToken, async (req, res) => {
  try {
    const {
      build_name = 'Custom PC Build',
      cpu_id,
      gpu_id,
      motherboard_id,
      ram_id,
      storage_id,
      psu_id,
      case_id,
      total_price = 0,
      compatibility_status = 'VALID',
      performance_score = 0,
    } = req.body || {};

    const created = await createBuild({
      user_id: req.user.id,
      build_name,
      cpu_id: cpu_id ? Number(cpu_id) : null,
      gpu_id: gpu_id ? Number(gpu_id) : null,
      motherboard_id: motherboard_id ? Number(motherboard_id) : null,
      ram_id: ram_id ? Number(ram_id) : null,
      storage_id: storage_id ? Number(storage_id) : null,
      psu_id: psu_id ? Number(psu_id) : null,
      case_id: case_id ? Number(case_id) : null,
      total_price: Number(total_price) || 0,
      compatibility_status,
      performance_score: Number(performance_score) || 0,
    });

    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save build.', details: String(err) });
  }
});

router.get('/builds/:id', optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const build = await getBuildById(id);
    if (!build) return res.status(404).json({ error: 'Build not found.' });
    res.json(build);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch build.', details: String(err) });
  }
});

router.put('/builds/:id', authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const isAdmin = req.user.role === 'ADMIN';
    const updated = await updateBuild(id, req.user.id, req.body || {}, isAdmin);
    if (!updated) return res.status(404).json({ error: 'Build not found or permission denied.' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update build.', details: String(err) });
  }
});

router.delete('/builds/:id', authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const isAdmin = req.user.role === 'ADMIN';
    const ok = await deleteBuild(id, req.user.id, isAdmin);
    if (!ok) return res.status(404).json({ error: 'Build not found or permission denied.' });
    res.json({ success: true, message: 'Build deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete build.', details: String(err) });
  }
});

// ==========================================
// SHARED BUILDS ROUTES
// ==========================================

router.post('/builds/share', optionalAuth, async (req, res) => {
  try {
    const buildData = req.body || {};
    const shared = await createSharedBuild(buildData);
    res.status(201).json({
      success: true,
      share_id: shared.share_id,
      share_url: `/?share=${shared.share_id}`,
      build: shared,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create share link.', details: String(err) });
  }
});

router.get('/builds/share/:shareId', async (req, res) => {
  try {
    const shareId = req.params.shareId;
    const build = await getSharedBuildByShareId(shareId);
    if (!build) return res.status(404).json({ error: 'Shared PC Build not found or link has expired.' });
    
    // Sanitize response to only expose public build data
    delete build.user_id;
    delete build.user_email;
    delete build.user_name;

    res.json(build);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch shared build.', details: String(err) });
  }
});

// ==========================================
// SMART ALTERNATIVES ROUTE
// ==========================================

router.get('/components/:id/alternatives', async (req, res) => {
  try {
    const id = Number(req.params.id);
    let selectedMap = {};
    if (req.query.selected) {
      try { selectedMap = JSON.parse(req.query.selected); } catch {}
    }
    const budget = req.query.budget ? Number(req.query.budget) : null;
    const alternatives = await getSmartAlternatives(id, selectedMap, budget);
    res.json(alternatives);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch smart alternatives.', details: String(err) });
  }
});

// ==========================================
// BILLS / INVOICES ROUTES
// ==========================================

router.get('/bills', authenticateToken, async (req, res) => {
  try {
    const bills = await getBillsByUserId(req.user.id);
    res.json(bills);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bills.', details: String(err) });
  }
});

router.post('/bills', authenticateToken, async (req, res) => {
  try {
    const { build_id, items = [], discount = 0 } = req.body || {};
    
    // If build_id is given but items is empty, reconstruct items from the build
    let billItems = items;
    if ((!billItems || billItems.length === 0) && build_id) {
      const build = await getBuildById(Number(build_id));
      if (build) {
        billItems = [];
        if (build.cpu_name) billItems.push({ component_type: 'CPU', component_id: build.cpu_id, component_name: build.cpu_name, unit_price: build.cpu_price, quantity: 1, total_price: build.cpu_price });
        if (build.gpu_name) billItems.push({ component_type: 'GPU', component_id: build.gpu_id, component_name: build.gpu_name, unit_price: build.gpu_price, quantity: 1, total_price: build.gpu_price });
        if (build.motherboard_name) billItems.push({ component_type: 'Motherboard', component_id: build.motherboard_id, component_name: build.motherboard_name, unit_price: build.motherboard_price, quantity: 1, total_price: build.motherboard_price });
        if (build.ram_name) billItems.push({ component_type: 'RAM', component_id: build.ram_id, component_name: build.ram_name, unit_price: build.ram_price, quantity: 1, total_price: build.ram_price });
        if (build.storage_name) billItems.push({ component_type: 'Storage', component_id: build.storage_id, component_name: build.storage_name, unit_price: build.storage_price, quantity: 1, total_price: build.storage_price });
        if (build.psu_name) billItems.push({ component_type: 'PSU', component_id: build.psu_id, component_name: build.psu_name, unit_price: build.psu_price, quantity: 1, total_price: build.psu_price });
        if (build.case_name) billItems.push({ component_type: 'Case', component_id: build.case_id, component_name: build.case_name, unit_price: build.case_price, quantity: 1, total_price: build.case_price });
      }
    }

    if (!billItems || billItems.length === 0) {
      return res.status(400).json({ error: 'Cannot generate bill: No items specified.' });
    }

    const createdBill = await createBill({
      user_id: req.user.id,
      build_id: build_id ? Number(build_id) : null,
      items: billItems,
      discount: Number(discount) || 0,
      status: 'PAID',
    });

    res.status(201).json(createdBill);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate bill.', details: String(err) });
  }
});

router.get('/bills/:id', optionalAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const bill = await getBillById(id);
    if (!bill) return res.status(404).json({ error: 'Bill not found.' });
    
    // Check ownership if user is authenticated and not admin
    if (req.user && req.user.role !== 'ADMIN' && bill.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied to this invoice.' });
    }
    
    res.json(bill);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bill.', details: String(err) });
  }
});

// ==========================================
// WISHLIST ROUTES
// ==========================================

router.get('/wishlist', authenticateToken, async (req, res) => {
  try {
    const list = await getWishlistByUserId(req.user.id);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch wishlist.', details: String(err) });
  }
});

router.get('/wishlist/ids', authenticateToken, async (req, res) => {
  try {
    const ids = await getWishlistIdsByUserId(req.user.id);
    res.json(ids);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch wishlist IDs.', details: String(err) });
  }
});

router.post('/wishlist', authenticateToken, async (req, res) => {
  try {
    const { component_id } = req.body || {};
    if (!component_id) return res.status(400).json({ error: 'component_id is required.' });
    const result = await addToWishlist(req.user.id, Number(component_id));
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add to wishlist.', details: String(err) });
  }
});

router.delete('/wishlist/:componentId', authenticateToken, async (req, res) => {
  try {
    const componentId = Number(req.params.componentId);
    const result = await removeFromWishlist(req.user.id, componentId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove from wishlist.', details: String(err) });
  }
});

// ==========================================
// PRICE HISTORY ROUTE
// ==========================================

router.get('/components/:id/price-history', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const history = await getPriceHistoryByComponentId(id);
    if (!history) return res.status(404).json({ error: 'Component price history not found.' });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch price history.', details: String(err) });
  }
});

// ==========================================
// ADMIN DASHBOARD & ANALYTICS ROUTES (PROTECTED)
// ==========================================

router.get('/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const stats = await getAdminDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch admin stats.', details: String(err) });
  }
});

router.get('/admin/analytics', requireAdmin, async (req, res) => {
  try {
    const stats = await getAdminDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics.', details: String(err) });
  }
});

router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users.', details: String(err) });
  }
});

router.get('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const profile = await getUserProfileWithStats(id);
    if (!profile) return res.status(404).json({ error: 'User not found.' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user details.', details: String(err) });
  }
});

router.get('/admin/users/:id/builds', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const builds = await getBuildsByUserId(id);
    res.json(builds);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user builds.', details: String(err) });
  }
});

router.put('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, role } = req.body || {};
    const updated = await updateUser(id, { name, role });
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user.', details: String(err) });
  }
});

router.delete('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own admin account.' });
    }
    const ok = await deleteUser(id);
    if (!ok) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, message: 'User deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user.', details: String(err) });
  }
});

router.get('/admin/builds', requireAdmin, async (req, res) => {
  try {
    const builds = await getAllBuilds();
    res.json(builds);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch admin builds.', details: String(err) });
  }
});

router.get('/admin/bills', requireAdmin, async (req, res) => {
  try {
    const bills = await getAllBills();
    res.json(bills);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch admin bills.', details: String(err) });
  }
});

router.get('/admin/reports', requireAdmin, async (req, res) => {
  try {
    const stats = await getAdminDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reports.', details: String(err) });
  }
});

// ==========================================
// CATEGORIES & COMPONENTS (PRESERVED)
// ==========================================

router.get('/categories', async (req, res) => {
  try {
    const cats = await listCategories();
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories', details: String(err) });
  }
});

router.get('/components', async (req, res) => {
  try {
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
    const items = await getAllComponents(categoryId);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch components', details: String(err) });
  }
});

router.get('/components/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await getComponentById(id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch component', details: String(err) });
  }
});

router.post('/components', requireAdmin, async (req, res) => {
  try {
    const { name, category_id, price, specs, socket, image_url } = req.body;
    if (!name || !category_id || price === undefined) {
      return res.status(400).json({ error: 'name, category_id and price are required' });
    }
    const created = await createComponent({ name, category_id, price: Number(price), specs, socket, image_url });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create component', details: String(err) });
  }
});

router.put('/components/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updated = await updateComponent(id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update component', details: String(err) });
  }
});

router.delete('/components/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await deleteComponent(id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, message: 'Component deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete component', details: String(err) });
  }
});

// ==========================================
// PRICE & IMAGE SEARCH (PRESERVED)
// ==========================================

router.get('/price-search', async (req, res) => {
  try {
    const q = String(req.query.query || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing query' });
    const offers = await searchPrices(q);
    res.json({ query: q, offers });
  } catch (err) {
    res.status(500).json({ error: 'Failed to search prices', details: String(err) });
  }
});

router.get('/components/:id/prices', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const comp = await getComponentById(id);
    if (!comp) return res.status(404).json({ error: 'Not found' });
    const q = comp.name;
    const offers = await searchPrices(q);
    res.json({ id, name: comp.name, offers });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch component prices', details: String(err) });
  }
});

router.get('/images/search', async (req, res) => {
  try {
    const q = String(req.query.query || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing query' });
    const images = await searchImages(q);
    res.json({ query: q, images });
  } catch (err) {
    res.status(500).json({ error: 'Failed to search images', details: String(err) });
  }
});

router.get('/components/:id/images', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const comp = await getComponentById(id);
    if (!comp) return res.status(404).json({ error: 'Not found' });
    const q = `${comp.name} ${comp.category_name || ''}`.trim();
    const images = await searchImages(q);
    res.json({ id, name: comp.name, images });
  } catch (err) {
    res.status(500).json({ error: 'Failed to search images for component', details: String(err) });
  }
});

router.post('/images/autofill', requireAdmin, async (req, res) => {
  try {
    const items = await getAllComponents(null);
    const missing = items.filter(c => !c.image_url);
    const results = [];
    let updated = 0;
    for (const c of missing) {
      const q = `${c.name} ${c.category_name || ''}`.trim();
      try {
        const imgs = await searchImages(q);
        const first = imgs && imgs[0];
        if (first && first.url) {
          await updateComponent(c.id, { image_url: first.url });
          updated++;
          results.push({ id: c.id, name: c.name, image_url: first.url, source: first.source || null });
        } else {
          results.push({ id: c.id, name: c.name, skipped: true });
        }
      } catch (e) {
        results.push({ id: c.id, name: c.name, error: String(e) });
      }
    }
    res.json({ total: items.length, missing: missing.length, updated, results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to autofill images', details: String(err) });
  }
});

// ==========================================
// ==========================================
// COMPREHENSIVE SMART COMPATIBILITY ENGINE
// ==========================================

const compat = loadCompatibility();

function getField(comp, field) {
  if (!comp) return undefined;
  if (field in comp) return comp[field];
  return comp.specs ? comp.specs[field] : undefined;
}

async function validateBuild(selectedMap = {}, budget = null) {
  const result = {
    success: true,
    level: 'VALID', // 'VALID' | 'WARNING' | 'CRITICAL'
    totalPrice: 0,
    budgetExceeded: false,
    budgetDiff: 0,
    issues: [],
    warnings: [],
    subchecks: {
      cpu_mobo: { status: 'ok', label: 'CPU + Motherboard', detail: 'Compatible' },
      ram_mobo: { status: 'ok', label: 'RAM + Motherboard', detail: 'Compatible' },
      gpu_psu: { status: 'ok', label: 'GPU + PSU', detail: 'Adequate' },
      storage_mobo: { status: 'ok', label: 'Storage + Motherboard', detail: 'M.2 NVMe / SATA Compatible' },
      case_mobo: { status: 'ok', label: 'Case + Motherboard', detail: 'Form Factor Compatible' }
    },
    suggestedFixes: []
  };

  const MIN_BUDGET_INR = 20000;
  if (typeof budget === 'number' && budget > 0 && budget < MIN_BUDGET_INR) {
    result.success = false;
    result.level = 'CRITICAL';
    result.issues.push(`Minimum budget of ${fmtMoney(MIN_BUDGET_INR)} required.`);
    return result;
  }

  const ids = Object.values(selectedMap).filter(Boolean);
  const comps = await getComponentsByIds(ids);
  const byCategory = {};
  for (const c of comps) {
    byCategory[c.category_name] = c;
  }

  result.totalPrice = comps.reduce((sum, c) => sum + (Number(c.price) || 0), 0);

  // 1. Check Budget Overspend
  if (typeof budget === 'number' && budget > 0 && result.totalPrice > budget) {
    result.budgetExceeded = true;
    result.budgetDiff = result.totalPrice - budget;
    result.warnings.push(`Current build (${fmtMoney(result.totalPrice)}) exceeds your selected budget (${fmtMoney(budget)}) by ${fmtMoney(result.budgetDiff)}.`);
    if (result.level !== 'CRITICAL') result.level = 'WARNING';
  }

  const cpu = byCategory['CPU'];
  const mobo = byCategory['Motherboard'];
  const ram = byCategory['RAM'];
  const gpu = byCategory['GPU'];
  const psu = byCategory['PSU'];
  const pcCase = byCategory['Case'];

  // 2. CPU <-> Motherboard Socket Check
  if (cpu && mobo) {
    if (cpu.socket && mobo.socket && String(cpu.socket).toLowerCase() !== String(mobo.socket).toLowerCase()) {
      result.success = false;
      result.level = 'CRITICAL';
      const issueMsg = `CPU "${cpu.name}" uses ${cpu.socket} socket, but Motherboard "${mobo.name}" supports ${mobo.socket}. (Recommended: ${cpu.socket} motherboard)`;
      result.issues.push(issueMsg);
      result.subchecks.cpu_mobo = {
        status: 'error',
        label: 'CPU + Motherboard',
        detail: `Socket Mismatch (${cpu.socket} vs ${mobo.socket})`
      };

      // Find compatible motherboard recommendation
      const allMobos = await getAllComponents(2); // Category 2 = Motherboard
      const compMobo = allMobos.find(m => m.socket === cpu.socket);
      if (compMobo) {
        result.suggestedFixes.push({
          category: 'Motherboard',
          currentName: mobo.name,
          replaceWithId: compMobo.id,
          replaceWithName: compMobo.name,
          replaceWithPrice: compMobo.price,
          reason: `Matches ${cpu.socket} socket for ${cpu.name}`
        });
      }
    } else if (cpu.socket && mobo.socket) {
      result.subchecks.cpu_mobo = {
        status: 'ok',
        label: 'CPU + Motherboard',
        detail: `Socket Match (${cpu.socket})`
      };
    }
  } else {
    result.subchecks.cpu_mobo = {
      status: 'ok',
      label: 'CPU + Motherboard',
      detail: cpu ? `Socket ${cpu.socket}` : (mobo ? `Socket ${mobo.socket}` : 'Awaiting Selection')
    };
  }

  // 3. RAM <-> Motherboard Memory Type Check (DDR4 vs DDR5)
  if (ram && mobo) {
    const mDdr = mobo.specs?.memory_type ? String(mobo.specs.memory_type).toUpperCase() : '';
    const rDdr = ram.specs?.type ? String(ram.specs.type).toUpperCase() : '';
    if (mDdr && rDdr && mDdr !== rDdr) {
      result.success = false;
      result.level = 'CRITICAL';
      const issueMsg = `Selected RAM "${ram.name}" is ${rDdr}, but Motherboard "${mobo.name}" requires ${mDdr}.`;
      result.issues.push(issueMsg);
      result.subchecks.ram_mobo = {
        status: 'error',
        label: 'RAM + Motherboard',
        detail: `RAM Generation Mismatch (${rDdr} vs ${mDdr})`
      };

      // Find compatible RAM recommendation
      const allRams = await getAllComponents(5); // Category 5 = RAM
      const compRam = allRams.find(r => String(r.specs?.type).toUpperCase() === mDdr);
      if (compRam) {
        result.suggestedFixes.push({
          category: 'RAM',
          currentName: ram.name,
          replaceWithId: compRam.id,
          replaceWithName: compRam.name,
          replaceWithPrice: compRam.price,
          reason: `Matches ${mDdr} required by ${mobo.name}`
        });
      }
    } else if (mDdr && rDdr) {
      result.subchecks.ram_mobo = {
        status: 'ok',
        label: 'RAM + Motherboard',
        detail: `Memory Generation Match (${mDdr})`
      };
    }
  } else {
    result.subchecks.ram_mobo = {
      status: 'ok',
      label: 'RAM + Motherboard',
      detail: mobo?.specs?.memory_type ? `Requires ${mobo.specs.memory_type}` : 'Awaiting Selection'
    };
  }

  // 4. GPU <-> PSU Power Consumption & Headroom
  let cpuWatts = 65;
  if (cpu) {
    if (cpu.name.includes('12900K') || cpu.name.includes('13700K')) cpuWatts = 125;
    else if (cpu.name.includes('5900X') || cpu.name.includes('7700X') || cpu.name.includes('5800X')) cpuWatts = 105;
  }

  let gpuWatts = 0;
  let gpuNeed = 0;
  if (gpu) {
    gpuNeed = Number(gpu.specs?.recommended_psu_watts || 500);
    gpuWatts = Math.round(gpuNeed / 2.2);
  }

  const totalWatts = cpuWatts + gpuWatts + 50 + 10 + 8 + 30;
  const recPsuWatts = Math.max(450, Math.ceil((totalWatts + 150) / 50) * 50);

  if (gpu && psu) {
    const psuHave = Number(psu.specs?.wattage || 0);
    if (psuHave > 0 && psuHave < totalWatts) {
      result.success = false;
      result.level = 'CRITICAL';
      const issueMsg = `PSU capacity (${psuHave}W) is insufficient for estimated system power consumption (${totalWatts}W). Minimum ${recPsuWatts}W recommended.`;
      result.issues.push(issueMsg);
      result.subchecks.gpu_psu = {
        status: 'error',
        label: 'GPU + PSU',
        detail: `PSU Insufficient (${psuHave}W < ${totalWatts}W)`
      };

      const allPsus = await getAllComponents(4); // Category 4 = PSU
      const compPsu = allPsus.find(p => Number(p.specs?.wattage) >= recPsuWatts);
      if (compPsu) {
        result.suggestedFixes.push({
          category: 'PSU',
          currentName: psu.name,
          replaceWithId: compPsu.id,
          replaceWithName: compPsu.name,
          replaceWithPrice: compPsu.price,
          reason: `Provides ${compPsu.specs?.wattage}W for system stability`
        });
      }
    } else if (psuHave > 0 && (psuHave < recPsuWatts || psuHave < gpuNeed)) {
      const warnMsg = `PSU capacity (${psuHave}W) is close to power limit. Manufacturer recommends ${Math.max(recPsuWatts, gpuNeed)}W+ for transient spikes.`;
      result.warnings.push(warnMsg);
      result.subchecks.gpu_psu = {
        status: 'warn',
        label: 'GPU + PSU',
        detail: `PSU Near Limit (${psuHave}W)`
      };
      if (result.level !== 'CRITICAL') result.level = 'WARNING';
    } else if (psuHave > 0) {
      result.subchecks.gpu_psu = {
        status: 'ok',
        label: 'GPU + PSU',
        detail: `PSU Adequate (${psuHave}W with ample headroom)`
      };
    }
  } else {
    result.subchecks.gpu_psu = {
      status: 'ok',
      label: 'GPU + PSU',
      detail: gpu ? `Estimated ${totalWatts}W (Rec ${recPsuWatts}W+)` : 'Awaiting Selection'
    };
  }

  // 5. Motherboard <-> Case Form Factor Check
  if (mobo && pcCase) {
    const mName = mobo.name.toUpperCase();
    const cName = pcCase.name.toUpperCase();
    if (cName.includes('NR200') || cName.includes('ITX')) {
      if (mName.includes('ATX') && !mName.includes('ITX')) {
        result.success = false;
        result.level = 'CRITICAL';
        result.issues.push(`Motherboard "${mobo.name}" (ATX) cannot fit into compact Mini-ITX case "${pcCase.name}".`);
        result.subchecks.case_mobo = {
          status: 'error',
          label: 'Case + Motherboard',
          detail: 'Form Factor Mismatch (ATX in ITX Case)'
        };
      }
    } else {
      result.subchecks.case_mobo = {
        status: 'ok',
        label: 'Case + Motherboard',
        detail: 'Form Factor Compatible'
      };
    }
  }

  result.success = result.issues.length === 0;
  return result;
}

router.post('/build/validate', async (req, res) => {
  try {
    const { selected = {}, budget = null } = req.body || {};
    const result = await validateBuild(selected, typeof budget === 'number' ? budget : null);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to validate build', details: String(err) });
  }
});

// ==========================================
// BUILD SUGGESTION HEURISTIC (PRESERVED)
// ==========================================

function getWeights(purpose) {
  const presets = {
    gaming:      { GPU: 50, CPU: 20, Motherboard: 10, RAM: 8,  Storage: 7,  PSU: 4, Case: 1 },
    workstation: { GPU: 25, CPU: 30, Motherboard: 12, RAM: 14, Storage: 12, PSU: 5, Case: 2 },
    balanced:    { GPU: 35, CPU: 25, Motherboard: 12, RAM: 10, Storage: 12, PSU: 5, Case: 1 },
    office:      { GPU: 5,  CPU: 30, Motherboard: 15, RAM: 20, Storage: 20, PSU: 8, Case: 2 },
    coders:      { GPU: 20, CPU: 30, Motherboard: 12, RAM: 18, Storage: 15, PSU: 4, Case: 1 },
  };
  return presets[purpose] || presets.balanced;
}

function normalizePurpose(p) {
  const s = String(p || '').toLowerCase().trim();
  if (s.includes('office')) return 'office';
  if (s.includes('coder') || s.includes('dev') || s.includes('program')) return 'coders';
  if (s.includes('game')) return 'gaming';
  if (s.includes('work')) return 'workstation';
  if (!s) return 'balanced';
  return s;
}

function groupByCategoryName(items) {
  const out = {};
  for (const it of items) {
    const k = it.category_name;
    if (!out[k]) out[k] = [];
    out[k].push(it);
  }
  return out;
}

function pickBestUnder(list, target) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const under = list.filter(item => Number(item.price) <= target);
  if (under.length > 0) {
    return under.sort((a, b) => Number(b.price) - Number(a.price))[0];
  }
  return [...list].sort((a, b) => Number(a.price) - Number(b.price))[0];
}

function pickCheapest(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return [...list].sort((a, b) => Number(a.price) - Number(b.price))[0];
}

function chooseCpuMobo(cpus, mobos, cpuTarget, moboTarget, opts = {}) {
  const preferAPU = !!opts.preferAPU;
  const pairs = [];
  const target = (cpuTarget || 0) + (moboTarget || 0);

  for (const cpu of cpus || []) {
    for (const mb of (mobos || []).filter(m => m.socket && cpu.socket && m.socket === cpu.socket)) {
      const price = Number(cpu.price) + Number(mb.price);
      const isAPU = /\b(\d+G)\b/i.test(cpu.name) || /apu/i.test(cpu.name);
      const diff = Math.abs(price - target);
      const penalty = price > target ? (price - target) * 1.5 : 0;
      const apuBonus = preferAPU ? (isAPU ? -5000 : 3000) : 0;
      const score = diff + penalty + apuBonus;
      pairs.push({ cpu, mb, price, score });
    }
  }
  if (pairs.length === 0) return { cpu: pickCheapest(cpus), mb: pickCheapest(mobos) };
  const byScore = pairs.sort((a, b) => a.score - b.score);
  return { cpu: byScore[0].cpu, mb: byScore[0].mb };
}

router.post('/build/suggest', async (req, res) => {
  try {
    const { budget = 100000, purpose = 'balanced' } = req.body || {};
    const normPurpose = normalizePurpose(purpose);
    const weights = getWeights(normPurpose);

    const budgetFactor = normPurpose === 'office' ? 0.7 : normPurpose === 'coders' ? 0.85 : 1.0;
    const effBudget = Math.min(Number(budget) || 0, Math.round((Number(budget) || 0) * budgetFactor));

    const allComponents = await getAllComponents(null);
    const compsByCat = groupByCategoryName(allComponents);

    const gpuTarget = (weights.GPU || 0) / 100 * effBudget;
    const cpuTarget = (weights.CPU || 0) / 100 * effBudget;
    const mbTarget  = (weights.Motherboard || 0) / 100 * effBudget;
    const ramTarget = (weights.RAM || 0) / 100 * effBudget;
    const psuTarget = (weights.PSU || 0) / 100 * effBudget;
    const stoTarget = (weights.Storage || 0) / 100 * effBudget;
    const caseTarget = (weights.Case || 0) / 100 * effBudget;

    const result = { selected: {}, notes: [], purpose: normPurpose, budget, effectiveBudget: effBudget, weights, issues: [], totalPrice: 0 };

    const preferAPU = normPurpose === 'office';
    const cpuMobo = chooseCpuMobo(compsByCat['CPU'], compsByCat['Motherboard'], cpuTarget, mbTarget, { preferAPU });
    if (cpuMobo.cpu) result.selected['CPU'] = cpuMobo.cpu.id; else result.notes.push('No CPU available');
    if (cpuMobo.mb) result.selected['Motherboard'] = cpuMobo.mb.id; else result.notes.push('No Motherboard available');

    let gpu = null;
    const cpuIsAPU = cpuMobo.cpu && (/\b(\d+G)\b/i.test(cpuMobo.cpu.name) || /apu/i.test(cpuMobo.cpu.name));
    if (normPurpose === 'office' && cpuIsAPU) {
      // skip GPU
    } else {
      const gpuList = compsByCat['GPU'] || [];
      if (normPurpose === 'office') {
        const byWattThenPrice = [...gpuList].sort((a, b) => (Number(a.specs?.recommended_psu_watts || 9999) - Number(b.specs?.recommended_psu_watts || 9999)) || (Number(a.price) - Number(b.price)));
        gpu = pickBestUnder(byWattThenPrice, gpuTarget) || byWattThenPrice[0];
      } else if (normPurpose === 'gaming') {
        gpu = pickBestUnder(gpuList, gpuTarget) || pickCheapest(gpuList);
      } else {
        gpu = pickBestUnder(gpuList, gpuTarget) || pickCheapest(gpuList);
      }
      if (gpu) result.selected['GPU'] = gpu.id; else result.notes.push('No GPU available');
    }

    let ram = null;
    let mbSpecs = (cpuMobo.mb && cpuMobo.mb.specs) || {};
    const needType = (mbSpecs && mbSpecs.memory_type) ? String(mbSpecs.memory_type).toUpperCase() : null;
    const ramList = (compsByCat['RAM'] || []).filter(r => !needType || (r.specs && String(r.specs.type).toUpperCase() === needType));
    ram = pickBestUnder(ramList, ramTarget) || pickCheapest(ramList) || pickCheapest(compsByCat['RAM']);
    if (ram) result.selected['RAM'] = ram.id; else result.notes.push('No RAM available');

    const storageCandidates = (compsByCat['Storage'] || []).filter(s => {
      const iface = s.specs && String(s.specs.interface || '');
      const cap = s.specs && Number(s.specs.capacity_gb || 0);
      return (iface.toUpperCase() === 'NVME') && cap >= 1000;
    });
    const storage = pickBestUnder(storageCandidates, stoTarget) || pickCheapest(storageCandidates) || pickCheapest(compsByCat['Storage']);
    if (storage) result.selected['Storage'] = storage.id;

    let needWatts = 0;
    if (gpu && gpu.specs && Number(gpu.specs.recommended_psu_watts)) needWatts = Number(gpu.specs.recommended_psu_watts);
    const psuCandidates = (compsByCat['PSU'] || []).filter(p => Number(p.specs && p.specs.wattage) >= needWatts);
    const psu = pickBestUnder(psuCandidates, psuTarget) || pickCheapest(psuCandidates) || pickCheapest(compsByCat['PSU']);
    if (psu) result.selected['PSU'] = psu.id; else result.notes.push('No PSU available');

    const pcCase = pickBestUnder(compsByCat['Case'], caseTarget) || pickCheapest(compsByCat['Case']);
    if (pcCase) result.selected['Case'] = pcCase.id;

    const ids = Object.values(result.selected).filter(Boolean);
    const chosen = await getComponentsByIds(ids);
    result.totalPrice = chosen.reduce((s, c) => s + Number(c.price || 0), 0);

    const validation = await validateBuild(result.selected, budget);
    result.issues = validation.issues || [];
    result.success = validation.success;
    result.budgetExceeded = validation.budgetExceeded || (result.totalPrice > (Number(budget) || 0));

    const byCat = {};
    for (const c of chosen) byCat[c.category_name] = c;
    const lines = [];
    lines.push(`Purpose: ${result.purpose} — using ${fmtMoney(result.effectiveBudget)} of your ${fmtMoney(result.budget)} budget.`);
    lines.push(`Budget allocation by category: ${Object.entries(result.weights).map(([k, v]) => `${k} ${v}%`).join(', ')}.`);

    if (byCat['CPU'] && byCat['Motherboard']) {
      lines.push(`CPU ${byCat['CPU'].name} with ${byCat['Motherboard'].name} because their sockets match (${byCat['CPU'].socket}).`);
    } else if (byCat['CPU']) {
      lines.push(`CPU ${byCat['CPU'].name} selected to fit target spend.`);
    }

    if (normPurpose === 'office' && cpuIsAPU && !byCat['GPU']) {
      lines.push(`No discrete GPU selected to maximize efficiency and reduce cost (APU provides integrated graphics).`);
    } else if (byCat['GPU']) {
      const needW = Number(byCat['GPU'].specs?.recommended_psu_watts || 0);
      lines.push(`GPU ${byCat['GPU'].name} chosen to match purpose within budget${needW ? `, requiring ~${needW}W PSU` : ''}.`);
    }

    if (byCat['RAM'] && byCat['Motherboard']) {
      const rType = byCat['RAM'].specs?.type;
      const mType = byCat['Motherboard'].specs?.memory_type;
      if (rType && mType) lines.push(`RAM type ${rType} matches motherboard memory type ${mType}.`);
    }

    if (byCat['PSU'] && byCat['GPU']) {
      const need = Number(byCat['GPU'].specs?.recommended_psu_watts || 0);
      const have = Number(byCat['PSU'].specs?.wattage || 0);
      if (need && have) lines.push(`PSU ${have}W meets or exceeds GPU recommended ${need}W.`);
    } else if (byCat['PSU']) {
      lines.push(`PSU selected conservatively to balance efficiency and headroom.`);
    }

    if (byCat['Storage']) {
      const iface = byCat['Storage'].specs?.interface;
      const cap = byCat['Storage'].specs?.capacity_gb;
      if (iface) lines.push(`Storage favors ${iface} for responsiveness${cap ? `, capacity ${cap}GB` : ''}.`);
    }

    lines.push(`Estimated total: ${fmtMoney(result.totalPrice)}${result.budgetExceeded ? ' (over budget)' : ''}.`);
    if (result.issues?.length) lines.push(`Compatibility check surfaced ${result.issues.length} issue(s). You can tweak parts in the UI.`);
    result.summary = lines.join('\n');

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to suggest build', details: String(err) });
  }
});

module.exports = router;
