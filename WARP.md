# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Project overview
- Stack: Node.js (Express + better-sqlite3) backend, static frontend (Vanilla JS + HTML/CSS).
- Data model: SQLite database with categories and components. Components may carry:
  - price (number)
  - socket (for CPU/Motherboard compatibility)
  - specs (JSON) that can include memory type for RAM/motherboard and GPU PSU requirements.
- Compatibility: data/compatibility.json contains rules evaluated by the backend (e.g., CPU↔Motherboard socket match, GPU PSU wattage, RAM type).

Quickstart (Windows PowerShell)
- Requirements: Node >= 18
- Install deps:
  powershell
  npm install
- Start server (defaults to http://localhost:3000):
  powershell
  npm start
- Optional environment variables:
  powershell
  $env:PORT = 3000            # Port for the HTTP server
  $env:ADMIN_TOKEN = 'dev-admin'  # Admin auth token for write APIs
  $env:DB_FILE = "$PWD\data\pcbuilder.db"  # SQLite database file path
  npm start

Common commands
- Install:
  powershell
  npm install
- Run (development):
  powershell
  npm start
- API smoke checks (PowerShell-friendly curl):
  powershell
  # Categories
  curl -s http://localhost:3000/api/categories
  
  # All components (optionally filter by categoryId)
  curl -s "http://localhost:3000/api/components?categoryId=1"
  
  # Create a component (admin)
  curl -s -X POST http://localhost:3000/api/components ^
    -H "Content-Type: application/json" ^
    -H "x-admin-token: ${env:ADMIN_TOKEN}" ^
    -d '{
      "name":"Example DDR4 16GB",
      "category_id":5,
      "price":49.99,
      "socket":null,
      "specs":{"type":"DDR4","size_gb":16,"speed_mhz":3200}
    }'
  
  # Validate a build (IDs are component IDs by category name)
  curl -s -X POST http://localhost:3000/api/build/validate ^
    -H "Content-Type: application/json" ^
    -d '{
      "selected": {"CPU": 101, "Motherboard": 201, "GPU": 301, "PSU": 401, "RAM": 501},
      "budget": 1500
    }'

Architecture and key files
- Backend
  - backend/server.js: Express app, CORS, JSON body parsing, static frontend hosting. Calls ensureSchema() on startup and mounts API routes at /api.
  - backend/routes.js: REST API
    - GET /api/categories
    - GET /api/components (optional ?categoryId=)
    - GET /api/components/:id
    - POST /api/components (admin-only via header x-admin-token)
    - PUT /api/components/:id (admin-only)
    - DELETE /api/components/:id (admin-only)
    - POST /api/build/validate → applies rules from compatibility.json against current selections and budget
  - backend/database.js:
    - ensureSchema(): executes data/schema.sql every start (CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE seed rows)
    - CRUD helpers over better-sqlite3 (synchronous, file-backed SQLite)
    - loadCompatibility(): loads data/compatibility.json
- Data
  - data/schema.sql: DDL + seed content. Using INSERT OR IGNORE makes seeding idempotent. Starting the server inserts any new seed rows that don’t already exist.
  - data/compatibility.json: Rule definitions consumed by /build/validate
- Frontend
  - frontend/index.html, frontend/app.js, frontend/style.css → user panel
    - Renders category selects for: CPU, Motherboard, GPU, PSU, RAM
    - Fetches details and shows total; can POST /api/build/validate
  - frontend/admin.html, frontend/app.js → admin panel
    - Local admin token in localStorage; uses header x-admin-token
    - CRUD for components via the API

Notable details
- Admin auth: Set ADMIN_TOKEN (default: dev-admin). Clients must send x-admin-token header for POST/PUT/DELETE on /api/components.
- Compatibility rules:
  - field-equality: compares fields across categories (e.g., CPU.socket == Motherboard.socket, RAM.type == Motherboard.memory_type)
  - psu-min-wattage: compares GPU.specs.recommended_psu_watts to PSU.specs.wattage
- Seeding behavior: ensureSchema() runs on every start and executes schema.sql with INSERT OR IGNORE, so new seeds are added automatically without dropping the DB.

Tests/Lint
- No test or lint tooling is configured in package.json. If needed later, add scripts and tools (e.g., vitest/jest, eslint) before relying on test/lint commands here.
