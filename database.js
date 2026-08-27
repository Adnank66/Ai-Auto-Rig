const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { hashPassword } = require('./auth');

const dbFile = process.env.DB_FILE || path.join(__dirname, '../data/pcbuilder.db');
const schemaPath = path.join(__dirname, '../data/schema.sql');
const compatPath = path.join(__dirname, '../data/compatibility.json');

let db;

function getDb() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }
    
    db = new sqlite3.Database(dbFile, (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Enable WAL and foreign keys
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA foreign_keys = ON');
      resolve(db);
    });
  });
}

/**
 * Execute schema and run safe migrations & default seeding
 */
async function ensureSchema() {
  const database = await getDb();
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  
  // Run base schema
  await new Promise((resolve, reject) => {
    database.exec(sql, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  // Ensure tables exist
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'USER',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  const createBuildsTable = `
    CREATE TABLE IF NOT EXISTS builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      build_name TEXT NOT NULL,
      cpu_id INTEGER,
      gpu_id INTEGER,
      motherboard_id INTEGER,
      ram_id INTEGER,
      storage_id INTEGER,
      psu_id INTEGER,
      case_id INTEGER,
      total_price REAL NOT NULL,
      compatibility_status TEXT DEFAULT 'VALID',
      performance_score REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `;
  const createBillsTable = `
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      build_id INTEGER,
      bill_number TEXT NOT NULL UNIQUE,
      subtotal REAL NOT NULL,
      tax REAL NOT NULL,
      discount REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      status TEXT DEFAULT 'PAID',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE SET NULL
    );
  `;
  const createBillItemsTable = `
    CREATE TABLE IF NOT EXISTS bill_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      component_type TEXT NOT NULL,
      component_id INTEGER,
      component_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      unit_price REAL NOT NULL,
      total_price REAL NOT NULL,
      FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
    );
  `;
  const createWishlistTable = `
    CREATE TABLE IF NOT EXISTS wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      component_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, component_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE
    );
  `;
  const createPriceHistoryTable = `
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      component_id INTEGER NOT NULL,
      price REAL NOT NULL,
      recorded_date DATE NOT NULL,
      FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE
    );
  `;
  const createSharedBuildsTable = `
    CREATE TABLE IF NOT EXISTS shared_builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      share_id TEXT NOT NULL UNIQUE,
      build_id INTEGER,
      build_name TEXT NOT NULL,
      cpu_id INTEGER,
      gpu_id INTEGER,
      motherboard_id INTEGER,
      ram_id INTEGER,
      storage_id INTEGER,
      psu_id INTEGER,
      case_id INTEGER,
      total_price REAL NOT NULL,
      compatibility_status TEXT DEFAULT 'VALID',
      performance_score REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE SET NULL,
      FOREIGN KEY (cpu_id) REFERENCES components(id) ON DELETE SET NULL,
      FOREIGN KEY (gpu_id) REFERENCES components(id) ON DELETE SET NULL,
      FOREIGN KEY (motherboard_id) REFERENCES components(id) ON DELETE SET NULL,
      FOREIGN KEY (ram_id) REFERENCES components(id) ON DELETE SET NULL,
      FOREIGN KEY (storage_id) REFERENCES components(id) ON DELETE SET NULL,
      FOREIGN KEY (psu_id) REFERENCES components(id) ON DELETE SET NULL,
      FOREIGN KEY (case_id) REFERENCES components(id) ON DELETE SET NULL
    );
  `;

  await new Promise((res, rej) => database.run(createUsersTable, (e) => e ? rej(e) : res()));
  await new Promise((res, rej) => database.run(createBuildsTable, (e) => e ? rej(e) : res()));
  await new Promise((res, rej) => database.run(createBillsTable, (e) => e ? rej(e) : res()));
  await new Promise((res, rej) => database.run(createBillItemsTable, (e) => e ? rej(e) : res()));
  await new Promise((res, rej) => database.run(createWishlistTable, (e) => e ? rej(e) : res()));
  await new Promise((res, rej) => database.run(createPriceHistoryTable, (e) => e ? rej(e) : res()));
  await new Promise((res, rej) => database.run(createSharedBuildsTable, (e) => e ? rej(e) : res()));

  // Seed / update default admin & user accounts
  await seedDefaultUsers(database);
  // Seed price history data
  await seedPriceHistory(database);
}

/**
 * Ensure BOTH admin@pcbuilder.com (admin123) and user@example.com (user123) exist and have valid scrypt password hashes
 */
async function seedDefaultUsers(database) {
  return new Promise((resolve) => {
    const adminPass = hashPassword('admin123');
    const userPass = hashPassword('user123');

    // 1. Admin account
    database.get("SELECT id FROM users WHERE LOWER(email) = 'admin@pcbuilder.com'", [], (err, adminRow) => {
      if (!adminRow) {
        database.run(
          "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
          [1, 'System Administrator', 'admin@pcbuilder.com', adminPass, 'ADMIN'],
          () => {}
        );
      } else {
        database.run("UPDATE users SET password_hash = ? WHERE id = ?", [adminPass, adminRow.id], () => {});
      }

      // 2. Demo User account (user@example.com)
      database.get("SELECT id FROM users WHERE LOWER(email) = 'user@example.com'", [], (err2, userRow) => {
        if (!userRow) {
          database.run(
            "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
            [2, 'Alex Walker', 'user@example.com', userPass, 'USER'],
            (err3) => {
              if (!err3) {
                // Seed initial build & bill for user 2
                const buildQuery = `
                  INSERT OR IGNORE INTO builds (id, user_id, build_name, cpu_id, gpu_id, motherboard_id, ram_id, storage_id, psu_id, case_id, total_price, compatibility_status, performance_score)
                  VALUES (101, 2, 'Cyberpunk Beast Rig', 101, 301, 201, 501, 601, 401, 701, 72000, 'VALID', 92)
                `;
                database.run(buildQuery, [], function() {
                  const billQuery = `
                    INSERT OR IGNORE INTO bills (id, user_id, build_id, bill_number, subtotal, tax, discount, total_amount, status)
                    VALUES (1001, 2, 101, 'PB-2026-0001', 61016.95, 10983.05, 0, 72000.00, 'PAID')
                  `;
                  database.run(billQuery, [], function() {
                    const itemsQuery = `
                      INSERT OR IGNORE INTO bill_items (bill_id, component_type, component_id, component_name, quantity, unit_price, total_price)
                      VALUES 
                        (1001, 'CPU', 101, 'Intel Core i5-12400', 1, 14400, 14400),
                        (1001, 'GPU', 301, 'NVIDIA GeForce RTX 3060 12GB', 1, 25600, 25600),
                        (1001, 'Motherboard', 201, 'ASUS TUF Gaming B660-PLUS WIFI D4', 1, 12000, 12000),
                        (1001, 'RAM', 501, 'G.Skill Ripjaws V 16GB (2x8GB) DDR4-3200', 1, 4800, 4800),
                        (1001, 'Storage', 601, 'Samsung 970 EVO Plus 1TB NVMe', 1, 6400, 6400),
                        (1001, 'PSU', 401, 'Corsair RM650x (650W) 80+ Gold', 1, 8800, 8800),
                        (1001, 'Case', 701, 'NZXT H510 (ATX Mid Tower)', 1, 6400, 6400)
                    `;
                    database.run(itemsQuery, [], () => resolve());
                  });
                });
              } else {
                resolve();
              }
            }
          );
        } else {
          database.run("UPDATE users SET password_hash = ? WHERE id = ?", [userPass, userRow.id], () => resolve());
        }
      });
    });
  });
}

/**
 * Seed historical price data for all components
 */
async function seedPriceHistory(database) {
  return new Promise((resolve) => {
    database.get("SELECT COUNT(*) as count FROM price_history", [], (err, row) => {
      if (row && row.count > 0) return resolve();

      database.all("SELECT id, price FROM components", [], (cErr, comps) => {
        if (cErr || !comps || comps.length === 0) return resolve();

        const insert = database.prepare("INSERT INTO price_history (component_id, price, recorded_date) VALUES (?, ?, ?)");
        
        comps.forEach(c => {
          const p = Number(c.price);
          // 90 days ago: ~ +4% to +8%
          const p90 = Math.round(p * 1.06);
          // 60 days ago: ~ +2% to +5%
          const p60 = Math.round(p * 1.03);
          // 30 days ago: ~ -1% to +2%
          const p30 = Math.round(p * 0.99);
          // Current
          const pNow = p;

          insert.run(c.id, p90, '2026-05-25');
          insert.run(c.id, p60, '2026-06-25');
          insert.run(c.id, p30, '2026-07-25');
          insert.run(c.id, pNow, '2026-08-25');
        });

        insert.finalize(() => resolve());
      });
    });
  });
}

function parseComponent(row) {
  if (!row) return null;
  let specs = {};
  try {
    specs = row.specs ? (typeof row.specs === 'string' ? JSON.parse(row.specs) : row.specs) : {};
  } catch (e) {
    specs = {};
  }
  return {
    id: row.id,
    name: row.name,
    category_id: row.category_id,
    category_name: row.category_name || undefined,
    price: Number(row.price),
    socket: row.socket,
    image_url: row.image_url || null,
    specs,
  };
}

// ==========================================
// CATEGORIES & COMPONENTS
// ==========================================

async function listCategories() {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    database.all('SELECT id, name FROM categories ORDER BY id', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function getAllComponents(categoryId = null) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    let query, params;
    if (categoryId) {
      query = `SELECT c.*, cat.name as category_name
               FROM components c
               JOIN categories cat ON c.category_id = cat.id
               WHERE c.category_id = ?
               ORDER BY c.price ASC, c.name ASC`;
      params = [categoryId];
    } else {
      query = `SELECT c.*, cat.name as category_name
               FROM components c
               JOIN categories cat ON c.category_id = cat.id
               ORDER BY c.category_id ASC, c.price ASC, c.name ASC`;
      params = [];
    }
    
    database.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(parseComponent));
    });
  });
}

async function getComponentById(id) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `SELECT c.*, cat.name as category_name
                   FROM components c
                   JOIN categories cat ON c.category_id = cat.id
                   WHERE c.id = ?`;
    database.get(query, [id], (err, row) => {
      if (err) reject(err);
      else resolve(parseComponent(row));
    });
  });
}

async function createComponent({ name, category_id, price, specs = {}, socket = null, image_url = null }) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `INSERT INTO components (name, category_id, price, specs, socket, image_url)
                   VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [name, category_id, price, JSON.stringify(specs || {}), socket, image_url];
    
    database.run(query, params, function(err) {
      if (err) reject(err);
      else getComponentById(this.lastID).then(resolve).catch(reject);
    });
  });
}

async function updateComponent(id, { name, category_id, price, specs, socket, image_url }) {
  const existing = await getComponentById(id);
  if (!existing) return null;
  
  const newName = name !== undefined ? name : existing.name;
  const newCat = category_id !== undefined ? category_id : existing.category_id;
  const newPrice = price !== undefined ? price : existing.price;
  const newSpecs = specs !== undefined ? specs : existing.specs;
  const newSocket = socket !== undefined ? socket : existing.socket;
  const newImage = image_url !== undefined ? image_url : existing.image_url;

  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `UPDATE components
                   SET name = ?, category_id = ?, price = ?, specs = ?, socket = ?, image_url = ?
                   WHERE id = ?`;
    const params = [newName, newCat, newPrice, JSON.stringify(newSpecs || {}), newSocket, newImage, id];
    
    database.run(query, params, function(err) {
      if (err) reject(err);
      else getComponentById(id).then(resolve).catch(reject);
    });
  });
}

async function deleteComponent(id) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    database.run('DELETE FROM components WHERE id = ?', [id], function(err) {
      if (err) reject(err);
      else resolve(this.changes > 0);
    });
  });
}

async function getComponentsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const placeholders = ids.map(() => '?').join(',');
    const query = `SELECT c.*, cat.name as category_name
                   FROM components c
                   JOIN categories cat ON c.category_id = cat.id
                   WHERE c.id IN (${placeholders})`;
    database.all(query, ids, (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(parseComponent));
    });
  });
}

function loadCompatibility() {
  const text = fs.readFileSync(compatPath, 'utf-8');
  return JSON.parse(text);
}

// ==========================================
// USERS CRUD & AUTH
// ==========================================

async function createUser({ name, email, password, role = 'USER' }) {
  const database = await getDb();
  const password_hash = hashPassword(password);
  return new Promise((resolve, reject) => {
    const query = `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`;
    database.run(query, [name.trim(), email.toLowerCase().trim(), password_hash, role], function(err) {
      if (err) reject(err);
      else {
        getUserById(this.lastID).then(resolve).catch(reject);
      }
    });
  });
}

async function getUserByEmail(email) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    database.get('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

async function getUserById(id) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    database.get('SELECT id, name, email, role, created_at, updated_at FROM users WHERE id = ?', [id], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

async function getAllUsers() {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.role, 
        u.created_at,
        COUNT(DISTINCT b.id) as build_count,
        COUNT(DISTINCT bl.id) as bill_count,
        COALESCE(SUM(bl.total_amount), 0) as total_spent
      FROM users u
      LEFT JOIN builds b ON b.user_id = u.id
      LEFT JOIN bills bl ON bl.user_id = u.id
      GROUP BY u.id
      ORDER BY u.id DESC
    `;
    database.all(query, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function getUserProfileWithStats(userId) {
  const user = await getUserById(userId);
  if (!user) return null;
  const builds = await getBuildsByUserId(userId);
  const bills = await getBillsByUserId(userId);
  const wishlist = await getWishlistByUserId(userId);
  const total_spent = bills.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0);
  return {
    user,
    stats: {
      total_builds: builds.length,
      total_bills: bills.length,
      total_spent,
      wishlist_count: wishlist.length,
    },
    builds,
    bills,
    wishlist
  };
}

async function updateUser(id, { name, role }) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    database.run(query, [name, role, id], function(err) {
      if (err) reject(err);
      else getUserById(id).then(resolve).catch(reject);
    });
  });
}

async function deleteUser(id) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    database.run('DELETE FROM users WHERE id = ?', [id], function(err) {
      if (err) reject(err);
      else resolve(this.changes > 0);
    });
  });
}

// ==========================================
// BUILDS CRUD & SMART SCORE
// ==========================================

function calculateSmartBuildScore(components = [], totalBudget = null) {
  if (!components || components.length === 0) return 0;
  
  const byCat = {};
  components.forEach(c => {
    if (c) byCat[c.category_name || c.category || 'Other'] = c;
  });

  let score = 70; // baseline
  const cpu = byCat['CPU'];
  const gpu = byCat['GPU'];
  const mobo = byCat['Motherboard'];
  const ram = byCat['RAM'];
  const storage = byCat['Storage'];
  const psu = byCat['PSU'];
  const pcCase = byCat['Case'];

  // Check CPU + Mobo socket
  if (cpu && mobo) {
    if (cpu.socket && mobo.socket && cpu.socket === mobo.socket) {
      score += 6;
    } else if (cpu.socket && mobo.socket && cpu.socket !== mobo.socket) {
      score -= 25;
    }
  }

  // Check Mobo + RAM DDR
  if (mobo && ram) {
    const mDdr = mobo.specs?.memory_type ? String(mobo.specs.memory_type).toUpperCase() : '';
    const rDdr = ram.specs?.type ? String(ram.specs.type).toUpperCase() : '';
    if (mDdr && rDdr && mDdr === rDdr) {
      score += 5;
    } else if (mDdr && rDdr && mDdr !== rDdr) {
      score -= 20;
    }
  }

  // Check GPU + PSU Wattage
  if (gpu && psu) {
    const gpuNeed = Number(gpu.specs?.recommended_psu_watts || 0);
    const psuHave = Number(psu.specs?.wattage || 0);
    if (psuHave >= gpuNeed + 100) {
      score += 6;
    } else if (psuHave >= gpuNeed) {
      score += 3;
    } else if (gpuNeed > 0 && psuHave < gpuNeed) {
      score -= 20;
    }
  }

  // RAM capacity check
  if (ram) {
    const cap = Number(ram.specs?.size_gb || 0);
    if (cap >= 32) score += 5;
    else if (cap >= 16) score += 3;
  }

  // Storage NVMe check
  if (storage) {
    const iface = String(storage.specs?.interface || '').toUpperCase();
    if (iface === 'NVME') score += 4;
  }

  // Full 7-part completeness
  const count = [cpu, gpu, mobo, ram, storage, psu, pcCase].filter(Boolean).length;
  if (count === 7) score += 6;
  else if (count >= 5) score += 3;

  return Math.max(45, Math.min(99, Math.round(score)));
}

async function createBuild({
  user_id,
  build_name = 'Custom PC Build',
  cpu_id = null,
  gpu_id = null,
  motherboard_id = null,
  ram_id = null,
  storage_id = null,
  psu_id = null,
  case_id = null,
  total_price = 0,
  compatibility_status = 'VALID',
  performance_score = 0
}) {
  const database = await getDb();
  
  // Calculate smart build score if not provided
  let smartScore = Number(performance_score) || 0;
  if (!smartScore) {
    const partIds = [cpu_id, gpu_id, motherboard_id, ram_id, storage_id, psu_id, case_id].filter(Boolean);
    const comps = await getComponentsByIds(partIds);
    smartScore = calculateSmartBuildScore(comps, total_price);
  }

  return new Promise((resolve, reject) => {
    const query = `
      INSERT INTO builds (
        user_id, build_name, cpu_id, gpu_id, motherboard_id, 
        ram_id, storage_id, psu_id, case_id, total_price, 
        compatibility_status, performance_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      user_id, build_name, cpu_id, gpu_id, motherboard_id,
      ram_id, storage_id, psu_id, case_id, total_price,
      compatibility_status, smartScore
    ];
    database.run(query, params, function(err) {
      if (err) reject(err);
      else getBuildById(this.lastID).then(resolve).catch(reject);
    });
  });
}

async function getBuildById(id) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        b.*,
        u.name as user_name,
        u.email as user_email,
        c_cpu.name as cpu_name, c_cpu.price as cpu_price, c_cpu.socket as cpu_socket, c_cpu.specs as cpu_specs, c_cpu.image_url as cpu_image,
        c_gpu.name as gpu_name, c_gpu.price as gpu_price, c_gpu.specs as gpu_specs, c_gpu.image_url as gpu_image,
        c_mb.name as motherboard_name, c_mb.price as motherboard_price, c_mb.socket as motherboard_socket, c_mb.specs as motherboard_specs, c_mb.image_url as motherboard_image,
        c_ram.name as ram_name, c_ram.price as ram_price, c_ram.specs as ram_specs, c_ram.image_url as ram_image,
        c_sto.name as storage_name, c_sto.price as storage_price, c_sto.specs as storage_specs, c_sto.image_url as storage_image,
        c_psu.name as psu_name, c_psu.price as psu_price, c_psu.specs as psu_specs, c_psu.image_url as psu_image,
        c_case.name as case_name, c_case.price as case_price, c_case.specs as case_specs, c_case.image_url as case_image
      FROM builds b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN components c_cpu ON b.cpu_id = c_cpu.id
      LEFT JOIN components c_gpu ON b.gpu_id = c_gpu.id
      LEFT JOIN components c_mb ON b.motherboard_id = c_mb.id
      LEFT JOIN components c_ram ON b.ram_id = c_ram.id
      LEFT JOIN components c_sto ON b.storage_id = c_sto.id
      LEFT JOIN components c_psu ON b.psu_id = c_psu.id
      LEFT JOIN components c_case ON b.case_id = c_case.id
      WHERE b.id = ?
    `;
    database.get(query, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

async function getBuildsByUserId(userId) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        b.*,
        c_cpu.name as cpu_name, c_cpu.price as cpu_price, c_cpu.socket as cpu_socket, c_cpu.specs as cpu_specs, c_cpu.image_url as cpu_image,
        c_gpu.name as gpu_name, c_gpu.price as gpu_price, c_gpu.specs as gpu_specs, c_gpu.image_url as gpu_image,
        c_mb.name as motherboard_name, c_mb.price as motherboard_price, c_mb.socket as motherboard_socket, c_mb.specs as motherboard_specs, c_mb.image_url as motherboard_image,
        c_ram.name as ram_name, c_ram.price as ram_price, c_ram.specs as ram_specs, c_ram.image_url as ram_image,
        c_sto.name as storage_name, c_sto.price as storage_price, c_sto.specs as storage_specs, c_sto.image_url as storage_image,
        c_psu.name as psu_name, c_psu.price as psu_price, c_psu.specs as psu_specs, c_psu.image_url as psu_image,
        c_case.name as case_name, c_case.price as case_price, c_case.specs as case_specs, c_case.image_url as case_image
      FROM builds b
      LEFT JOIN components c_cpu ON b.cpu_id = c_cpu.id
      LEFT JOIN components c_gpu ON b.gpu_id = c_gpu.id
      LEFT JOIN components c_mb ON b.motherboard_id = c_mb.id
      LEFT JOIN components c_ram ON b.ram_id = c_ram.id
      LEFT JOIN components c_sto ON b.storage_id = c_sto.id
      LEFT JOIN components c_psu ON b.psu_id = c_psu.id
      LEFT JOIN components c_case ON b.case_id = c_case.id
      WHERE b.user_id = ?
      ORDER BY b.id DESC
    `;
    database.all(query, [userId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function getAllBuilds() {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        b.*,
        u.name as user_name,
        u.email as user_email,
        c_cpu.name as cpu_name, c_cpu.price as cpu_price, c_cpu.socket as cpu_socket, c_cpu.specs as cpu_specs, c_cpu.image_url as cpu_image,
        c_gpu.name as gpu_name, c_gpu.price as gpu_price, c_gpu.specs as gpu_specs, c_gpu.image_url as gpu_image,
        c_mb.name as motherboard_name, c_mb.price as motherboard_price, c_mb.socket as motherboard_socket, c_mb.specs as motherboard_specs, c_mb.image_url as motherboard_image,
        c_ram.name as ram_name, c_ram.price as ram_price, c_ram.specs as ram_specs, c_ram.image_url as ram_image,
        c_sto.name as storage_name, c_sto.price as storage_price, c_sto.specs as storage_specs, c_sto.image_url as storage_image,
        c_psu.name as psu_name, c_psu.price as psu_price, c_psu.specs as psu_specs, c_psu.image_url as psu_image,
        c_case.name as case_name, c_case.price as case_price, c_case.specs as case_specs, c_case.image_url as case_image
      FROM builds b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN components c_cpu ON b.cpu_id = c_cpu.id
      LEFT JOIN components c_gpu ON b.gpu_id = c_gpu.id
      LEFT JOIN components c_mb ON b.motherboard_id = c_mb.id
      LEFT JOIN components c_ram ON b.ram_id = c_ram.id
      LEFT JOIN components c_sto ON b.storage_id = c_sto.id
      LEFT JOIN components c_psu ON b.psu_id = c_psu.id
      LEFT JOIN components c_case ON b.case_id = c_case.id
      ORDER BY b.id DESC
    `;
    database.all(query, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function updateBuild(id, userId, data, isAdmin = false) {
  const database = await getDb();
  const existing = await getBuildById(id);
  if (!existing) return null;
  if (!isAdmin && existing.user_id !== userId) return null;

  const build_name = data.build_name ?? existing.build_name;
  const cpu_id = data.cpu_id ?? existing.cpu_id;
  const gpu_id = data.gpu_id ?? existing.gpu_id;
  const motherboard_id = data.motherboard_id ?? existing.motherboard_id;
  const ram_id = data.ram_id ?? existing.ram_id;
  const storage_id = data.storage_id ?? existing.storage_id;
  const psu_id = data.psu_id ?? existing.psu_id;
  const case_id = data.case_id ?? existing.case_id;
  const total_price = data.total_price ?? existing.total_price;
  const compatibility_status = data.compatibility_status ?? existing.compatibility_status;
  const performance_score = data.performance_score ?? existing.performance_score;

  return new Promise((resolve, reject) => {
    const query = `
      UPDATE builds SET
        build_name = ?, cpu_id = ?, gpu_id = ?, motherboard_id = ?,
        ram_id = ?, storage_id = ?, psu_id = ?, case_id = ?,
        total_price = ?, compatibility_status = ?, performance_score = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    const params = [
      build_name, cpu_id, gpu_id, motherboard_id,
      ram_id, storage_id, psu_id, case_id,
      total_price, compatibility_status, performance_score,
      id
    ];
    database.run(query, params, function(err) {
      if (err) reject(err);
      else getBuildById(id).then(resolve).catch(reject);
    });
  });
}

async function deleteBuild(id, userId, isAdmin = false) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    let query = 'DELETE FROM builds WHERE id = ?';
    let params = [id];
    if (!isAdmin) {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    database.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this.changes > 0);
    });
  });
}

// ==========================================
// SHARED BUILDS SYSTEM
// ==========================================

function generateShareId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'NR-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function createSharedBuild(buildData) {
  const database = await getDb();
  const shareId = generateShareId();

  return new Promise((resolve, reject) => {
    const query = `
      INSERT INTO shared_builds (
        share_id, build_id, build_name, cpu_id, gpu_id, motherboard_id,
        ram_id, storage_id, psu_id, case_id, total_price, compatibility_status,
        performance_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      shareId,
      buildData.build_id || null,
      buildData.build_name || 'Custom PC Rig',
      buildData.cpu_id || null,
      buildData.gpu_id || null,
      buildData.motherboard_id || null,
      buildData.ram_id || null,
      buildData.storage_id || null,
      buildData.psu_id || null,
      buildData.case_id || null,
      Number(buildData.total_price) || 0,
      buildData.compatibility_status || 'VALID',
      Number(buildData.performance_score) || 90
    ];

    database.run(query, params, function(err) {
      if (err) reject(err);
      else {
        getSharedBuildByShareId(shareId).then(resolve).catch(reject);
      }
    });
  });
}

async function getSharedBuildByShareId(shareId) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        s.*,
        c_cpu.name as cpu_name, c_cpu.price as cpu_price, c_cpu.socket as cpu_socket, c_cpu.specs as cpu_specs, c_cpu.image_url as cpu_image,
        c_gpu.name as gpu_name, c_gpu.price as gpu_price, c_gpu.specs as gpu_specs, c_gpu.image_url as gpu_image,
        c_mb.name as motherboard_name, c_mb.price as motherboard_price, c_mb.socket as motherboard_socket, c_mb.specs as motherboard_specs, c_mb.image_url as motherboard_image,
        c_ram.name as ram_name, c_ram.price as ram_price, c_ram.specs as ram_specs, c_ram.image_url as ram_image,
        c_sto.name as storage_name, c_sto.price as storage_price, c_sto.specs as storage_specs, c_sto.image_url as storage_image,
        c_psu.name as psu_name, c_psu.price as psu_price, c_psu.specs as psu_specs, c_psu.image_url as psu_image,
        c_case.name as case_name, c_case.price as case_price, c_case.specs as case_specs, c_case.image_url as case_image
      FROM shared_builds s
      LEFT JOIN components c_cpu ON s.cpu_id = c_cpu.id
      LEFT JOIN components c_gpu ON s.gpu_id = c_gpu.id
      LEFT JOIN components c_mb ON s.motherboard_id = c_mb.id
      LEFT JOIN components c_ram ON s.ram_id = c_ram.id
      LEFT JOIN components c_sto ON s.storage_id = c_sto.id
      LEFT JOIN components c_psu ON s.psu_id = c_psu.id
      LEFT JOIN components c_case ON s.case_id = c_case.id
      WHERE s.share_id = ?
    `;
    database.get(query, [shareId], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

// ==========================================
// SMART ALTERNATIVES ENGINE
// ==========================================

async function getSmartAlternatives(compId, selectedMap = {}, targetBudget = null) {
  const all = await getAllComponents(null);
  const current = all.find(c => c.id === Number(compId));
  if (!current) return [];

  const catName = current.category_name;
  const sameCatComps = all.filter(c => c.category_name === catName && c.id !== current.id);

  // Filter for compatibility with currently selected build items
  const compatibleComps = sameCatComps.filter(item => {
    // If CPU, must match motherboard socket if mobo selected
    if (catName === 'CPU' && selectedMap['Motherboard']) {
      const mobo = all.find(c => c.id === selectedMap['Motherboard']);
      if (mobo && mobo.socket && item.socket && item.socket !== mobo.socket) return false;
    }
    // If Motherboard, must match CPU socket if CPU selected
    if (catName === 'Motherboard' && selectedMap['CPU']) {
      const cpu = all.find(c => c.id === selectedMap['CPU']);
      if (cpu && cpu.socket && item.socket && item.socket !== cpu.socket) return false;
    }
    // If RAM, must match Motherboard DDR if mobo selected
    if (catName === 'RAM' && selectedMap['Motherboard']) {
      const mobo = all.find(c => c.id === selectedMap['Motherboard']);
      const mDdr = mobo && mobo.specs?.memory_type ? String(mobo.specs.memory_type).toUpperCase() : '';
      const rDdr = item.specs?.type ? String(item.specs.type).toUpperCase() : '';
      if (mDdr && rDdr && mDdr !== rDdr) return false;
    }
    // If PSU, must have wattage >= GPU requirement if GPU selected
    if (catName === 'PSU' && selectedMap['GPU']) {
      const gpu = all.find(c => c.id === selectedMap['GPU']);
      const need = Number(gpu?.specs?.recommended_psu_watts || 0);
      const have = Number(item.specs?.wattage || 0);
      if (need > 0 && have < need) return false;
    }
    return true;
  });

  const alternatives = [];
  const currPrice = Number(current.price);

  // 1. Cheaper Alternative
  const cheaper = compatibleComps.filter(c => Number(c.price) < currPrice).sort((a, b) => Number(b.price) - Number(a.price))[0];
  if (cheaper) {
    const delta = currPrice - Number(cheaper.price);
    alternatives.push({
      ...cheaper,
      badge: '💰 Cheaper Alternative',
      badgeClass: 'badge-cyan',
      priceDelta: -delta,
      formattedDelta: `Save ₹${delta.toLocaleString('en-IN')}`,
      benefit: `Saves ₹${delta.toLocaleString('en-IN')} with minimal performance drop.`
    });
  }

  // 2. Better Performance Alternative
  const betterPerf = compatibleComps.filter(c => Number(c.price) > currPrice).sort((a, b) => Number(a.price) - Number(b.price))[0];
  if (betterPerf) {
    const delta = Number(betterPerf.price) - currPrice;
    alternatives.push({
      ...betterPerf,
      badge: '⚡ Better Performance',
      badgeClass: 'badge-purple',
      priceDelta: delta,
      formattedDelta: `+₹${delta.toLocaleString('en-IN')}`,
      benefit: `Upgrades processing power for +₹${delta.toLocaleString('en-IN')}.`
    });
  }

  // 3. Better Value / Popular Choice
  const valueChoice = compatibleComps.filter(c => c.id !== cheaper?.id && c.id !== betterPerf?.id)[0];
  if (valueChoice) {
    const delta = Number(valueChoice.price) - currPrice;
    const isMoreFuture = valueChoice.socket === 'AM5' || valueChoice.specs?.type === 'DDR5' || Number(valueChoice.specs?.wattage) >= 750;
    alternatives.push({
      ...valueChoice,
      badge: isMoreFuture ? '🔮 More Future-Proof' : '⭐ Better Value',
      badgeClass: isMoreFuture ? 'badge-green' : 'badge-cyan',
      priceDelta: delta,
      formattedDelta: delta > 0 ? `+₹${delta.toLocaleString('en-IN')}` : `-₹${Math.abs(delta).toLocaleString('en-IN')}`,
      benefit: isMoreFuture ? 'Modern platform with long-term upgradeability.' : 'Highly balanced price-to-performance sweet spot.'
    });
  }

  return alternatives;
}

// ==========================================
// BILLS & INVOICES CRUD
// ==========================================

function generateBillNumber() {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `PB-${year}-${rand}`;
}

async function createBill({ user_id, build_id = null, items = [], discount = 0, status = 'PAID' }) {
  const database = await getDb();
  
  // Calculate subtotal from items
  const subtotalGross = items.reduce((sum, item) => sum + (Number(item.total_price || item.unit_price * (item.quantity || 1)) || 0), 0);
  // GST calculation: 18% standard GST
  const GST_RATE = 0.18;
  const subtotal = Math.round((subtotalGross / (1 + GST_RATE)) * 100) / 100;
  const tax = Math.round((subtotalGross - subtotal) * 100) / 100;
  const total_amount = subtotalGross - (Number(discount) || 0);
  const bill_number = generateBillNumber();

  return new Promise((resolve, reject) => {
    database.serialize(() => {
      const billQuery = `
        INSERT INTO bills (user_id, build_id, bill_number, subtotal, tax, discount, total_amount, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      database.run(billQuery, [user_id, build_id, bill_number, subtotal, tax, discount, total_amount, status], function(err) {
        if (err) return reject(err);
        const billId = this.lastID;

        if (items.length === 0) {
          return getBillById(billId).then(resolve).catch(reject);
        }

        const placeholders = items.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
        const itemQuery = `
          INSERT INTO bill_items (bill_id, component_type, component_id, component_name, quantity, unit_price, total_price)
          VALUES ${placeholders}
        `;
        const itemParams = [];
        items.forEach(item => {
          const qty = Number(item.quantity) || 1;
          const uPrice = Number(item.unit_price || item.price) || 0;
          const tPrice = Number(item.total_price) || (uPrice * qty);
          itemParams.push(
            billId,
            item.component_type || item.category || 'Component',
            item.component_id || item.id || null,
            item.component_name || item.name || 'Custom Component',
            qty,
            uPrice,
            tPrice
          );
        });

        database.run(itemQuery, itemParams, (itemErr) => {
          if (itemErr) return reject(itemErr);
          getBillById(billId).then(resolve).catch(reject);
        });
      });
    });
  });
}

async function getBillById(id) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        bl.*,
        u.name as user_name,
        u.email as user_email,
        b.build_name,
        b.performance_score,
        b.compatibility_status
      FROM bills bl
      JOIN users u ON bl.user_id = u.id
      LEFT JOIN builds b ON bl.build_id = b.id
      WHERE bl.id = ? OR bl.bill_number = ?
    `;
    database.get(query, [id, id], (err, bill) => {
      if (err) return reject(err);
      if (!bill) return resolve(null);

      database.all('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id ASC', [bill.id], (iErr, items) => {
        if (iErr) return reject(iErr);
        bill.items = items || [];
        resolve(bill);
      });
    });
  });
}

async function getBillsByUserId(userId) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        bl.*,
        b.build_name,
        b.performance_score,
        COUNT(bi.id) as item_count
      FROM bills bl
      LEFT JOIN builds b ON bl.build_id = b.id
      LEFT JOIN bill_items bi ON bi.bill_id = bl.id
      WHERE bl.user_id = ?
      GROUP BY bl.id
      ORDER BY bl.id DESC
    `;
    database.all(query, [userId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function getAllBills() {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        bl.*,
        u.name as user_name,
        u.email as user_email,
        b.build_name,
        COUNT(bi.id) as item_count
      FROM bills bl
      JOIN users u ON bl.user_id = u.id
      LEFT JOIN builds b ON bl.build_id = b.id
      LEFT JOIN bill_items bi ON bi.bill_id = bl.id
      GROUP BY bl.id
      ORDER BY bl.id DESC
    `;
    database.all(query, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function deleteBill(id) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    database.run('DELETE FROM bills WHERE id = ?', [id], function(err) {
      if (err) reject(err);
      else resolve(this.changes > 0);
    });
  });
}

// ==========================================
// WISHLIST CRUD
// ==========================================

async function addToWishlist(userId, componentId) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `INSERT OR IGNORE INTO wishlist (user_id, component_id) VALUES (?, ?)`;
    database.run(query, [userId, componentId], function(err) {
      if (err) reject(err);
      else resolve({ success: true, added: this.changes > 0 });
    });
  });
}

async function removeFromWishlist(userId, componentId) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `DELETE FROM wishlist WHERE user_id = ? AND component_id = ?`;
    database.run(query, [userId, componentId], function(err) {
      if (err) reject(err);
      else resolve({ success: true, removed: this.changes > 0 });
    });
  });
}

async function getWishlistByUserId(userId) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const query = `
      SELECT c.*, cat.name as category_name, w.created_at as wishlisted_at
      FROM wishlist w
      JOIN components c ON w.component_id = c.id
      JOIN categories cat ON c.category_id = cat.id
      WHERE w.user_id = ?
      ORDER BY w.id DESC
    `;
    database.all(query, [userId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(parseComponent));
    });
  });
}

async function getWishlistIdsByUserId(userId) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    database.all('SELECT component_id FROM wishlist WHERE user_id = ?', [userId], (err, rows) => {
      if (err) reject(err);
      else resolve((rows || []).map(r => r.component_id));
    });
  });
}

// ==========================================
// PRICE HISTORY (DISPLAY-ONLY)
// ==========================================

async function getPriceHistoryByComponentId(componentId) {
  const database = await getDb();
  const comp = await getComponentById(componentId);
  if (!comp) return null;

  return new Promise((resolve, reject) => {
    database.all(
      'SELECT price, recorded_date FROM price_history WHERE component_id = ? ORDER BY recorded_date ASC',
      [componentId],
      (err, rows) => {
        if (err) return reject(err);

        let historyRows = rows || [];
        const currentPrice = Number(comp.price);

        if (historyRows.length === 0) {
          // Generate realistic sample history points
          historyRows = [
            { recorded_date: '2026-05-25', price: Math.round(currentPrice * 1.06) },
            { recorded_date: '2026-06-25', price: Math.round(currentPrice * 1.03) },
            { recorded_date: '2026-07-25', price: Math.round(currentPrice * 0.99) },
            { recorded_date: '2026-08-25', price: currentPrice }
          ];
        }

        resolve({
          component_id: comp.id,
          component_name: comp.name,
          current_price: currentPrice,
          points: historyRows,
          disclaimer: 'Sample Historical Price Data (For Reference Only)'
        });
      }
    );
  });
}

// ==========================================
// ADMIN ANALYTICS & DASHBOARD REAL STATS
// ==========================================

async function getAdminDashboardStats() {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const stats = {};

    database.get("SELECT COUNT(*) as count FROM users", [], (e1, r1) => {
      if (e1) return reject(e1);
      stats.total_users = r1.count;

      database.get("SELECT COUNT(*) as count FROM builds", [], (e2, r2) => {
        if (e2) return reject(e2);
        stats.total_builds = r2.count;

        database.get("SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue, COALESCE(AVG(total_amount), 0) as avg_bill FROM bills", [], (e3, r3) => {
          if (e3) return reject(e3);
          stats.total_bills = r3.count;
          stats.total_revenue = r3.revenue;
          stats.avg_bill_value = Math.round(r3.avg_bill);

          database.all("SELECT id, name, email, role, created_at FROM users ORDER BY id DESC LIMIT 5", [], (e4, r4) => {
            if (e4) return reject(e4);
            stats.recent_users = r4;

            database.all(`
              SELECT b.id, b.build_name, b.total_price, b.performance_score, b.created_at, u.name as user_name
              FROM builds b
              JOIN users u ON b.user_id = u.id
              ORDER BY b.id DESC LIMIT 5
            `, [], (e5, r5) => {
              if (e5) return reject(e5);
              stats.recent_builds = r5;

              database.all(`
                SELECT bl.id, bl.bill_number, bl.total_amount, bl.status, bl.created_at, u.name as user_name
                FROM bills bl
                JOIN users u ON bl.user_id = u.id
                ORDER BY bl.id DESC LIMIT 5
              `, [], (e6, r6) => {
                if (e6) return reject(e6);
                stats.recent_bills = r6;

                // Category Inventory & Pricing
                database.all(`
                  SELECT cat.name as category, COUNT(c.id) as component_count, AVG(c.price) as avg_price
                  FROM categories cat
                  LEFT JOIN components c ON c.category_id = cat.id
                  GROUP BY cat.id
                `, [], (e7, r7) => {
                  if (e7) return reject(e7);
                  stats.category_breakdown = r7;

                  // Popular CPU
                  database.all(`
                    SELECT c.name as name, COUNT(b.id) as count
                    FROM builds b
                    JOIN components c ON b.cpu_id = c.id
                    GROUP BY c.id ORDER BY count DESC LIMIT 3
                  `, [], (e8, r8) => {
                    stats.popular_cpus = r8 || [];

                    // Popular GPU
                    database.all(`
                      SELECT c.name as name, COUNT(b.id) as count
                      FROM builds b
                      JOIN components c ON b.gpu_id = c.id
                      GROUP BY c.id ORDER BY count DESC LIMIT 3
                    `, [], (e9, r9) => {
                      stats.popular_gpus = r9 || [];

                      // Users with saved builds
                      database.get("SELECT COUNT(DISTINCT user_id) as count FROM builds", [], (e10, r10) => {
                        stats.users_with_builds = r10 ? r10.count : 0;

                        // Users with bills
                        database.get("SELECT COUNT(DISTINCT user_id) as count FROM bills", [], (e11, r11) => {
                          stats.users_with_bills = r11 ? r11.count : 0;
                          resolve(stats);
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

module.exports = {
  getDb,
  ensureSchema,
  // Components & Categories
  listCategories,
  getAllComponents,
  getComponentById,
  createComponent,
  updateComponent,
  deleteComponent,
  getComponentsByIds,
  loadCompatibility,
  // Users
  createUser,
  getUserByEmail,
  getUserById,
  getAllUsers,
  getUserProfileWithStats,
  updateUser,
  deleteUser,
  // Builds & Smart Score
  calculateSmartBuildScore,
  createBuild,
  getBuildById,
  getBuildsByUserId,
  getAllBuilds,
  updateBuild,
  deleteBuild,
  // Bills
  createBill,
  getBillById,
  getBillsByUserId,
  getAllBills,
  deleteBill,
  // Wishlist
  addToWishlist,
  removeFromWishlist,
  getWishlistByUserId,
  getWishlistIdsByUserId,
  // Price History
  getPriceHistoryByComponentId,
  // Shared Builds & Alternatives
  createSharedBuild,
  getSharedBuildByShareId,
  getSmartAlternatives,
  // Admin stats & Analytics
  getAdminDashboardStats
};
