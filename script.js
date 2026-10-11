/* =====================================================================
   DETROIT SITE EXPLORER — APPLICATION LOGIC
   ---------------------------------------------------------------------
   Sections
     1. Setup & helpers
     2. Geometry helpers (distance, area, point-in-polygon, intersects)
     3. Data loaders (ArcGIS REST, GeoJSON, CSV)
     4. Map & rendering
     5. Left sidebar: layer tree, zoning sub-categories, legend
     6. Site selection, buffers & property panel
     7. Shortlist (save / notes / export)
     8. Search, data-sources dialog, UI wiring

   Future features (adjacent DLBA parcels, size / zoning filters,
   comparison, scoring) should hook into the functions marked
   "EXTENSION POINT" so the rest of the app does not need to change.
   ===================================================================== */
(function () {
  'use strict';

  /* ===================================================================
     1. SETUP & HELPERS
     =================================================================== */
  const CFG = window.MAP_CONFIG;
  if (!CFG) { document.body.innerHTML = '<p style="padding:20px">config/layers.js did not load.</p>'; return; }

  const SQFT_PER_SQM = 10.7639104;
  const SQFT_PER_ACRE = 43560;
  const M_PER_MILE = 1609.344;
  const STORAGE_KEY = 'detroitSiteExplorer.shortlist.v1';

  const state = {
    rt: {},              // layer id -> runtime object
    order: [],           // layer ids in config order
    selection: null,     // current selected site
    bufferId: CFG.defaultBuffer || null,
    shortlist: [],
    zoning: { field: null, descField: null, codes: new Map(), desc: {}, active: new Set(), ready: false },
    selToken: 0
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtInt(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function fmtNum(n, d = 2) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }); }
  function fmtDist(m) {
    const mi = m / M_PER_MILE;
    if (mi < 0.1) return fmtInt(m * 3.28084) + ' ft';
    return fmtNum(mi, 2) + ' mi';
  }
  function isBlank(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
  function fmtVal(v) {
    if (isBlank(v)) return '';
    // ArcGIS dates come back as epoch milliseconds in esri JSON
    return String(v);
  }
  /** Find the first property key matching one of the candidate names (case-insensitive). */
  function findKey(props, candidates) {
    if (!props) return null;
    const keys = Object.keys(props);
    for (const c of candidates || []) {
      const k = keys.find(k => k.toLowerCase() === String(c).toLowerCase());
      if (k) return k;
    }
    return null;
  }
  /** Return {key, value} for the first candidate with a non-empty value, else null. */
  function pick(props, candidates) {
    if (!props) return null;
    const keys = Object.keys(props);
    for (const c of candidates || []) {
      const k = keys.find(k => k.toLowerCase() === String(c).toLowerCase());
      if (k && !isBlank(props[k])) return { key: k, value: props[k] };
    }
    return null;
  }
  const asList = v => v == null ? [] : [].concat(v);
  /** Feature name: the layer's own nameField first, then the generic candidates. */
  function featureName(props, fallback, rt) {
    const p = pick(props, asList(rt && rt.cfg.nameField).concat(CFG.nameFields));
    if (!p) return fallback;
    const prefix = rt && rt.cfg.namePrefix ? rt.cfg.namePrefix : '';
    return prefix + String(p.value);
  }
  function featureAddress(props, rt) {
    const p = pick(props, asList(rt && rt.cfg.addressField).concat(CFG.addressFields));
    return p ? String(p.value).replace(/\s*\n\s*/g, ', ').replace(/,?\s*\(?-?\d+\.\d+,\s*-?\d+\.\d+\)?$/, '') : '';
  }
  /** Column-name candidates for a property fact: layer-specific names first, then the global list. */
  function layerCands(rt, key) {
    return asList(rt && rt.cfg.fields && rt.cfg.fields[key]).concat(CFG.propertyFields[key] || []);
  }
  /** Friendly label for coded values (config valueLabels). */
  function valueLabel(field, value) {
    const vl = CFG.valueLabels || {};
    const k = Object.keys(vl).find(x => x.toLowerCase() === String(field).toLowerCase());
    if (k && vl[k][String(value)] != null) return vl[k][String(value)];
    return fmtVal(value);
  }
  /** Symbol rule (config colorBy) that applies to a feature, or null. */
  function ruleFor(rt, f) {
    const cb = rt.cfg.colorBy; if (!cb) return null;
    const v = (f.properties || {})[findKey(f.properties, asList(cb.field)) || ''];
    if (isBlank(v)) return cb.otherwise || null;
    for (const r of cb.rules) {
      if (r.min != null || r.max != null) {           // numeric range rule: min <= value < max
        const n = Number(v);
        if (isFinite(n) && (r.min == null || n >= r.min) && (r.max == null || n < r.max)) return r;
        continue;
      }
      if (r._re === undefined) r._re = new RegExp(r.match, 'i');
      if (r._re.test(String(v))) return r;
    }
    return cb.otherwise || null;
  }
  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* storage unavailable */ } }

  /* ===================================================================
     2. GEOMETRY HELPERS  (coordinates are GeoJSON [lng, lat])
     =================================================================== */
  const EARTH_R = 6371008.8;
  const rad = d => d * Math.PI / 180;

  function haversine(a, b) {
    const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  /** Iterate every [lng,lat] position of a geometry. */
  function eachCoord(geom, fn) {
    if (!geom) return;
    const walk = c => { if (typeof c[0] === 'number') fn(c); else c.forEach(walk); };
    if (geom.type === 'GeometryCollection') geom.geometries.forEach(g => eachCoord(g, fn));
    else walk(geom.coordinates);
  }
  function bboxOf(geom) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    eachCoord(geom, c => { if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1]; if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1]; });
    return b;
  }
  function bboxOverlap(a, b) { return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }
  function expandBbox(b, meters) {
    const dLat = meters / 111320;
    const dLng = meters / (111320 * Math.cos(rad((b[1] + b[3]) / 2)));
    return [b[0] - dLng, b[1] - dLat, b[2] + dLng, b[3] + dLat];
  }
  /** Polygons as array of polygon-coordinate arrays (handles Polygon & MultiPolygon). */
  function polygonsOf(geom) {
    if (!geom) return [];
    if (geom.type === 'Polygon') return [geom.coordinates];
    if (geom.type === 'MultiPolygon') return geom.coordinates;
    if (geom.type === 'GeometryCollection') return geom.geometries.flatMap(polygonsOf);
    return [];
  }
  function linesOf(geom) {
    if (!geom) return [];
    if (geom.type === 'LineString') return [geom.coordinates];
    if (geom.type === 'MultiLineString') return geom.coordinates;
    if (geom.type === 'Polygon') return geom.coordinates;
    if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
    if (geom.type === 'GeometryCollection') return geom.geometries.flatMap(linesOf);
    return [];
  }
  function pointsOf(geom) {
    if (!geom) return [];
    if (geom.type === 'Point') return [geom.coordinates];
    if (geom.type === 'MultiPoint') return geom.coordinates;
    return [];
  }
  const isPolyType = g => g && (g.type === 'Polygon' || g.type === 'MultiPolygon');
  const isLineType = g => g && (g.type === 'LineString' || g.type === 'MultiLineString');
  const isPointType = g => g && (g.type === 'Point' || g.type === 'MultiPoint');

  function ringArea(ring) {           // spherical excess approximation (same method as Turf)
    let total = 0; const n = ring.length;
    if (n < 3) return 0;
    for (let i = 0; i < n; i++) {
      const p1 = ring[i], p2 = ring[(i + 1) % n], p3 = ring[(i + 2) % n];
      total += (rad(p3[0]) - rad(p1[0])) * Math.sin(rad(p2[1]));
    }
    return Math.abs(total * 6378137 * 6378137 / 2);
  }
  function geomAreaSqm(geom) {
    return polygonsOf(geom).reduce((sum, poly) => sum + ringArea(poly[0]) - poly.slice(1).reduce((s, h) => s + ringArea(h), 0), 0);
  }
  function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function pointInPoly(pt, poly) {
    if (!pointInRing(pt, poly[0])) return false;
    for (let h = 1; h < poly.length; h++) if (pointInRing(pt, poly[h])) return false;
    return true;
  }
  function pointInGeom(pt, geom) { return polygonsOf(geom).some(p => pointInPoly(pt, p)); }

  /** Distance in meters from point p to segment a–b, using a local flat projection (accurate at parcel/mile scale). */
  function segDist(p, a, b) {
    const k = Math.cos(rad(p[1]));
    const ax = (a[0] - p[0]) * k, ay = a[1] - p[1], bx = (b[0] - p[0]) * k, by = b[1] - p[1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx, y = ay + t * dy;
    return Math.sqrt(x * x + y * y) * (Math.PI / 180) * EARTH_R;
  }
  /** Straight-line distance (m) from a point to the nearest part of any geometry (0 if inside a polygon). */
  function distToGeom(pt, geom) {
    if (!geom) return Infinity;
    if (isPointType(geom)) return Math.min(...pointsOf(geom).map(c => haversine(pt, c)));
    if (isPolyType(geom) && pointInGeom(pt, geom)) return 0;
    let best = Infinity;
    for (const line of linesOf(geom)) {
      for (let i = 0; i < line.length - 1; i++) { const d = segDist(pt, line[i], line[i + 1]); if (d < best) best = d; }
      if (line.length === 1) best = Math.min(best, haversine(pt, line[0]));
    }
    return best;
  }
  function segsCross(p1, p2, p3, p4) {
    const d = (a, b, c) => (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  /** True if geometries a and b share any area / touch (points within 3 m count). */
  function geomIntersects(a, b) {
    if (!a || !b) return false;
    const ba = bboxOf(a), bb = bboxOf(b);
    if (!bboxOverlap(expandBbox(ba, 3), bb)) return false;
    if (isPointType(a)) return pointsOf(a).some(p => isPolyType(b) ? pointInGeom(p, b) : distToGeom(p, b) <= 3);
    if (isPointType(b)) return pointsOf(b).some(p => isPolyType(a) ? pointInGeom(p, a) : distToGeom(p, a) <= 3);
    if (isPolyType(b)) { let hit = false; eachCoord(a, c => { if (!hit && pointInGeom(c, b)) hit = true; }); if (hit) return true; }
    if (isPolyType(a)) { let hit = false; eachCoord(b, c => { if (!hit && pointInGeom(c, a)) hit = true; }); if (hit) return true; }
    const la = linesOf(a), lb = linesOf(b);
    for (const r1 of la) for (let i = 0; i < r1.length - 1; i++) {
      const sb = [Math.min(r1[i][0], r1[i + 1][0]), Math.min(r1[i][1], r1[i + 1][1]), Math.max(r1[i][0], r1[i + 1][0]), Math.max(r1[i][1], r1[i + 1][1])];
      if (!bboxOverlap(sb, bb)) continue;
      for (const r2 of lb) for (let j = 0; j < r2.length - 1; j++) if (segsCross(r1[i], r1[i + 1], r2[j], r2[j + 1])) return true;
    }
    return false;
  }
  /**
   * Does a map feature touch the selected site? Polygons are tested with sample points pulled
   * slightly inside the site, so a neighbouring parcel or district that only shares a boundary
   * line is not counted.
   */
  function siteHits(site, center, other) {
    if (!site || !other) return false;
    if (isPointType(site)) return isPolyType(other) ? pointInGeom(pointsOf(site)[0], other) : distToGeom(pointsOf(site)[0], other) <= 3;
    if (isPointType(other)) return pointsOf(other).some(p => pointInGeom(p, site));
    if (isLineType(other)) return geomIntersects(site, other);
    const samples = [center];
    eachCoord(site, c => samples.push([c[0] + (center[0] - c[0]) * 0.12, c[1] + (center[1] - c[1]) * 0.12]));
    if (samples.some(pt => pointInGeom(pt, other))) return true;
    let hit = false; eachCoord(other, c => { if (!hit && pointInGeom(c, site)) hit = true; });
    return hit;
  }
  /** A point guaranteed (where possible) to fall inside the geometry. */
  function repPoint(geom) {
    if (!geom) return null;
    if (isPointType(geom)) return pointsOf(geom)[0];
    if (isLineType(geom)) { const l = linesOf(geom)[0]; return l[Math.floor(l.length / 2)]; }
    const polys = polygonsOf(geom);
    if (!polys.length) { const b = bboxOf(geom); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
    const poly = polys.reduce((best, p) => ringArea(p[0]) > ringArea(best[0]) ? p : best, polys[0]);
    const ring = poly[0];
    let A = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      A += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
    }
    if (A !== 0) { const c = [cx / (3 * A), cy / (3 * A)]; if (pointInPoly(c, poly)) return c; }
    // fallback: midpoint of the first interior span on the horizontal line through the bbox centre
    const b = bboxOf({ type: 'Polygon', coordinates: poly }), y = (b[1] + b[3]) / 2, xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
    }
    xs.sort((m, n) => m - n);
    return xs.length >= 2 ? [(xs[0] + xs[1]) / 2, y] : ring[0];
  }
  /** Rough check that coordinates are WGS84 lon/lat rather than a projected system. */
  function looksLikeLonLat(features) {
    for (const f of features.slice(0, 20)) {
      let bad = false; eachCoord(f.geometry, c => { if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) bad = true; });
      if (bad) return false;
    }
    return true;
  }

  /* ===================================================================
     3. DATA LOADERS
     =================================================================== */
  function normalizeArcgisUrl(url) {
    let u = String(url).trim().split('?')[0].replace(/\/+$/, '');
    u = u.replace(/\/query$/i, '');
    if (/\/(FeatureServer|MapServer)$/i.test(u)) u += '/0';
    return u;
  }
  function featureKey(f) {
    if (f.id != null) return String(f.id);
    const p = f.properties || {};
    const k = findKey(p, ['objectid', 'OBJECTID', 'fid', 'FID', 'ObjectId']);
    if (k) return String(p[k]);
    let first = null; eachCoord(f.geometry, c => { if (!first) first = c; });
    return first ? first.join(',') + '|' + JSON.stringify(p).length : Math.random().toString(36);
  }

  // ---- Esri JSON -> GeoJSON (fallback for services without f=geojson) ----
  function esriGeomToGeoJSON(g) {
    if (!g) return null;
    if (typeof g.x === 'number') return { type: 'Point', coordinates: [g.x, g.y] };
    if (g.points) return { type: 'MultiPoint', coordinates: g.points };
    if (g.paths) return g.paths.length === 1 ? { type: 'LineString', coordinates: g.paths[0] } : { type: 'MultiLineString', coordinates: g.paths };
    if (g.rings) {
      const outers = [], holes = [];
      for (const r of g.rings) {
        let s = 0; for (let i = 0; i < r.length - 1; i++) s += (r[i + 1][0] - r[i][0]) * (r[i + 1][1] + r[i][1]);
        (s >= 0 ? outers : holes).push(r);   // clockwise (s>0) = outer ring in Esri JSON
      }
      const polys = outers.map(o => [o]);
      for (const h of holes) {
        const host = polys.find(p => pointInRing(h[0], p[0]));
        if (host) host.push(h); else polys.push([h.slice().reverse()]);
      }
      return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
    }
    return null;
  }
  function esriToFeatures(data) {
    const oid = data.objectIdFieldName;
    return (data.features || []).map(f => ({
      type: 'Feature', id: oid && f.attributes ? f.attributes[oid] : undefined,
      properties: f.attributes || {}, geometry: esriGeomToGeoJSON(f.geometry)
    }));
  }

  async function fetchJson(url, signal) {
    let res;
    try { res = await fetch(url, { signal }); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      if (location.protocol === 'file:' && !/^https?:/i.test(url)) throw new Error('Local files cannot be read when index.html is opened directly. Start a local web server (see README) or use a web URL.');
      throw new Error('Network request failed (offline, blocked, or the server does not allow browser access).');
    }
    if (!res.ok) throw new Error('Server returned HTTP ' + res.status);
    return res.json();
  }
  async function fetchText(url, signal) {
    let res;
    try { res = await fetch(url, { signal }); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      if (location.protocol === 'file:' && !/^https?:/i.test(url)) throw new Error('Local files cannot be read when index.html is opened directly. Start a local web server (see README) or use a web URL.');
      throw new Error('Network request failed.');
    }
    if (!res.ok) throw new Error('Server returned HTTP ' + res.status);
    return res.text();
  }

  async function arcgisMeta(rt) {
    if (rt.meta) return rt.meta;
    const data = await fetchJson(rt.url + '?f=json');
    if (data.error) throw new Error('ArcGIS error: ' + (data.error.message || JSON.stringify(data.error)));
    if (data.type && !/layer|table/i.test(data.type) && !data.geometryType) throw new Error('URL is not a single layer. Add the layer number, e.g. …/FeatureServer/0');
    rt.meta = data;
    if (data.editingInfo && data.editingInfo.lastEditDate) rt.publisherUpdated = new Date(data.editingInfo.lastEditDate).toISOString().slice(0, 10);
    return data;
  }

  /** Run one ArcGIS query page. Returns {features, exceeded}. */
  async function arcgisQueryPage(rt, params, signal) {
    const base = {
      where: rt.cfg.source.where || '1=1', outFields: rt.cfg.source.outFields || '*', returnGeometry: 'true', outSR: '4326', geometryPrecision: '6',
      ...params
    };
    const tryFormat = async (f) => {
      const qs = new URLSearchParams({ ...base, f });
      const data = await fetchJson(rt.url + '/query?' + qs.toString(), signal);
      if (data.error) throw new Error('ArcGIS error: ' + (data.error.message || 'query failed') + (data.error.details ? ' — ' + data.error.details.join(' ') : ''));
      return data;
    };
    if (!rt.esriJson) {
      try {
        const data = await tryFormat('geojson');
        if (Array.isArray(data.features)) {
          const exceeded = !!(data.exceededTransferLimit || (data.properties && data.properties.exceededTransferLimit));
          return { features: data.features, exceeded };
        }
      } catch (e) { if (e.name === 'AbortError') throw e; /* fall back to esri json below */ }
      rt.esriJson = true;
    }
    const data = await tryFormat('json');
    return { features: esriToFeatures(data), exceeded: !!data.exceededTransferLimit };
  }

  /** Page through an ArcGIS query until done or until `cap` features. */
  async function arcgisQueryAll(rt, params, cap, signal, onProgress) {
    const meta = await arcgisMeta(rt);
    const pageSize = Math.min(meta.maxRecordCount || 1000, 2000);
    const canPage = !(meta.advancedQueryCapabilities && meta.advancedQueryCapabilities.supportsPagination === false);
    let offset = 0, all = [], truncated = false;
    while (true) {
      const p = canPage ? { ...params, resultOffset: offset, resultRecordCount: pageSize } : params;
      const { features, exceeded } = await arcgisQueryPage(rt, p, signal);
      all = all.concat(features);
      if (onProgress) onProgress(all.length);
      if (!exceeded && (!canPage || features.length < pageSize)) break;
      if (!canPage) { truncated = true; break; }
      if (all.length >= cap) { truncated = true; break; }
      if (!features.length) break;
      offset += features.length;
    }
    return { features: all, truncated };
  }
  /**
   * Download a whole layer. Large layers are fetched several pages at a time
   * (ordered by object ID so pages never overlap); otherwise falls back to one page after another.
   */
  async function arcgisLoadWhole(rt, cap, onProgress) {
    const meta = await arcgisMeta(rt);
    const pageSize = Math.min(meta.maxRecordCount || 1000, 2000);
    const canPage = !(meta.advancedQueryCapabilities && meta.advancedQueryCapabilities.supportsPagination === false);
    const oid = meta.objectIdField || (meta.uniqueIdField && meta.uniqueIdField.name) || ((meta.fields || []).find(f => f.type === 'esriFieldTypeOID') || {}).name;
    const area = rt.cfg.source.bbox ? envelopeParams(rt.cfg.source.bbox) : {};   // optional: only this area of a big layer
    let total = null;
    try {
      const c = await fetchJson(rt.url + '/query?' + new URLSearchParams({ where: rt.cfg.source.where || '1=1', returnCountOnly: 'true', f: 'json', ...area }));
      if (typeof c.count === 'number') total = c.count;
    } catch (e) { /* fall back below */ }
    if (!canPage || !oid || total == null || total <= pageSize) return arcgisQueryAll(rt, area, cap, undefined, onProgress);
    const offsets = [];
    for (let o = 0; o < Math.min(total, cap); o += pageSize) offsets.push(o);
    const pages = new Array(offsets.length);
    let next = 0, loaded = 0;
    const worker = async () => {
      while (next < offsets.length) {
        const i = next++;
        const r = await arcgisQueryPage(rt, { ...area, resultOffset: offsets[i], resultRecordCount: pageSize, orderByFields: oid });
        pages[i] = r.features; loaded += r.features.length;
        if (onProgress) onProgress(loaded);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, offsets.length) }, worker));
    return { features: pages.flat(), truncated: total > cap };
  }
  function envelopeParams(b) {
    return {
      geometry: [b[0], b[1], b[2], b[3]].map(n => n.toFixed(7)).join(','),
      geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects'
    };
  }

  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = [];
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function csvToFeatures(text, src) {
    const rows = parseCsv(text.replace(/^﻿/, ''));
    if (rows.length < 2) throw new Error('CSV has no data rows.');
    const head = rows[0].map(h => h.trim());
    const findCol = (pref, cands) => {
      if (pref) { const i = head.findIndex(h => h.toLowerCase() === pref.toLowerCase()); if (i >= 0) return i; throw new Error('CSV column "' + pref + '" not found.'); }
      return head.findIndex(h => cands.includes(h.toLowerCase()));
    };
    const iLat = findCol(src.latField, ['lat', 'latitude', 'y', 'point_y']);
    const iLng = findCol(src.lngField, ['lon', 'lng', 'long', 'longitude', 'x', 'point_x']);
    if (iLat < 0 || iLng < 0) throw new Error('Could not find latitude/longitude columns. Set latField and lngField in config.');
    const out = []; let skipped = 0;
    for (let r = 1; r < rows.length; r++) {
      const lat = parseFloat(rows[r][iLat]), lng = parseFloat(rows[r][iLng]);
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) { skipped++; continue; }
      const props = {}; head.forEach((h, i) => props[h] = rows[r][i]);
      out.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lng, lat] } });
    }
    return { features: out, skipped };
  }
  function toFeatureArray(data) {
    if (!data) return [];
    if (data.type === 'FeatureCollection') return data.features || [];
    if (data.type === 'Feature') return [data];
    if (Array.isArray(data)) return data;
    if (data.features) return data.features;
    throw new Error('File is not GeoJSON.');
  }

  /** Load a whole layer (loadMode "all", or any geojson / csv source). */
  function ensureLoaded(rt) {
    if (!rt.connected) return Promise.resolve(null);
    if (rt.loadPromise) return rt.loadPromise;
    rt.loadPromise = (async () => {
      setStatus(rt, 'loading');
      try {
        const src = rt.cfg.source;
        let features, note = '';
        if (src.type === 'arcgis') {
          await arcgisMeta(rt);
          const cap = src.maxFeatures || 150000;
          const res = await arcgisLoadWhole(rt, cap, n => setStatus(rt, 'loading', 'Loading… ' + fmtInt(n)));
          features = res.features;
          if (res.truncated) note = 'Only the first ' + fmtInt(features.length) + ' features were loaded (limit reached).';
        } else if (src.type === 'geojson') {
          features = toFeatureArray(await fetchJson(rt.url));
        } else if (src.type === 'csv') {
          const r = csvToFeatures(await fetchText(rt.url), src);
          features = r.features;
          if (r.skipped) note = fmtInt(r.skipped) + ' rows skipped (missing or invalid coordinates).';
        }
        if (src.coordsFromField) features.forEach(f => {
          if (f.geometry) return;
          const v = String((f.properties || {})[src.coordsFromField] || '');
          const m = v.match(/\(?\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)?\s*$/);
          if (m) { const lat = parseFloat(m[1]), lng = parseFloat(m[2]); if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) f.geometry = { type: 'Point', coordinates: [lng, lat] }; }
        });
        const before = features.length;
        features = features.filter(f => f && f.geometry);
        if (src.coordsFromField && before > features.length) note = (note ? note + ' ' : '') + fmtInt(before - features.length) + ' records had no readable coordinates.';
        if (features.length && !looksLikeLonLat(features)) throw new Error('Coordinates are not latitude/longitude (WGS84). Re-export the file in EPSG:4326.');
        rt.features = features;
        rt.loaded = true;
        rt.note = note;
        rt.loadedAt = new Date();
        if (rt.cfg.isZoning) buildZoningCodes(rt);
        setStatus(rt, 'ok');
        if (rt.on) renderLayer(rt);
        return features;
      } catch (e) {
        rt.loadPromise = null;
        rt.error = e.message;
        setStatus(rt, 'error');
        console.warn('[' + rt.cfg.name + ']', e.message);
        throw e;
      }
    })();
    return rt.loadPromise;
  }

  /** Load only what is in the current map view (loadMode "viewport", ArcGIS only). */
  async function loadViewport(rt) {
    if (!rt.on) return;
    const minZoom = rt.cfg.source.minZoom || 0;
    if (map.getZoom() < minZoom) {
      if (map.hasLayer(rt.group)) map.removeLayer(rt.group);
      setStatus(rt, 'zoom');
      updateMapHints();
      return;
    }
    if (!map.hasLayer(rt.group)) map.addLayer(rt.group);
    if (rt.abort) rt.abort.abort();
    const ac = new AbortController(); rt.abort = ac;
    const b = map.getBounds().pad(0.15);
    const env = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    setStatus(rt, 'loading');
    try {
      await arcgisMeta(rt);
      const cap = rt.cfg.source.maxPerView || 8000;
      const params = envelopeParams(env);
      if (rt.cfg.source.displayOffset) params.maxAllowableOffset = String(rt.cfg.source.displayOffset);  // display-only simplification
      const res = await arcgisQueryAll(rt, params, cap, ac.signal);
      if (ac.signal.aborted) return;
      if (!rt.cache || rt.cache.size > (rt.cfg.source.maxCached || 30000)) { rt.cache = new Map(); rt.group.clearLayers(); }
      const fresh = [];
      for (const f of res.features) {
        if (!f.geometry) continue;
        const k = featureKey(f);
        if (!rt.cache.has(k)) { rt.cache.set(k, f); fresh.push(f); }
      }
      rt.features = Array.from(rt.cache.values());
      rt.loaded = true; rt.loadedAt = new Date();
      rt.note = res.truncated ? 'Showing the first ' + fmtInt(res.features.length) + ' features in view — zoom in to see all.' : '';
      rt.inView = res.features.length;
      rt.group.addData(fresh);
      updateClassCounts(rt);
      applyLayerOpacity(rt);
      setStatus(rt, 'ok');
      scheduleRestack();
    } catch (e) {
      if (e.name === 'AbortError') return;
      rt.error = e.message; setStatus(rt, 'error'); console.warn('[' + rt.cfg.name + ']', e.message);
    }
    updateMapHints();
  }

  /**
   * Features of a layer near a location, for analysis.
   * Uses the full in-memory layer when available, otherwise asks the ArcGIS
   * server for just the area needed. Returns null if the layer is not connected.
   */
  async function featuresNear(rt, bbox) {
    if (!rt.connected) return null;
    if (isViewport(rt)) {
      const res = await arcgisQueryAll(rt, envelopeParams(bbox), rt.cfg.source.maxAnalysis || 5000);
      return { features: res.features.filter(f => f.geometry), truncated: res.truncated };
    }
    const feats = await ensureLoaded(rt);
    return { features: (feats || []).filter(f => bboxOverlap(bboxOf(f.geometry), bbox)), truncated: false };
  }
  const isViewport = rt => rt.cfg.source.type === 'arcgis' && rt.cfg.source.loadMode === 'viewport';

  /* ===================================================================
     4. MAP & RENDERING
     =================================================================== */
  const map = L.map('map', {
    center: CFG.map.center, zoom: CFG.map.zoom, minZoom: CFG.map.minZoom, maxZoom: CFG.map.maxZoom,
    zoomControl: true, preferCanvas: true
  });
  L.control.scale({ imperial: true, metric: false, position: 'bottomleft' }).addTo(map);
  const canvas = L.canvas({ padding: 0.4, tolerance: 5 });

  // Selection / buffer pane sits above data and never blocks clicks.
  map.createPane('selectionPane');
  map.getPane('selectionPane').style.zIndex = 640;
  map.getPane('selectionPane').style.pointerEvents = 'none';
  const selRenderer = L.svg({ pane: 'selectionPane', padding: 0.5 });
  const selectionGroup = L.layerGroup().addTo(map);
  const bufferGroup = L.layerGroup().addTo(map);

  // Reset-view control under the zoom buttons
  const ResetCtl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control reset-ctl');
      div.innerHTML = '<a href="#" title="Reset map view" role="button" aria-label="Reset map view">⌂</a>';
      L.DomEvent.on(div, 'click', e => { L.DomEvent.preventDefault(e); L.DomEvent.stopPropagation(e); resetView(); });
      return div;
    }
  });
  map.addControl(new ResetCtl());
  let cityBounds = null;   // set once the official boundary loads
  function resetView() {
    if (cityBounds) map.fitBounds(cityBounds, { padding: [16, 16] });
    else map.setView(CFG.map.center, CFG.map.zoom);
  }

  // Base maps
  const basemapLayers = {};
  let currentBase = null;
  map.createPane('labelsPane');                      // basemap labels: above tiles, below the outside-Detroit mask
  map.getPane('labelsPane').style.zIndex = 240;
  map.getPane('labelsPane').style.pointerEvents = 'none';
  map.createPane('maskPane');                        // covers the base map outside the city limits
  map.getPane('maskPane').style.zIndex = 250;
  map.getPane('maskPane').style.pointerEvents = 'none';
  function setBasemap(id) {
    const b = CFG.basemaps.find(x => x.id === id) || CFG.basemaps[0];
    if (currentBase) map.removeLayer(currentBase);
    if (!basemapLayers[b.id]) {
      const opts = { attribution: b.attribution, maxZoom: CFG.map.maxZoom || 20, maxNativeZoom: b.maxNativeZoom || 19, subdomains: 'abcd' };
      const parts = [L.tileLayer(b.url, opts)];
      if (b.labelsUrl) parts.push(L.tileLayer(b.labelsUrl, { ...opts, attribution: '', pane: 'labelsPane', maxNativeZoom: b.labelsMaxNativeZoom || opts.maxNativeZoom }));
      basemapLayers[b.id] = L.layerGroup(parts);
    }
    currentBase = basemapLayers[b.id].addTo(map);
  }

  /* ---------- Detroit-only base map ----------
     Loads the official City of Detroit Boundary and covers everything outside
     it (including the enclaves of Hamtramck and Highland Park) with an opaque mask.
     Data layers draw above the mask; only the base map is hidden. */
  let maskLayer = null, cityOutline = null;
  async function loadCityMask() {
    const cb = CFG.cityBoundary;
    if (!cb || !cb.url) return;
    const rt = { url: normalizeArcgisUrl(cb.url), cfg: { source: { where: cb.where || '1=1', outFields: '*' } } };
    try {
      const { features } = await arcgisQueryPage(rt, {});
      const polys = features.flatMap(f => polygonsOf(f.geometry));
      if (!polys.length) throw new Error('boundary has no polygons');
      const toLL = ring => ring.map(c => [c[1], c[0]]);
      const world = [[-89.9, -179.9], [-89.9, 179.9], [89.9, 179.9], [89.9, -179.9]];
      const rings = [world].concat(polys.flatMap(p => p.map(toLL)));   // even-odd fill: outside + enclaves
      const svgMask = L.svg({ pane: 'maskPane', padding: 1 });
      maskLayer = L.polygon(rings, { renderer: svgMask, interactive: false, stroke: false, fillColor: cb.maskColor || '#f8f9fb', fillOpacity: cb.maskOpacity != null ? cb.maskOpacity : 1, fillRule: 'evenodd' });
      cityOutline = L.polygon(polys.map(p => p.map(toLL)), { renderer: svgMask, interactive: false, fill: false, color: cb.outlineColor || '#334155', weight: 1.6, opacity: 0.9 });
      const b = L.latLngBounds(polys.flatMap(p => toLL(p[0])));
      cityBounds = b;
      // Panning is left free (a hard pan limit made the map snap back while dragging);
      // only zooming far out past the city is prevented.
      map.setMinZoom(Math.max(CFG.map.minZoom || 0, map.getBoundsZoom(b) - 2));
      if (!state.userMoved) resetView();
      setMask($('#maskToggle') ? $('#maskToggle').checked : true);
    } catch (e) {
      console.warn('City boundary mask not loaded:', e.message);
      const t = $('#maskToggleWrap'); if (t) { t.title = 'City boundary could not be loaded: ' + e.message; t.classList.add('disabled'); }
    }
  }
  function setMask(on) {
    if (!maskLayer) return;
    [maskLayer, cityOutline].forEach(l => on ? l.addTo(map) : map.removeLayer(l));
  }

  // Amenity icons (simple inline SVG glyphs)
  const ICONS = {
    grocery: '<path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM1 2h3.3l1 2H22l-3.6 8.4A2 2 0 0 1 16.6 14H8.5l-1.1 2H20v2H4l2.6-4.6L3 4H1z"/>',
    school: '<path d="M12 3 1 9l11 6 9-4.9V17h2V9zM5 12.5V16c0 2 3.1 4 7 4s7-2 7-4v-3.5L12 16.3z"/>',
    park: '<path d="M12 1 5 11h4l-4 6h6v6h2v-6h6l-4-6h4z"/>',
    hospital: '<path d="M5 3h4v7h6V3h4v18h-4v-7H9v7H5z"/>',
    clinic: '<path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/>',
    default: '<circle cx="12" cy="12" r="6"/>'
  };
  function iconHtml(name, color) {
    return '<div class="amen-icon" style="background:' + esc(color) + '"><svg viewBox="0 0 24 24">' + (ICONS[name] || ICONS.default) + '</svg></div>';
  }
  function amenityIcon(name, color) {
    return L.divIcon({ className: 'amen', html: iconHtml(name, color), iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10] });
  }

  function baseStyle(rt) {
    const s = rt.cfg.style || {};
    const op = rt.opacity;
    return {
      renderer: canvas,
      color: s.color || '#333',
      weight: s.weight != null ? s.weight : 1,
      opacity: (s.opacity != null ? s.opacity : 1) * (rt.cfg.geometry === 'polygon' ? Math.max(op, 0.05) : 1),
      fillColor: s.fillColor || s.color || '#333',
      fillOpacity: (s.fillOpacity != null ? s.fillOpacity : 0.3) * op,
      dashArray: s.dashArray || null,
      lineCap: s.lineCap || 'round'
    };
  }
  function styleFor(rt, f) {
    const st = baseStyle(rt);
    const rule = ruleFor(rt, f);
    if (rule) { st.color = rule.color || st.color; st.fillColor = rule.fillColor || rule.color || st.fillColor; if (rule.weight != null) st.weight = rule.weight; }
    if (rt.cfg.isZoning) {
      const code = zoningCodeOf(f);
      st.fillColor = code ? zoningColor(code) : '#cccccc';
      st.fillOpacity = (rt.cfg.style.fillOpacity != null ? rt.cfg.style.fillOpacity : 0.45) * rt.opacity;
    }
    return st;
  }

  function makeGroup(rt) {
    const g = L.geoJSON(null, {
      style: f => styleFor(rt, f),
      filter: f => (!rt.cfg.isZoning || state.zoning.active.has(zoningCodeOf(f))) && classVisible(rt, f),
      pointToLayer: (f, latlng) => {
        if (rt.cfg.icon) return L.marker(latlng, { icon: amenityIcon(rt.cfg.icon, rt.cfg.style.color), keyboard: false });
        const s = rt.cfg.style || {}, rule = ruleFor(rt, f) || {};
        return L.circleMarker(latlng, {
          renderer: canvas, radius: s.radius || 4, color: rule.color || s.color || '#333', weight: s.weight != null ? s.weight : 1,
          fillColor: rule.fillColor || s.fillColor || s.color, fillOpacity: s.fillOpacity != null ? s.fillOpacity : 0.9
        });
      },
      onEachFeature: (f, layer) => {
        layer.on('click', e => { L.DomEvent.stopPropagation(e); onFeatureClick(rt, f, e.latlng); });
      }
    });
    return g;
  }

  function renderLayer(rt) {
    rt.group.clearLayers();
    if (rt.features) rt.group.addData(rt.features);
    applyLayerOpacity(rt);
    scheduleRestack();
    updateClassCounts(rt);
  }

  /* ---------- type checkboxes for color-coded layers (colorBy) ---------- */
  const OTHER_CLASS = '(unclassified)';
  function classKey(rt, f) { const r = ruleFor(rt, f); return r ? r.label : OTHER_CLASS; }
  function classVisible(rt, f) { return !rt.hiddenClasses || !rt.hiddenClasses.size || !rt.hiddenClasses.has(classKey(rt, f)); }
  function classList(rt) {
    const cb = rt.cfg.colorBy; if (!cb) return [];
    return cb.rules.concat(cb.otherwise ? [cb.otherwise] : []);
  }
  function ruleSwatch(rt, r) {
    if (rt.cfg.geometry === 'point') return '<span class="swatch point" style="background:' + esc(r.fillColor || r.color) + ';border:1.5px solid ' + esc(r.color) + '"></span>';
    if (rt.cfg.geometry === 'line') return '<span class="swatch line" style="border-top-color:' + esc(r.color) + ';border-top-width:' + Math.max(2, Math.min(6, r.weight || 3)) + 'px;border-top-style:' + (rt.cfg.style.dashArray ? 'dashed' : 'solid') + '"></span>';
    return '<span class="swatch" style="background:' + esc(r.fillColor || r.color) + ';border:1.5px solid ' + esc(r.color) + '"></span>';
  }
  function updateClassCounts(rt) {
    const box = $('#classes-' + rt.cfg.id); if (!box || !rt.features) return;
    const counts = {};
    for (const f of rt.features) { const k = classKey(rt, f); counts[k] = (counts[k] || 0) + 1; }
    box.querySelectorAll('input[data-cls]').forEach(inp => {
      const n = inp.closest('.zcode').querySelector('.zc-n');
      if (n) n.textContent = fmtInt(counts[inp.dataset.cls] || 0);
    });
    const other = box.querySelector('.cls-other');
    if (other) other.hidden = !counts[OTHER_CLASS];
    if (other && counts[OTHER_CLASS]) other.querySelector('.zc-n').textContent = fmtInt(counts[OTHER_CLASS]);
  }
  function classTreeHtml(rt) {
    const list = classList(rt);
    if (!list.length) return '';
    const row = (key, label, sw, extraCls) => '<label class="zcode' + (extraCls ? ' ' + extraCls : '') + '"' + (extraCls ? ' hidden' : '') + '><input type="checkbox" data-cls="' + esc(key) + '" checked>' + sw +
      '<span class="zc-label">' + esc(label) + '</span><span class="zc-n" title="features loaded"></span></label>';
    return '<details class="zgroup classes" id="classes-' + rt.cfg.id + '"' + (rt.cfg.typesOpen ? ' open' : '') + '><summary>Show types <span class="muted small">(' + list.length + ')</span>' +
      '<span class="zg-actions"><button class="link-btn" data-act="all">all</button><button class="link-btn" data-act="none">none</button></span></summary>' +
      list.map(r => row(r.label, r.label, ruleSwatch(rt, r))).join('') +
      row(OTHER_CLASS, 'Other / not classified', '<span class="swatch" style="background:' + esc((rt.cfg.style || {}).fillColor || (rt.cfg.style || {}).color) + '"></span>', 'cls-other') +
      '</details>';
  }
  function wireClassTree(rt, row) {
    const box = row.querySelector('#classes-' + rt.cfg.id); if (!box) return;
    rt.hiddenClasses = rt.hiddenClasses || new Set();
    const apply = () => {
      rt.hiddenClasses = new Set(Array.from(box.querySelectorAll('input[data-cls]')).filter(i => !i.checked).map(i => i.dataset.cls));
      if (rt.on) renderLayer(rt);
      buildLegend();
    };
    box.querySelectorAll('input[data-cls]').forEach(i => i.addEventListener('change', apply));
    box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      box.querySelectorAll('input[data-cls]').forEach(i => i.checked = b.dataset.act === 'all');
      apply();
    }));
  }
  function applyLayerOpacity(rt) {
    if (rt.cfg.geometry !== 'polygon') return;
    rt.group.eachLayer(l => { if (l.setStyle && l.feature) l.setStyle(styleFor(rt, l.feature)); });
  }

  // Keep a sensible drawing order regardless of the order layers were switched on:
  // big overlays at the bottom, parcels above, then lines, then points.
  function priority(rt) {
    const c = rt.cfg;
    if (c.geometry === 'point') return 7;
    if (c.geometry === 'line') return 6;
    if (c.role === 'property') return 5;
    if (c.role === 'parcels') return 4;
    if (c.role === 'context') return 3;
    if (c.role === 'amenity') return 2;
    return 1;
  }
  const scheduleRestack = (() => {
    let pending = false;
    return () => {
      if (pending) return; pending = true;
      requestAnimationFrame(() => {
        pending = false;
        state.order.map(id => state.rt[id]).filter(rt => rt.on && map.hasLayer(rt.group))
          .sort((a, b) => priority(a) - priority(b))
          .forEach(rt => rt.group.eachLayer(l => { if (l.bringToFront && !(l instanceof L.Marker)) l.bringToFront(); }));
      });
    };
  })();

  async function setLayerOn(rt, on) {
    rt.on = on;
    const cb = $('#cb-' + rt.cfg.id); if (cb) cb.checked = on;
    const extra = $('#extra-' + rt.cfg.id); if (extra) extra.querySelector('.opacity') && (extra.querySelector('.opacity').hidden = !on);
    if (!on) {
      if (rt.abort) rt.abort.abort();
      map.removeLayer(rt.group);
      setStatus(rt, rt.error ? 'error' : (rt.loaded ? 'ok' : 'idle'));
    } else if (isViewport(rt)) {
      if (rt.cfg.isZoning && !state.zoning.ready) {
        setStatus(rt, 'loading', 'Loading districts…');
        try { await loadZoningCodes(rt); } catch (e) { rt.error = e.message; setStatus(rt, 'error'); buildLegend(); return; }
      }
      await loadViewport(rt);
    } else {
      map.addLayer(rt.group);
      if (rt.loaded) { renderLayer(rt); setStatus(rt, 'ok'); }
      else { ensureLoaded(rt).catch(() => {}); }
    }
    buildLegend();
    updateMapHints();
  }

  const reloadViewportLayers = debounce(() => {
    state.order.map(id => state.rt[id]).filter(rt => rt.on && isViewport(rt)).forEach(loadViewport);
  }, 350);
  map.on('moveend', reloadViewportLayers);
  map.on('dragstart zoomstart', e => { if (e.hard !== false) state.userMoved = true; });

  function updateMapHints() {
    const need = state.order.map(id => state.rt[id]).filter(rt => rt.on && isViewport(rt) && map.getZoom() < (rt.cfg.source.minZoom || 0));
    const el = $('#mapStatus');
    if (need.length) {
      el.textContent = 'Zoom in to see ' + need.map(r => r.cfg.name + ' (zoom ' + r.cfg.source.minZoom + '+)').join(', ') + ' · current zoom ' + map.getZoom();
      el.hidden = false;
    } else el.hidden = true;
  }
  map.on('zoomend', updateMapHints);

  /* ---------- feature click ---------- */
  function onFeatureClick(rt, f, latlng) {
    const role = rt.cfg.role;
    if (role === 'property' || role === 'parcels') { selectFeature(rt, f); return; }
    L.popup({ maxWidth: 320 }).setLatLng(latlng).setContent(popupHtml(rt, f)).openOn(map);
  }
  function popupHtml(rt, f) {
    const p = f.properties || {};
    let title, sub;
    if (rt.cfg.isZoning) {
      const code = zoningCodeOf(f);
      title = 'Zoning: ' + (code || 'unknown');
      sub = (zoningDesc(code) ? zoningDesc(code) + ' · ' : '') + groupNameOf(code);
    } else {
      title = featureName(p, rt.cfg.name, rt);
      const typeKey = pick(p, asList(rt.cfg.typeField).concat(['type', 'category', 'facility_type', 'facilitytype', 'school_type', 'subtype', 'fld_zone']));
      const rule = ruleFor(rt, f);
      sub = rt.cfg.name + (typeKey ? ' · ' + valueLabel(typeKey.key, typeKey.value) : (rule && rule.label ? ' · ' + rule.label : ''));
    }
    const addr = featureAddress(p, rt);
    const rows = Object.keys(p).filter(k => !isBlank(p[k]) && !/^(shape|objectid|fid|globalid)/i.test(k))
      .map(k => '<tr><td>' + esc(k) + '</td><td>' + esc(valueLabel(k, p[k])) + '</td></tr>').join('');
    return '<div class="pop-title">' + esc(title) + '</div><div class="pop-sub">' + esc(sub) + (addr ? '<br>' + esc(addr) : '') + '</div>' +
      (rows ? '<details><summary class="small">All attributes</summary><div class="pop-scroll"><table class="pop-table">' + rows + '</table></div></details>' : '');
  }

  /* ===================================================================
     5. LEFT SIDEBAR — LAYER TREE, ZONING, LEGEND
     =================================================================== */
  function swatchHtml(cfg) {
    const s = cfg.style || {};
    if (cfg.icon && cfg.geometry === 'point') return iconHtml(cfg.icon, s.color);
    if (cfg.geometry === 'line') return '<span class="swatch line" style="border-top-color:' + esc(s.color) + ';border-top-style:' + (s.dashArray ? 'dashed' : 'solid') + '"></span>';
    if (cfg.geometry === 'point') return '<span class="swatch point" style="background:' + esc(s.fillColor || s.color) + ';border:1.5px solid ' + esc(s.color) + '"></span>';
    if (cfg.isZoning) return '<span class="swatch" style="background:linear-gradient(90deg,#ffc857 0 25%,#e46767 25% 50%,#5fbfb2 50% 75%,#9d7dd2 75%)"></span>';
    return '<span class="swatch" style="background:' + esc(s.fillColor || s.color) + ';opacity:.85;border:1.5px ' + (s.dashArray ? 'dashed' : 'solid') + ' ' + esc(s.color) + '"></span>';
  }

  function buildLayerTree() {
    const tree = $('#layerTree');
    tree.innerHTML = '';
    for (const cat of CFG.categories) {
      const det = document.createElement('details');
      det.className = 'cat'; det.open = !!cat.open;
      const connected = cat.layers.filter(l => state.rt[l.id].connected).length;
      det.innerHTML = '<summary>' + esc(cat.name) + '<span class="cat-count">' + connected + ' / ' + cat.layers.length + ' connected</span></summary>';
      const body = document.createElement('div'); body.className = 'cat-body';
      for (const lc of cat.layers) body.appendChild(layerRow(state.rt[lc.id]));
      det.appendChild(body);
      tree.appendChild(det);
    }
  }

  function layerRow(rt) {
    const c = rt.cfg;
    const row = document.createElement('div');
    row.className = 'layer-row' + (rt.connected ? '' : ' disabled');
    row.innerHTML =
      '<div class="layer-main">' +
        '<input type="checkbox" id="cb-' + c.id + '"' + (rt.connected ? '' : ' disabled') + '>' +
        swatchHtml(c) +
        '<label for="cb-' + c.id + '">' + esc(c.name) + '</label>' +
        '<span class="badge" id="badge-' + c.id + '"></span>' +
        '<button class="info-btn" title="About this dataset" aria-label="About ' + esc(c.name) + '">i</button>' +
      '</div>' +
      '<div class="layer-extra" id="extra-' + c.id + '">' +
        (c.geometry === 'polygon' ? '<label class="opacity" hidden>Opacity <input type="range" min="0" max="100" value="' + Math.round(rt.opacity * 100) + '"><span class="op-val">' + Math.round(rt.opacity * 100) + '%</span></label>' : '') +
        '<div class="layer-meta" hidden></div>' +
        (c.isZoning ? '<div class="zoning-tree" id="zoningTree"></div>' : '') +
        (c.colorBy && rt.connected ? classTreeHtml(rt) : '') +
      '</div>';
    const cb = row.querySelector('input[type=checkbox]');
    cb.addEventListener('change', () => setLayerOn(rt, cb.checked));
    row.querySelector('.info-btn').addEventListener('click', () => {
      const m = row.querySelector('.layer-meta');
      m.hidden = !m.hidden;
      if (!m.hidden) m.innerHTML = metaHtml(rt);
    });
    const slider = row.querySelector('.opacity input');
    if (slider) slider.addEventListener('input', () => {
      rt.opacity = slider.value / 100;
      row.querySelector('.op-val').textContent = slider.value + '%';
      applyLayerOpacity(rt);
    });
    setTimeout(() => setStatus(rt, rt.connected ? (rt.error ? 'error' : 'idle') : 'nc'), 0);
    if (c.isZoning) setTimeout(buildZoningTree, 0);
    if (c.colorBy && rt.connected) wireClassTree(rt, row);
    return row;
  }

  function metaHtml(rt) {
    const c = rt.cfg, s = c.source || {};
    const parts = [];
    parts.push('<b>Dataset:</b> ' + (c.dataset ? esc(c.dataset) : '<span class="na">not specified</span>'));
    parts.push('<b>Publisher:</b> ' + (c.publisher ? esc(c.publisher) : '<span class="na">not specified</span>'));
    if (c.note) parts.push('<b>About:</b> ' + esc(c.note));
    if (!rt.connected) {
      parts.push('<b>Status:</b> Not connected — no source URL set in <code>config/layers.js</code>.');
    } else {
      parts.push('<b>Source (' + esc(s.type) + '):</b> ' + esc(rt.url));
      if (s.where && s.where !== '1=1') parts.push('<b>Filter:</b> ' + esc(s.where));
      parts.push('<b>Retrieved:</b> ' + (c.retrieved ? esc(c.retrieved) : '<span class="na">date not recorded in config</span>'));
      if (rt.publisherUpdated) parts.push('<b>Publisher last edited:</b> ' + esc(rt.publisherUpdated));
      if (rt.loaded) parts.push('<b>Features loaded:</b> ' + fmtInt(rt.features.length) + (isViewport(rt) ? ' (current area)' : ''));
      if (isViewport(rt)) parts.push('<b>Loads:</b> visible area only, at zoom ' + (s.minZoom || 0) + '+');
      if (rt.note) parts.push('<b>Note:</b> ' + esc(rt.note));
      if (rt.error) parts.push('<b style="color:var(--bad)">Error:</b> ' + esc(rt.error));
    }
    return parts.join('<br>');
  }

  function setStatus(rt, status, text) {
    rt.status = status;
    const b = $('#badge-' + rt.cfg.id);
    if (!b) return;
    const map_ = {
      nc: ['nc', 'Not connected'], idle: ['', 'Ready'], loading: ['loading', text || 'Loading…'],
      zoom: ['zoom', 'Zoom in'], error: ['err', 'Error'],
      ok: ['ok', rt.features ? (isViewport(rt) ? fmtInt(rt.inView != null ? rt.inView : rt.features.length) + ' in view' : fmtInt(rt.features.length)) : 'Ready']
    };
    const [cls, label] = map_[status] || ['', status];
    b.className = 'badge ' + cls;
    b.textContent = label;
    b.title = status === 'error' ? rt.error : (status === 'nc' ? 'No data source has been connected for this layer yet' : '');
    const m = b.closest('.layer-row') && b.closest('.layer-row').querySelector('.layer-meta');
    if (m && !m.hidden) m.innerHTML = metaHtml(rt);
  }

  /* ---------- zoning sub-categories ---------- */
  function zoningCodeOf(f) {
    const p = f.properties || {};
    if (!state.zoning.field) state.zoning.field = findKey(p, CFG.zoning.fieldCandidates);
    const v = state.zoning.field ? p[state.zoning.field] : null;
    return isBlank(v) ? '(blank)' : String(v).trim().toUpperCase();
  }
  function zoningDesc(code) { return state.zoning.desc[code] || ''; }
  function groupOf(code) {
    for (const g of CFG.zoning.groups) if (new RegExp(g.pattern, 'i').test(code)) return g.id;
    return 'other';
  }
  function groupNameOf(code) {
    const g = CFG.zoning.groups.find(x => x.id === groupOf(code));
    return g ? g.name : CFG.zoning.otherGroupName;
  }
  function zoningColor(code) {
    const z = state.zoning.codes.get(code);
    if (z) return z.color;
    return CFG.zoning.colors[code] || '#cccccc';
  }
  function naturalCmp(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }

  function buildZoningCodes(rt) {
    const counts = new Map();
    state.zoning.field = null;
    const dk = rt.features.length ? findKey(rt.features[0].properties, CFG.zoning.descriptionFields || []) : null;
    for (const f of rt.features) {
      const c = zoningCodeOf(f); counts.set(c, (counts.get(c) || 0) + 1);
      if (dk && !state.zoning.desc[c] && !isBlank(f.properties[dk])) state.zoning.desc[c] = String(f.properties[dk]);
    }
    setZoningCodes(counts);
  }
  /** For big zoning layers loaded by map area: get the full district list from the server's statistics. */
  async function loadZoningCodes(rt) {
    if (state.zoning.ready || !rt.connected) return;
    if (rt.cfg.source.type !== 'arcgis') { await ensureLoaded(rt); return; }
    const meta = await arcgisMeta(rt);
    const fake = Object.fromEntries((meta.fields || []).map(f => [f.name, 1]));
    const field = findKey(fake, CFG.zoning.fieldCandidates);
    if (!field) { state.zoning.ready = true; state.zoning.field = null; buildZoningTree(); return; }
    const dk = findKey(fake, CFG.zoning.descriptionFields || []);
    const qs = new URLSearchParams({
      where: rt.cfg.source.where || '1=1', groupByFieldsForStatistics: field + (dk ? ',' + dk : ''),
      outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: field, outStatisticFieldName: 'n_features' }]), f: 'json'
    });
    const data = await fetchJson(rt.url + '/query?' + qs.toString());
    if (data.error) throw new Error('ArcGIS error: ' + (data.error.message || 'statistics query failed'));
    const counts = new Map();
    for (const ft of data.features || []) {
      const a = ft.attributes || {};
      const c = isBlank(a[field]) ? '(blank)' : String(a[field]).trim().toUpperCase();
      const n = a.n_features != null ? a.n_features : (a.N_FEATURES || 0);
      counts.set(c, (counts.get(c) || 0) + n);
      if (dk && !isBlank(a[dk]) && !state.zoning.desc[c]) state.zoning.desc[c] = String(a[dk]);
    }
    state.zoning.field = field;
    setZoningCodes(counts);
  }
  function setZoningCodes(counts) {
    let fb = 0;
    state.zoning.codes = new Map();
    Array.from(counts.keys()).sort(naturalCmp).forEach(code => {
      const color = CFG.zoning.colors[code] || CFG.zoning.fallbackPalette[fb++ % CFG.zoning.fallbackPalette.length];
      state.zoning.codes.set(code, { code, count: counts.get(code), group: groupOf(code), color });
    });
    state.zoning.active = new Set(state.zoning.codes.keys());
    state.zoning.ready = true;
    buildZoningTree();
  }

  function buildZoningTree() {
    const box = $('#zoningTree');
    if (!box) return;
    const rt = state.rt[CFG.zoning.layerId];
    if (!rt || !rt.connected) { box.innerHTML = '<p class="muted small" style="margin:2px 0">Individual districts (R1–R6, B, SD, M, PD…) appear here once the zoning dataset is connected.</p>'; return; }
    if (!state.zoning.ready) { box.innerHTML = '<p class="muted small" style="margin:2px 0">Turn on Zoning Districts to load the district list.</p>'; return; }
    if (!state.zoning.field) { box.innerHTML = '<p class="muted small" style="margin:2px 0;color:var(--bad)">No zoning code column found. Add the column name to <code>zoning.fieldCandidates</code> in config.</p>'; return; }
    const groups = CFG.zoning.groups.concat([{ id: 'other', name: CFG.zoning.otherGroupName }]);
    box.innerHTML = '<div class="small muted" style="margin:2px 0 4px">Districts from column <code>' + esc(state.zoning.field) + '</code></div>';
    for (const g of groups) {
      const codes = Array.from(state.zoning.codes.values()).filter(z => z.group === g.id);
      if (!codes.length) continue;
      const d = document.createElement('details');
      d.className = 'zgroup'; d.open = g.id === 'res';
      d.innerHTML = '<summary>' + esc(g.name) + ' <span class="muted small">(' + codes.length + ')</span><span class="zg-actions"><button class="link-btn" data-act="all">all</button><button class="link-btn" data-act="none">none</button></span></summary>' +
        codes.map(z => '<label class="zcode" title="' + esc(zoningDesc(z.code)) + '"><input type="checkbox" data-code="' + esc(z.code) + '"' + (state.zoning.active.has(z.code) ? ' checked' : '') + '><span class="swatch" style="background:' + esc(z.color) + '"></span><span class="zc-label">' + esc(z.code) + (zoningDesc(z.code) ? ' <span class="zc-desc">' + esc(zoningDesc(z.code)) + '</span>' : '') + '</span><span class="zc-n" title="map features">' + fmtInt(z.count) + '</span></label>').join('');
      d.querySelectorAll('input[data-code]').forEach(inp => inp.addEventListener('change', () => {
        if (inp.checked) state.zoning.active.add(inp.dataset.code); else state.zoning.active.delete(inp.dataset.code);
        refreshZoning();
      }));
      d.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const on = btn.dataset.act === 'all';
        codes.forEach(z => on ? state.zoning.active.add(z.code) : state.zoning.active.delete(z.code));
        d.querySelectorAll('input[data-code]').forEach(i => i.checked = on);
        refreshZoning();
      }));
      box.appendChild(d);
    }
  }
  function refreshZoning() {
    const rt = state.rt[CFG.zoning.layerId];
    if (rt && rt.on) renderLayer(rt);
    buildLegend();
  }

  /* ---------- legend ---------- */
  function buildLegend() {
    const box = $('#legend');
    const on = state.order.map(id => state.rt[id]).filter(rt => rt.on);
    if (!on.length) { box.innerHTML = '<p class="muted small">Turn on a layer to see its symbol here.</p>'; return; }
    let html = '';
    for (const cat of CFG.categories) {
      const items = cat.layers.map(l => state.rt[l.id]).filter(rt => rt.on);
      if (!items.length) continue;
      html += '<div class="legend-group">' + esc(cat.name) + '</div>';
      for (const rt of items) {
        if (rt.cfg.isZoning && state.zoning.ready) {
          html += '<div class="legend-item"><span class="legend-sym">' + swatchHtml(rt.cfg) + '</span>' + esc(rt.cfg.name) + '</div>';
          Array.from(state.zoning.codes.values()).filter(z => state.zoning.active.has(z.code)).forEach(z => {
            html += '<div class="legend-item" style="padding-left:14px"><span class="legend-sym"><span class="swatch" style="background:' + esc(z.color) + ';border:1px solid rgba(0,0,0,.25)"></span></span>' + esc(z.code) + ' <span class="muted small">' + esc(zoningDesc(z.code) || groupNameOf(z.code)) + '</span></div>';
          });
        } else {
          html += '<div class="legend-item"><span class="legend-sym">' + swatchHtml(rt.cfg) + '</span>' + esc(rt.cfg.name) + '</div>';
          const cb = rt.cfg.colorBy;
          if (cb) classList(rt).filter(r => !(rt.hiddenClasses && rt.hiddenClasses.has(r.label))).forEach(r => {
            html += '<div class="legend-item" style="padding-left:14px"><span class="legend-sym">' + ruleSwatch(rt, r) + '</span>' + esc(r.label) + '</div>';
          });
        }
      }
    }
    if (state.selection) {
      html += '<div class="legend-group">Selection</div><div class="legend-item"><span class="legend-sym"><span class="swatch" style="background:rgba(255,214,10,.35);border:2.5px solid #0f5e8c"></span></span>Selected site</div>';
      if (state.bufferId) html += '<div class="legend-item"><span class="legend-sym"><span class="swatch" style="background:rgba(15,94,140,.06);border:1.5px dashed #0f5e8c;border-radius:50%"></span></span>Distance ring (straight line)</div>';
    }
    box.innerHTML = html;
  }

  /* ===================================================================
     6. SITE SELECTION, BUFFERS & PROPERTY PANEL
     =================================================================== */
  const propLayers = () => state.order.map(id => state.rt[id]).filter(rt => rt.connected && (rt.cfg.role === 'property' || rt.cfg.role === 'parcels'));
  const byRole = role => state.order.map(id => state.rt[id]).filter(rt => rt.cfg.role === role);
  const bufferMiles = () => { const b = CFG.buffers.find(x => x.id === state.bufferId); return b ? b.miles : 0; };

  /** Select a feature as the current candidate site. EXTENSION POINT: adjacency / comparison. */
  async function selectFeature(rt, f, opts) {
    // Clicking the property that is already selected unselects it.
    if (state.selection && !(opts && opts.keep) &&
        (state.selection.feature === f || (state.selection.parcel && state.selection.parcel.feature === f) ||
         (state.selection.rt === rt && featureKey(state.selection.feature) === featureKey(f)))) {
      clearSelection();
      return;
    }
    const token = ++state.selToken;
    map.closePopup();
    const sel = { rt, feature: f, parcel: null, boundary: null, results: {} };
    state.selection = sel;

    if (isPolyType(f.geometry)) { sel.boundary = f.geometry; }
    else {
      // A point was clicked (e.g. DLBA points): look up the parcel polygon that contains it.
      const parcelsRt = byRole('parcels').find(r => r.connected);
      if (parcelsRt && parcelsRt !== rt) {
        try {
          const near = await featuresNear(parcelsRt, expandBbox(bboxOf(f.geometry), 5));
          if (token !== state.selToken) return;
          const hit = (near.features || []).find(pf => isPolyType(pf.geometry) && geomIntersects(f.geometry, pf.geometry));
          if (hit) { sel.parcel = { rt: parcelsRt, feature: hit }; sel.boundary = hit.geometry; }
        } catch (e) { console.warn('Parcel lookup failed', e); }
      }
    }
    sel.geom = sel.boundary || f.geometry;
    sel.center = repPoint(sel.geom);
    drawSelection();
    showTab('property');
    openRightPanel();
    renderPanel();
    buildLegend();
    runAnalysis(token);
  }

  function clearSelection() {
    state.selToken++;
    state.selection = null;
    selectionGroup.clearLayers();
    bufferGroup.clearLayers();
    searchGroup.clearLayers();
    $('#propertyContent').hidden = true;
    $('#propertyEmpty').hidden = false;
    buildLegend();
  }

  function drawSelection() {
    selectionGroup.clearLayers();
    const sel = state.selection; if (!sel) return;
    const gj = { type: 'Feature', geometry: sel.geom, properties: {} };
    if (isPolyType(sel.geom)) {
      L.geoJSON(gj, { renderer: selRenderer, interactive: false, style: { color: '#ffffff', weight: 6, opacity: 0.9, fill: false } }).addTo(selectionGroup);
      L.geoJSON(gj, { renderer: selRenderer, interactive: false, style: { color: '#0f5e8c', weight: 3, opacity: 1, fillColor: '#ffd60a', fillOpacity: 0.35 } }).addTo(selectionGroup);
    } else {
      const ll = L.latLng(sel.center[1], sel.center[0]);
      L.circleMarker(ll, { renderer: selRenderer, interactive: false, radius: 11, color: '#0f5e8c', weight: 3, fillColor: '#ffd60a', fillOpacity: 0.5 }).addTo(selectionGroup);
    }
    drawBuffer();
  }
  function drawBuffer() {
    bufferGroup.clearLayers();
    const sel = state.selection; const mi = bufferMiles();
    if (!sel || !mi) return;
    const ll = L.latLng(sel.center[1], sel.center[0]);
    L.circle(ll, { renderer: selRenderer, interactive: false, radius: mi * M_PER_MILE, color: '#0f5e8c', weight: 1.75, dashArray: '6 5', fillColor: '#0f5e8c', fillOpacity: 0.05 }).addTo(bufferGroup);
    L.circleMarker(ll, { renderer: selRenderer, interactive: false, radius: 2.5, color: '#0f5e8c', fillOpacity: 1 }).addTo(bufferGroup);
  }
  function setBuffer(id) {
    state.bufferId = id;
    drawBuffer();
    buildLegend();
    if (state.selection) {
      const sel = state.selection;
      if (id) { const c = L.latLng(sel.center[1], sel.center[0]); map.fitBounds(c.toBounds(bufferMiles() * M_PER_MILE * 2.1), { maxZoom: 17 }); }
      renderPanel();
      runAnalysis(state.selToken);
    }
  }

  /** Pull the panel's property facts from the selected feature, then the matched parcel. */
  function propertyFacts(sel) {
    const F = CFG.propertyFields;
    const sources = [{ name: sel.rt.cfg.name, props: sel.feature.properties || {}, rt: sel.rt }];
    if (sel.parcel) sources.push({ name: sel.parcel.rt.cfg.name, props: sel.parcel.feature.properties || {}, rt: sel.parcel.rt });
    const get = (key) => { for (const s of sources) { const p = pick(s.props, layerCands(s.rt, key)); if (p) return { value: p.value, field: p.key, src: s.name }; } return null; };
    const facts = {};
    for (const k of Object.keys(F)) facts[k] = get(k);
    // Lot size: prefer the dataset's own figure; else compute from the mapped boundary (and say so).
    const sq = facts.lotSqft ? parseFloat(String(facts.lotSqft.value).replace(/,/g, '')) : NaN;
    const ac = facts.lotAcres ? parseFloat(String(facts.lotAcres.value).replace(/,/g, '')) : NaN;
    if (isFinite(sq) && sq > 0) facts.lot = { sqft: sq, acres: isFinite(ac) && ac > 0 ? ac : sq / SQFT_PER_ACRE, how: 'from ' + facts.lotSqft.src + ' (' + facts.lotSqft.field + ')' };
    else if (isFinite(ac) && ac > 0) facts.lot = { sqft: ac * SQFT_PER_ACRE, acres: ac, how: 'from ' + facts.lotAcres.src + ' (' + facts.lotAcres.field + ')' };
    else if (sel.boundary) { const m2 = geomAreaSqm(sel.boundary); facts.lot = { sqft: m2 * SQFT_PER_SQM, acres: m2 * SQFT_PER_SQM / SQFT_PER_ACRE, how: 'calculated from the mapped parcel boundary', approx: true }; }
    return facts;
  }

  function factRow(label, fact, extra) {
    const v = fact ? '<span title="' + esc(fact.src + ' · ' + fact.field) + '">' + esc(valueLabel(fact.field, fact.value)) + '</span>' : '<span class="na">Not in connected data</span>';
    return '<dt>' + esc(label) + '</dt><dd>' + v + (extra || '') + '</dd>';
  }

  function renderPanel() {
    const sel = state.selection; if (!sel) return;
    const facts = propertyFacts(sel);
    sel.facts = facts;
    const title = facts.address ? fmtVal(facts.address.value) : 'Unaddressed property';
    const pid = facts.parcelId ? fmtVal(facts.parcelId.value) : '';
    const lot = facts.lot ? fmtInt(facts.lot.sqft) + ' sq ft · ' + fmtNum(facts.lot.acres, 3) + ' acres' + (facts.lot.approx ? ' <span class="muted small">(approx.)</span>' : '') : '<span class="na">Not in connected data</span>';
    const inList = state.shortlist.some(s => s.key === siteKey(sel));
    const bufs = '<button data-buf=""' + (!state.bufferId ? ' class="on"' : '') + '>Off</button>' + CFG.buffers.map(b => '<button data-buf="' + b.id + '"' + (state.bufferId === b.id ? ' class="on"' : '') + '>' + esc(b.label) + '</button>').join('');

    const html =
      '<div class="prop-head">' +
        '<button class="icon-btn prop-close" id="closeSel" title="Unselect this property (or press Esc, or click it again)" aria-label="Unselect property">✕</button>' +
        '<div class="prop-kicker">' + esc(sel.rt.cfg.name) + '</div>' +
        '<div class="prop-title">' + esc(title) + '</div>' +
        '<div class="prop-sub">' + (pid ? 'Parcel ' + esc(pid) : '<span class="na">Parcel ID not in connected data</span>') + '</div>' +
        '<div class="prop-actions">' +
          '<button class="btn small primary" id="addShortlist"' + (inList ? ' disabled' : '') + '>' + (inList ? '✓ In shortlist' : '+ Add to shortlist') + '</button>' +
          '<button class="btn small" id="zoomSel">Zoom to site</button>' +
          '<button class="btn small" id="clearSel">Clear selection</button>' +
        '</div>' +
      '</div>' +
      locationHtml(sel, title) +
      '<div class="buffer-ctl"><span class="small muted">Distance ring</span><span class="seg">' + bufs + '</span></div>' +

      '<details class="section" open><summary>Property</summary><div class="section-body"><dl class="kv">' +
        '<dt>Lot size</dt><dd>' + lot + (facts.lot ? '<div class="src-note">' + esc(facts.lot.how) + '</div>' : '') + '</dd>' +
        factRow('Owner', facts.owner) +
        factRow('DLBA status', facts.dlbaStatus, '<div id="dlbaCheck" class="src-note"></div>') +
        factRow('Zoning', facts.zoning, '<div id="zoningCheck" class="src-note"></div>') +
        factRow('Vacancy', facts.vacancy, '<div id="vacantCheck" class="src-note"></div>') +
        factRow('Property class', facts.propClass) +
        factRow('Land use', facts.landUse) +
        factRow('Buildings', facts.buildings) +
        factRow('Year built', facts.yearBuilt) +
        factRow('Building floor area', facts.floorArea, facts.floorArea ? ' <span class="muted small">sq ft (Assessor)</span>' : '') +
        factRow('Tax status', facts.taxStatus) +
        factRow('Census tract', facts.tract) +
        factRow('Neighborhood', facts.neighborhood) +
        factRow('Council district', facts.district) +
        factRow('Assessed value', facts.assessed) +
      '</dl>' +
      (sel.parcel ? '<div class="src-note">Boundary matched from ' + esc(sel.parcel.rt.cfg.name) + '.</div>' : (!isPolyType(sel.feature.geometry) ? '<div class="src-note">No parcel boundary matched' + (byRole('parcels').some(r => r.connected) ? '' : ' (Parcel Boundaries not connected)') + ' — analysis uses the point location.</div>' : '')) +
      '</div></details>' +

      '<details class="section" open><summary>Financial eligibility overlays</summary><div class="section-body" id="sec-financial">' + loadingRows(byRole('financial')) + '</div></details>' +
      '<details class="section" open><summary>Nearby transportation<span class="sec-note">' + ringNote() + '</span></summary><div class="section-body" id="sec-transit">' + loadingRows(byRole('transit')) + '</div></details>' +
      '<details class="section" open><summary>Nearby amenities<span class="sec-note">' + ringNote() + '</span></summary><div class="section-body" id="sec-amenity">' + loadingRows(byRole('amenity')) + '</div></details>' +
      '<details class="section" open><summary>Environmental conditions</summary><div class="section-body" id="sec-environment">' + loadingRows(byRole('environment')) +
        '</div></details>' +
      '<details class="section"><summary>All attributes</summary><div class="section-body">' + attrTables(sel) + '</div></details>';

    const box = $('#propertyContent');
    box.innerHTML = html;
    box.hidden = false;
    $('#propertyEmpty').hidden = true;
    $('#addShortlist').addEventListener('click', addToShortlist);
    $('#zoomSel').addEventListener('click', zoomToSelection);
    $('#clearSel').addEventListener('click', clearSelection);
    $('#closeSel').addEventListener('click', clearSelection);
    const cp = $('#copyCoords');
    if (cp) cp.addEventListener('click', () => copyText(cp.dataset.text, cp));
    $$('.buffer-ctl button', box).forEach(b => b.addEventListener('click', () => setBuffer(b.dataset.buf || null)));
  }
  /** Exact location of the selected site + links to view it in Google Maps / Street View / Google Earth. */
  function locationHtml(sel, title) {
    const lat = sel.center[1].toFixed(6), lng = sel.center[0].toFixed(6);
    const ll = lat + ',' + lng;
    const links = [
      ['Google Maps (satellite)', 'https://www.google.com/maps/@?api=1&map_action=map&center=' + ll + '&zoom=20&basemap=satellite'],
      ['Street View', 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + ll],
      ['Google Earth', 'https://earth.google.com/web/@' + lat + ',' + lng + ',190a,250d,35y,0h,45t,0r']
    ];
    return '<div class="loc-box">' +
      '<div class="loc-row"><span class="small muted">Location (lat, long)</span>' +
        '<code class="loc-coords">' + ll + '</code>' +
        '<button class="btn small" id="copyCoords" data-text="' + ll + '" title="Copy coordinates">Copy</button></div>' +
      '<div class="loc-links">' + links.map(([t, u]) => '<a class="btn small" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(t) + ' ↗</a>').join('') + '</div>' +
      '<div class="src-note">Point is inside the ' + (sel.boundary ? 'parcel boundary' : 'mapped point') + '. Paste the coordinates into Google Earth\'s search box if a link doesn\'t open there.</div>' +
    '</div>';
  }
  function copyText(text, btn) {
    const done = ok => { if (btn) { const t = btn.textContent; btn.textContent = ok ? 'Copied ✓' : 'Select & copy'; setTimeout(() => btn.textContent = t, 1500); } };
    try {
      if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(() => done(true), () => fallback()); return; }
    } catch (e) { /* use fallback */ }
    fallback();
    function fallback() {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove(); done(ok);
    }
  }
  function ringNote() { const b = CFG.buffers.find(x => x.id === state.bufferId); return b ? 'within ' + b.label + ' (straight line)' : 'ring off'; }
  function loadingRows(rts) {
    if (!rts.some(r => r.connected)) return rts.map(r => flagHtml(r.cfg.name, 'nc', 'Not connected')).join('');
    return '<p class="muted small" style="margin:2px 0">Checking connected layers…</p>';
  }
  function flagHtml(name, cls, tag, detail) {
    return '<div class="flag"><span class="fl-name">' + esc(name) + (detail ? '<span class="fl-detail">' + detail + '</span>' : '') + '</span><span class="tag ' + cls + '">' + esc(tag) + '</span></div>';
  }
  function attrTables(sel) {
    const t = (name, p) => {
      const rows = Object.keys(p || {}).filter(k => !/^shape/i.test(k)).map(k => '<tr><td>' + esc(k) + '</td><td>' + (isBlank(p[k]) ? '<span class="na">—</span>' : esc(fmtVal(p[k]))) + '</td></tr>').join('');
      return '<div class="small" style="font-weight:600;margin:4px 0">' + esc(name) + '</div><table class="attr-table">' + (rows || '<tr><td colspan="2" class="na">No attributes</td></tr>') + '</table>';
    };
    return t(sel.rt.cfg.name, sel.feature.properties) + (sel.parcel ? t(sel.parcel.rt.cfg.name, sel.parcel.feature.properties) : '');
  }
  function zoomToSelection() {
    const sel = state.selection; if (!sel) return;
    const b = bboxOf(sel.geom);
    if (b[0] === b[2]) map.setView([b[1], b[0]], Math.max(map.getZoom(), 17));
    else map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { maxZoom: 18, padding: [60, 60] });
  }

  /** Overlay checks + nearby features. EXTENSION POINT: suitability scoring would read sel.results. */
  async function runAnalysis(token) {
    const sel = state.selection; if (!sel) return;
    const radiusM = bufferMiles() * M_PER_MILE;
    const geom = sel.geom, center = sel.center;
    const siteBox = expandBbox(bboxOf(geom), 2);
    const ringBox = expandBbox([center[0], center[1], center[0], center[1]], Math.max(radiusM, 1));
    const stale = () => token !== state.selToken || state.selection !== sel;

    // ---- cross-checks in the Property section ----
    const crossCheck = async (rt, elId, label) => {
      const el = $('#' + elId); if (!el || !rt || !rt.connected || rt === sel.rt) return;
      try {
        const r = await featuresNear(rt, siteBox); if (stale()) return;
        const hit = r.features.some(f => siteHits(geom, center, f.geometry));
        el.innerHTML = hit ? '✓ ' + esc(label) + ' layer has a feature at this site' : 'No feature at this site in the ' + esc(label) + ' layer';
      } catch (e) { el.textContent = label + ' check failed: ' + e.message; }
    };
    crossCheck(state.rt.dlba, 'dlbaCheck', state.rt.dlba ? state.rt.dlba.cfg.name : '');
    crossCheck(state.rt.vacant, 'vacantCheck', state.rt.vacant ? state.rt.vacant.cfg.name : '');
    const zrt = state.rt[CFG.zoning.layerId];
    if (zrt && zrt.connected) {
      (async () => {
        try {
          const r = await featuresNear(zrt, siteBox); if (stale()) return;
          const codes = [...new Set(r.features.filter(f => siteHits(geom, center, f.geometry)).map(zoningCodeOf))];
          const el = $('#zoningCheck');
          if (el) el.innerHTML = codes.length ? 'Zoning Districts layer: <b>' + codes.map(c => esc(c) + (zoningDesc(c) ? ' (' + esc(zoningDesc(c)) + ')' : '')).join(', ') + '</b>' + (codes.length > 1 ? ' — site spans more than one district' : '') : 'No zoning district found at this site in the Zoning Districts layer';
          sel.results.zoningCodes = codes;
        } catch (e) { const el = $('#zoningCheck'); if (el) el.textContent = 'Zoning lookup failed: ' + e.message; }
      })();
    }

    // ---- financial overlays ----
    (async () => {
      const out = [];
      for (const rt of byRole('financial')) {
        if (!rt.connected) { out.push(flagHtml(rt.cfg.name, 'nc', 'Not connected')); continue; }
        try {
          const r = await featuresNear(rt, siteBox); if (stale()) return;
          const hits = r.features.filter(f => siteHits(geom, center, f.geometry));
          const centerIn = hits.some(f => pointInGeom(center, f.geometry));
          const ids = hits.map(f => featureName(f.properties, '', rt) || (pick(f.properties, ['geoid', 'tract', 'namelsad', 'zcta', 'zip']) || {}).value).filter(Boolean);
          const detail = ids.length ? esc([...new Set(ids)].slice(0, 3).join(', ')) : '';
          let res;
          if (!hits.length) { out.push(flagHtml(rt.cfg.name, 'no', 'Outside')); res = 'Outside'; }
          else if (centerIn || isPointType(geom)) { out.push(flagHtml(rt.cfg.name, 'yes', 'Inside', detail)); res = 'Inside'; }
          else { out.push(flagHtml(rt.cfg.name, 'warn', 'Partly inside', 'Boundary crosses the site' + (detail ? ' · ' + detail : ''))); res = 'Partly inside'; }
          sel.results[rt.cfg.id] = res;
        } catch (e) { out.push(flagHtml(rt.cfg.name, 'bad', 'Error', esc(e.message))); }
      }
      out.push('<div class="callout info">Overlay status is a map test against the connected boundary file. Confirm eligibility against the official HUD / City source before relying on it.</div>');
      const el = $('#sec-financial'); if (el && !stale()) el.innerHTML = out.join('');
    })();

    // ---- nearby lists (transit + amenities) ----
    const nearbySection = async (role, elId) => {
      const rts = byRole(role);
      const out = [];
      if (!radiusM) {
        const el = $('#' + elId);
        if (el && !stale()) el.innerHTML = '<p class="muted small" style="margin:2px 0">Choose a distance ring above to list ' + (role === 'transit' ? 'transportation' : 'amenities') + ' near this site.</p>' + rts.filter(r => !r.connected).map(r => flagHtml(r.cfg.name, 'nc', 'Not connected')).join('');
        return;
      }
      for (const rt of rts) {
        if (!rt.connected) { out.push('<div class="near-group"><div class="near-head">' + swatchHtml(rt.cfg) + esc(rt.cfg.name) + '<span class="cnt"><span class="tag nc">Not connected</span></span></div></div>'); continue; }
        try {
          const r = await featuresNear(rt, ringBox); if (stale()) return;
          let items = r.features.map(f => ({ f, d: distToGeom(center, f.geometry) })).filter(x => x.d <= radiusM).sort((a, b) => a.d - b.d);
          if (rt.cfg.geometry === 'line') {   // de-duplicate route / lane segments by name
            const seen = new Map();
            for (const it of items) { const n = featureName(it.f.properties, '', rt); const k = n || featureKey(it.f); if (!seen.has(k)) seen.set(k, it); }
            items = Array.from(seen.values());
          }
          sel.results[rt.cfg.id] = items.length;
          const list = items.slice(0, 6).map((it, i) => '<li><span><a data-near="' + rt.cfg.id + ':' + i + '">' + esc(featureName(it.f.properties, rt.cfg.geometry === 'line' ? 'Unnamed segment' : 'Unnamed', rt)) + '</a></span><span class="d">' + fmtDist(it.d) + '</span></li>').join('') +
            (items.length > 6 ? '<li class="more">+ ' + (items.length - 6) + ' more</li>' : '');
          rt._near = items;
          out.push('<div class="near-group"><div class="near-head">' + swatchHtml(rt.cfg) + esc(rt.cfg.name) + '<span class="cnt">' + (items.length ? fmtInt(items.length) + (rt.cfg.geometry === 'line' ? ' nearby' : ' within ring') : 'None within ring') + '</span></div>' +
            (items.length ? '<ul class="near-list">' + list + '</ul>' : '') + (r.truncated ? '<div class="src-note">Result limit reached — list may be incomplete.</div>' : '') + '</div>');
        } catch (e) { out.push('<div class="near-group"><div class="near-head">' + esc(rt.cfg.name) + '<span class="cnt"><span class="tag bad">Error</span></span></div><div class="src-note">' + esc(e.message) + '</div></div>'); }
      }
      out.push('<div class="src-note">Distances are straight-line from the site centre, not walking distance.</div>');
      const el = $('#' + elId);
      if (el && !stale()) {
        el.innerHTML = out.join('');
        $$('a[data-near]', el).forEach(a => a.addEventListener('click', () => {
          const [lid, i] = a.dataset.near.split(':');
          const it = state.rt[lid]._near[+i]; if (!it) return;
          const p = repPoint(it.f.geometry);
          L.popup({ maxWidth: 320 }).setLatLng([p[1], p[0]]).setContent(popupHtml(state.rt[lid], it.f)).openOn(map);
          if (!map.getBounds().contains([p[1], p[0]])) map.panTo([p[1], p[0]]);
        }));
      }
    };
    nearbySection('transit', 'sec-transit');
    nearbySection('amenity', 'sec-amenity');

    // ---- environmental ----
    (async () => {
      const out = [];
      const fz = sel.facts && sel.facts.floodZone;
      if (fz) {
        const z = String(fz.value).trim().toUpperCase();
        out.push(flagHtml('FEMA flood zone on the Assessor parcel record', /^(A|V)/.test(z) ? 'bad' : 'no', 'Zone ' + z, 'From ' + esc(fz.src) + ' (' + esc(fz.field) + '). Zones beginning with A or V are Special Flood Hazard Areas; X is outside the 1% annual-chance floodplain.'));
      }
      for (const rt of byRole('environment')) {
        if (!rt.connected) { out.push(flagHtml(rt.cfg.name, 'nc', 'Not connected')); continue; }
        try {
          const box = radiusM ? ringBox : siteBox;
          const r = await featuresNear(rt, box); if (stale()) return;
          const onSite = r.features.filter(f => siteHits(geom, center, f.geometry));
          const nearby = radiusM ? r.features.filter(f => !onSite.includes(f) && distToGeom(center, f.geometry) <= radiusM) : [];
          const detailKey = rt.cfg.detailFields || [];
          const details = [...new Set(onSite.map(f => { const p = pick(f.properties, detailKey); return p ? p.key + ' ' + p.value : featureName(f.properties, '', rt); }).filter(Boolean))].slice(0, 4);
          let detail = details.map(esc).join(', ');
          if (radiusM && rt.cfg.geometry !== 'polygon') detail += (detail ? '<br>' : '') + fmtInt(nearby.length) + ' more within ' + esc(ringNote().replace(' (straight line)', '').replace('within ', ''));
          sel.results[rt.cfg.id] = onSite.length ? 'Intersects' : 'Not mapped on site';
          out.push(onSite.length ? flagHtml(rt.cfg.name, 'bad', 'Intersects site', detail) : flagHtml(rt.cfg.name, 'no', 'Not mapped on site', detail));
        } catch (e) { out.push(flagHtml(rt.cfg.name, 'bad', 'Error', esc(e.message))); }
      }
      out.push('<div class="callout warn"><b>Not a clearance.</b> "Not mapped" only means no feature in the connected layers touches this site. It does not mean the site is environmentally safe. The case assumes a Phase I ESA for every site, plus $25,000 for any former commercial or industrial use.</div>');
      const el = $('#sec-environment'); if (el && !stale()) el.innerHTML = out.join('');
    })();
  }

  /* ===================================================================
     7. SHORTLIST
     =================================================================== */
  function siteKey(sel) {
    const f = sel.facts || propertyFacts(sel);
    if (f.parcelId) return 'pid:' + String(f.parcelId.value).trim();
    return 'pt:' + sel.center.map(n => n.toFixed(6)).join(',');
  }
  function loadShortlist() {
    try { state.shortlist = JSON.parse(lsGet(STORAGE_KEY) || '[]'); } catch (e) { state.shortlist = []; }
    if (!Array.isArray(state.shortlist)) state.shortlist = [];
  }
  function saveShortlist() { lsSet(STORAGE_KEY, JSON.stringify(state.shortlist)); renderShortlist(); }

  function addToShortlist() {
    const sel = state.selection; if (!sel) return;
    const f = sel.facts || propertyFacts(sel);
    const v = k => f[k] ? String(f[k].value) : '';
    const r = sel.results || {};
    const item = {
      key: siteKey(sel),
      address: v('address'), parcelId: v('parcelId'),
      lat: +sel.center[1].toFixed(6), lng: +sel.center[0].toFixed(6),
      lotSqft: f.lot ? Math.round(f.lot.sqft) : '', lotAcres: f.lot ? +f.lot.acres.toFixed(3) : '', lotSizeSource: f.lot ? f.lot.how : '',
      owner: v('owner'), dlbaStatus: v('dlbaStatus'),
      zoning: v('zoning') || (r.zoningCodes || []).join(' / '),
      neighborhood: v('neighborhood'), councilDistrict: v('district'),
      qct2026: r.qct || '', dda2026: r.dda || '', tmfha: r.tmfha || '',
      floodHazard: r.flood || '', brownfield: r.brownfields || '',
      sourceLayer: sel.rt.cfg.name, addedOn: today(), note: ''
    };
    if (state.shortlist.some(s => s.key === item.key)) return;
    state.shortlist.push(item);
    saveShortlist();
    const b = $('#addShortlist'); if (b) { b.disabled = true; b.textContent = '✓ In shortlist'; }
  }

  function renderShortlist() {
    $('#shortlistCount').textContent = state.shortlist.length;
    const ol = $('#shortlist');
    if (!state.shortlist.length) { ol.innerHTML = '<li class="sl-empty">No saved sites yet.<br>Select a property and press <b>+ Add to shortlist</b>.</li>'; return; }
    ol.innerHTML = '';
    state.shortlist.forEach((s, i) => {
      const li = document.createElement('li'); li.className = 'sl-item';
      const meta = [s.parcelId && 'Parcel ' + s.parcelId, s.lotSqft && fmtInt(s.lotSqft) + ' sq ft', s.zoning && 'Zoning ' + s.zoning,
        s.qct2026 && 'QCT: ' + s.qct2026, s.dda2026 && 'DDA: ' + s.dda2026, s.tmfha && 'TMFHA: ' + s.tmfha].filter(Boolean).join(' · ');
      li.innerHTML = '<div class="sl-top"><div style="flex:1"><div class="sl-title">' + (i + 1) + '. ' + esc(s.address || 'Unaddressed site') + '</div><div class="sl-meta">' + esc(meta || 'Saved ' + s.addedOn) + '</div></div><button class="link-btn danger" title="Remove">Remove</button></div>' +
        '<textarea placeholder="Notes (why this site? concerns? next steps?)">' + esc(s.note || '') + '</textarea>';
      li.querySelector('.sl-title').addEventListener('click', () => goToSaved(s));
      li.querySelector('button').addEventListener('click', () => { state.shortlist.splice(i, 1); saveShortlist(); if (state.selection) renderPanel(), runAnalysis(state.selToken); });
      li.querySelector('textarea').addEventListener('input', debounce(e => { s.note = e.target.value; lsSet(STORAGE_KEY, JSON.stringify(state.shortlist)); }, 300));
      ol.appendChild(li);
    });
  }

  /** Fly to a saved site and re-select it from the connected property layers. */
  async function goToSaved(s) {
    map.setView([s.lat, s.lng], Math.max(map.getZoom(), 17));
    await selectAt(s.lng, s.lat, s.parcelId);
  }

  function exportShortlist(kind) {
    if (!state.shortlist.length) return;
    if (kind === 'json') { download('detroit-shortlist-' + today() + '.json', JSON.stringify(state.shortlist, null, 2), 'application/json'); return; }
    const cols = ['address', 'parcelId', 'lat', 'lng', 'lotSqft', 'lotAcres', 'lotSizeSource', 'owner', 'dlbaStatus', 'zoning', 'neighborhood', 'councilDistrict', 'qct2026', 'dda2026', 'tmfha', 'floodHazard', 'brownfield', 'sourceLayer', 'addedOn', 'note'];
    const csv = [cols.join(',')].concat(state.shortlist.map(s => cols.map(c => csvCell(s[c])).join(','))).join('\r\n');
    download('detroit-shortlist-' + today() + '.csv', csv, 'text/csv');
  }
  function importShortlist(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arr = JSON.parse(reader.result);
        if (!Array.isArray(arr)) throw new Error('not a list');
        let added = 0;
        for (const s of arr) {
          if (!s || typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
          s.key = s.key || (s.parcelId ? 'pid:' + s.parcelId : 'pt:' + s.lng.toFixed(6) + ',' + s.lat.toFixed(6));
          if (!state.shortlist.some(x => x.key === s.key)) { state.shortlist.push(s); added++; }
        }
        saveShortlist();
        alertInline('Imported ' + added + ' site' + (added === 1 ? '' : 's') + '.');
      } catch (e) { alertInline('That file is not a shortlist exported from this map.'); }
    };
    reader.readAsText(file);
  }
  function alertInline(msg) {
    const el = $('#mapStatus'); el.textContent = msg; el.hidden = false;
    setTimeout(updateMapHints, 3000);
  }

  /* ===================================================================
     8. SEARCH, DATA-SOURCES DIALOG, UI WIRING
     =================================================================== */
  /* ---------------- SEARCH ----------------
     One box searches, in order:
       1. Neighborhoods and named places on the map (layers with searchable: true)
       2. Properties (address or parcel ID) in the connected property layers
       3. Any address / landmark via the geocoder in config (search.geocoder)
     Results stream in as each source answers; stale answers are dropped. */
  let searchSeq = 0;
  const searchGroup = L.layerGroup().addTo(map);
  const STREET_WORDS = new Set(['ST', 'STREET', 'AVE', 'AV', 'AVENUE', 'RD', 'ROAD', 'BLVD', 'BOULEVARD', 'DR', 'DRIVE', 'CT', 'COURT',
    'PL', 'PLACE', 'LN', 'LANE', 'WAY', 'PKWY', 'PARKWAY', 'HWY', 'TER', 'TERRACE', 'CIR', 'CIRCLE', 'DETROIT', 'MI', 'MICHIGAN']);
  /** Split a typed address into words worth matching ("10237 Russell St." -> ["10237","RUSSELL"]). */
  function addressTokens(q) {
    return q.toUpperCase().replace(/[.,#'"]/g, ' ').split(/\s+/).filter(t => t && !STREET_WORDS.has(t) && !/^\d{5}$/.test(t)).slice(0, 5);
  }
  const sqlStr = t => t.replace(/'/g, "''");

  function flashFeature(geom) {
    searchGroup.clearLayers();
    if (!geom) return;
    const gj = { type: 'Feature', geometry: geom, properties: {} };
    if (isPointType(geom)) {
      const c = pointsOf(geom)[0];
      L.circleMarker([c[1], c[0]], { renderer: selRenderer, interactive: false, radius: 14, color: '#d97706', weight: 3, fill: false }).addTo(searchGroup);
    } else {
      L.geoJSON(gj, { renderer: selRenderer, interactive: false, style: { color: '#d97706', weight: 3, dashArray: '8 6', fill: false } }).addTo(searchGroup);
    }
  }
  function zoomToGeom(geom, maxZoom) {
    const bb = bboxOf(geom);
    if (bb[0] === bb[2] && bb[1] === bb[3]) map.setView([bb[1], bb[0]], Math.max(map.getZoom(), maxZoom || 17));
    else map.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]], { maxZoom: maxZoom || 17, padding: [30, 30] });
  }
  /** Select whatever property is at a point (used by saved sites and address results). */
  async function selectAt(lng, lat, parcelId) {
    const pt = [lng, lat];
    for (const rt of propLayers()) {
      try {
        const r = await featuresNear(rt, expandBbox([lng, lat, lng, lat], 12));
        const byId = parcelId ? r.features.find(f => { const p = pick(f.properties, layerCands(rt, 'parcelId')); return p && String(p.value).trim() === parcelId; }) : null;
        const hit = byId || r.features.find(f => isPolyType(f.geometry) ? pointInGeom(pt, f.geometry) : distToGeom(pt, f.geometry) < 12);
        if (hit) { selectFeature(rt, hit, { keep: true }); return true; }
      } catch (e) { /* try next layer */ }
    }
    return false;
  }

  async function searchPlaces(q) {
    const needle = q.toLowerCase();
    const out = [];
    for (const rt of state.order.map(id => state.rt[id]).filter(r => r.connected && r.cfg.searchable)) {
      try {
        const feats = await ensureLoaded(rt) || [];
        const hits = [];
        for (const f of feats) {
          const name = featureName(f.properties, '', rt);
          if (!name) continue;
          const i = name.toLowerCase().indexOf(needle);
          if (i >= 0) hits.push({ f, name, rank: i === 0 ? 0 : 1 });
        }
        hits.sort((x, y) => x.rank - y.rank || x.name.localeCompare(y.name));
        hits.slice(0, rt.cfg.isNeighborhood ? 6 : 4).forEach(h => out.push({
          group: rt.cfg.isNeighborhood ? 'Neighborhoods' : 'Places on the map',
          label: h.name, sub: rt.cfg.name + (featureAddress(h.f.properties, rt) ? ' · ' + featureAddress(h.f.properties, rt) : ''),
          go: () => {
            zoomToGeom(h.f.geometry, rt.cfg.isNeighborhood ? 15 : 17);
            flashFeature(h.f.geometry);
            if (!rt.cfg.isNeighborhood) { const c = repPoint(h.f.geometry); L.popup({ maxWidth: 320 }).setLatLng([c[1], c[0]]).setContent(popupHtml(rt, h.f)).openOn(map); }
          }
        }));
      } catch (e) { /* layer unavailable: skip */ }
    }
    return out;
  }

  async function searchProperties(q) {
    const tokens = addressTokens(q);
    const raw = q.trim().toUpperCase();
    const out = [];
    for (const rt of propLayers()) {
      if (rt.cfg.searchable === false) continue;
      try {
        let feats = [];
        if (rt.cfg.source.type === 'arcgis' && !rt.loaded) {   // ask the server rather than downloading the whole layer
          const meta = await arcgisMeta(rt);
          const fake = Object.fromEntries((meta.fields || []).map(f => [f.name, 1]));
          const aK = findKey(fake, layerCands(rt, 'address')), pK = findKey(fake, layerCands(rt, 'parcelId'));
          const ors = [];
          if (aK && tokens.length) ors.push('(' + tokens.map(t => 'UPPER(' + aK + ") LIKE '%" + sqlStr(t) + "%'").join(' AND ') + ')');
          if (pK && /\d/.test(raw)) ors.push('UPPER(' + pK + ") LIKE '" + sqlStr(raw.replace(/\s+/g, '')) + "%'");
          if (!ors.length) continue;
          const base = rt.cfg.source.where && rt.cfg.source.where !== '1=1' ? '(' + rt.cfg.source.where + ') AND ' : '';
          const r = await arcgisQueryPage(rt, { where: base + '(' + ors.join(' OR ') + ')', resultRecordCount: 6 });
          feats = r.features.filter(f => f.geometry);
        } else {
          const all = await ensureLoaded(rt) || [];
          feats = all.filter(f => {
            const a = pick(f.properties, layerCands(rt, 'address')), p = pick(f.properties, layerCands(rt, 'parcelId'));
            const A = a ? String(a.value).toUpperCase() : '';
            return (tokens.length && tokens.every(t => A.includes(t))) || (p && /\d/.test(raw) && String(p.value).toUpperCase().startsWith(raw.replace(/\s+/g, '')));
          }).slice(0, 6);
        }
        feats.forEach(f => {
          const a = pick(f.properties, layerCands(rt, 'address')), p = pick(f.properties, layerCands(rt, 'parcelId'));
          out.push({ group: 'Properties', label: a ? String(a.value) : 'Unaddressed', sub: (p ? 'Parcel ' + p.value + ' · ' : '') + rt.cfg.name,
            go: () => { zoomToGeom(f.geometry, 18); searchGroup.clearLayers(); selectFeature(rt, f, { keep: true }); } });
        });
      } catch (e) { console.warn('Search failed for', rt.cfg.name, e.message); }
    }
    return out;
  }

  async function searchGeocoder(q) {
    const g = CFG.search && CFG.search.geocoder;
    if (!g || !g.url) return [];
    const b = cityBounds || L.latLngBounds([CFG.map.center, CFG.map.center]).pad(2);
    const ext = { xmin: b.getWest(), ymin: b.getSouth(), xmax: b.getEast(), ymax: b.getNorth(), spatialReference: { wkid: 4326 } };
    const qs = new URLSearchParams({ f: 'json', singleLine: q, searchExtent: JSON.stringify(ext), location: CFG.map.center[1] + ',' + CFG.map.center[0],
      maxLocations: '6', outFields: 'Match_addr,Addr_type,Type', outSR: '4326' });
    const res = await fetch(g.url + '/findAddressCandidates?' + qs.toString(), { referrerPolicy: 'no-referrer' });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'geocoder error');
    const seen = new Set();
    return (data.candidates || []).filter(c => c.score >= (g.minScore || 80)).filter(c => {
      const k = c.address + '|' + c.location.x.toFixed(2) + '|' + c.location.y.toFixed(2);   // same name within ~1 km = duplicate
      if (seen.has(k)) return false; seen.add(k); return true;
    }).map(c => {
      const at = (c.attributes || {}).Addr_type || '';
      const kind = (c.attributes || {}).Type || at;
      const isAddress = /PointAddress|StreetAddress|Subaddress/i.test(at);
      return {
        group: 'Addresses & landmarks', label: c.address, sub: (kind ? kind + ' · ' : '') + (g.label || 'Geocoder'),
        go: async () => {
          const pt = { type: 'Point', coordinates: [c.location.x, c.location.y] };
          if (c.extent && !isAddress) map.fitBounds([[c.extent.ymin, c.extent.xmin], [c.extent.ymax, c.extent.xmax]], { maxZoom: 16 });
          else map.setView([c.location.y, c.location.x], 18);
          flashFeature(pt);
          if (isAddress) await selectAt(c.location.x, c.location.y);
        }
      };
    });
  }

  function renderSearch(results, pending, q) {
    const box = $('#searchResults');
    box.innerHTML = '';
    let lastGroup = null;
    const order = ['Neighborhoods', 'Places on the map', 'Properties', 'Addresses & landmarks'];
    results.sort((x, y) => order.indexOf(x.group) - order.indexOf(y.group));
    results.forEach((r, i) => {
      if (r.group !== lastGroup) { box.insertAdjacentHTML('beforeend', '<div class="sr-group">' + esc(r.group) + '</div>'); lastGroup = r.group; }
      const b = document.createElement('button');
      b.innerHTML = esc(r.label) + '<div class="sr-sub">' + esc(r.sub) + '</div>';
      b.addEventListener('click', () => { box.hidden = true; r.go(); });
      if (i === 0) b.classList.add('first');
      box.appendChild(b);
    });
    if (pending) box.insertAdjacentHTML('beforeend', '<div class="sr-msg">Searching…</div>');
    else if (!results.length) box.insertAdjacentHTML('beforeend', '<div class="sr-msg">No matches for "' + esc(q) + '". Try a street name, neighborhood, place name or parcel ID.</div>');
    if (results.some(r => r.group === 'Addresses & landmarks')) box.insertAdjacentHTML('beforeend', '<div class="sr-credit">Address search by ' + esc((CFG.search.geocoder.label) || 'geocoder') + '</div>');
    box.hidden = false;
  }

  async function runSearch(q) {
    const seq = ++searchSeq;
    q = q.trim();
    const box = $('#searchResults');
    if (q.length < 2) { box.hidden = true; state.searchResults = []; return; }
    const results = [];
    state.searchResults = results;
    let pending = 3;
    renderSearch(results, true, q);
    const add = list => {
      if (seq !== searchSeq) return;
      results.push(...list); pending--;
      renderSearch(results, pending > 0, q);
    };
    const fail = () => { if (seq !== searchSeq) return; pending--; renderSearch(results, pending > 0, q); };
    searchPlaces(q).then(add, fail);
    searchProperties(q).then(add, fail);
    searchGeocoder(q).then(add, e => { console.warn('Geocoder:', e.message); fail(); });
  }

  function sourcesRows() {
    const rows = [];
    for (const cat of CFG.categories) for (const lc of cat.layers) {
      const rt = state.rt[lc.id];
      rows.push({
        category: cat.name, layer: lc.name,
        status: !rt.connected ? 'Not connected' : rt.error ? 'Error: ' + rt.error : rt.loaded ? 'Connected (' + fmtInt(rt.features.length) + ' features loaded' + (isViewport(rt) ? ' in current area' : '') + ')' : 'Connected (not loaded yet)',
        dataset: lc.dataset || '', publisher: lc.publisher || '', type: (lc.source && lc.source.type) || '',
        url: rt.url || '', retrieved: lc.retrieved || '', publisherUpdated: rt.publisherUpdated || '',
        loadedThisSession: rt.loadedAt ? rt.loadedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : ''
      });
    }
    const cb = CFG.cityBoundary;
    if (cb && cb.url) rows.push({ category: 'Base map', layer: 'Detroit-only mask (city limits)', status: maskLayer ? 'Connected' : 'Not loaded',
      dataset: cb.dataset || '', publisher: cb.publisher || '', type: 'arcgis', url: cb.url, retrieved: cb.retrieved || '', publisherUpdated: '', loadedThisSession: '' });
    return rows;
  }
  function openSources() {
    const rows = sourcesRows();
    $('#sourcesTable').innerHTML = '<thead><tr><th>Category</th><th>Layer</th><th>Status</th><th>Dataset</th><th>Publisher</th><th>Type</th><th>URL / file</th><th>Retrieved</th><th>Publisher last edited</th></tr></thead><tbody>' +
      rows.map(r => '<tr><td>' + esc(r.category) + '</td><td>' + esc(r.layer) + '</td><td>' + (r.status === 'Not connected' ? '<span class="tag nc">Not connected</span>' : esc(r.status)) + '</td><td>' + esc(r.dataset) + '</td><td>' + esc(r.publisher) + '</td><td>' + esc(r.type) + '</td><td class="url">' + esc(r.url) + '</td><td>' + (r.retrieved ? esc(r.retrieved) : (r.url ? '<span class="na">not recorded</span>' : '')) + '</td><td>' + esc(r.publisherUpdated) + '</td></tr>').join('') + '</tbody>';
    $('#sourcesDialog').showModal();
  }
  function exportSources() {
    const rows = sourcesRows();
    const cols = Object.keys(rows[0]);
    download('detroit-map-sources-' + today() + '.csv', [cols.join(',')].concat(rows.map(r => cols.map(c => csvCell(r[c])).join(','))).join('\r\n'), 'text/csv');
  }

  function isNarrow() { return window.matchMedia('(max-width: 1100px)').matches; }
  function togglePanel(side) {
    const lay = $('#layout');
    if (isNarrow()) lay.classList.toggle(side + '-open');
    else lay.classList.toggle(side + '-collapsed');
    setTimeout(() => map.invalidateSize(), 230);
  }
  function openRightPanel() {
    const lay = $('#layout');
    if (isNarrow()) lay.classList.add('right-open'); else lay.classList.remove('right-collapsed');
    setTimeout(() => map.invalidateSize(), 230);
  }
  function showTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $('#tab-property').hidden = name !== 'property';
    $('#tab-shortlist').hidden = name !== 'shortlist';
  }

  /* ---------- initialise ---------- */
  function init() {
    $('#appTitle').textContent = CFG.title || 'Detroit Site Explorer';
    $('#appSubtitle').textContent = CFG.subtitle || '';

    // Runtime objects for every configured layer
    for (const cat of CFG.categories) for (const lc of cat.layers) {
      const src = lc.source || {};
      const connected = !!(src.url && String(src.url).trim() && ['arcgis', 'geojson', 'csv'].includes(src.type));
      const rt = {
        cfg: lc, connected, on: false, loaded: false, features: null, error: null, status: connected ? 'idle' : 'nc',
        opacity: lc.opacity != null ? lc.opacity : 1,
        url: connected ? (src.type === 'arcgis' ? normalizeArcgisUrl(src.url) : String(src.url).trim()) : ''
      };
      rt.group = makeGroup(rt);
      state.rt[lc.id] = rt;
      state.order.push(lc.id);
      if (src.url && !connected) { rt.error = 'Source type must be "arcgis", "geojson" or "csv".'; }
    }

    // Base maps
    const sel = $('#basemapSelect');
    sel.innerHTML = CFG.basemaps.map(b => '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>').join('');
    sel.addEventListener('change', () => setBasemap(sel.value));
    setBasemap(CFG.basemaps[0].id);
    const mt = $('#maskToggle');
    if (mt) mt.addEventListener('change', () => setMask(mt.checked));
    loadCityMask();

    buildLayerTree();
    buildLegend();
    loadShortlist();
    renderShortlist();

    // Keep Leaflet's idea of the map size in sync with the page (window resize, panels opening/closing).
    if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($('#map'));
    // In the floating-panel layout, start with the layers panel open so the controls are visible.
    if (isNarrow()) $('#layout').classList.add('left-open');

    // Wiring
    $('#toggleLeft').addEventListener('click', () => togglePanel('left'));
    $('#toggleRight').addEventListener('click', () => togglePanel('right'));
    $('#resetView').addEventListener('click', resetView);
    $('#allOff').addEventListener('click', () => state.order.forEach(id => { if (state.rt[id].on) setLayerOn(state.rt[id], false); }));
    $$('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
    $('#exportCsv').addEventListener('click', () => exportShortlist('csv'));
    $('#exportJson').addEventListener('click', () => exportShortlist('json'));
    $('#importJson').addEventListener('change', e => { if (e.target.files[0]) importShortlist(e.target.files[0]); e.target.value = ''; });
    $('#clearShortlist').addEventListener('click', () => {
      if (!state.shortlist.length) return;
      const btn = $('#clearShortlist');
      if (btn.dataset.confirm) { state.shortlist = []; saveShortlist(); delete btn.dataset.confirm; btn.textContent = 'Clear all'; return; }
      btn.dataset.confirm = '1'; btn.textContent = 'Click again to confirm';
      setTimeout(() => { delete btn.dataset.confirm; btn.textContent = 'Clear all'; }, 3000);
    });
    $('#openSources').addEventListener('click', openSources);
    $('#closeSources').addEventListener('click', () => $('#sourcesDialog').close());
    $('#exportSources').addEventListener('click', exportSources);
    const search = $('#searchInput');
    const doSearch = debounce(() => runSearch(search.value), 450);
    search.addEventListener('input', doSearch);
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const first = $('#searchResults button.first');
        if (first && !$('#searchResults').hidden) first.click(); else runSearch(search.value);
      }
      if (e.key === 'Escape') { $('#searchResults').hidden = true; searchGroup.clearLayers(); }
    });
    document.addEventListener('click', e => { if (!e.target.closest('.search')) $('#searchResults').hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.selection && !$('#sourcesDialog').open && document.activeElement !== search) clearSelection(); });

    // Layers flagged visible:true in config start switched on
    state.order.forEach(id => { const rt = state.rt[id]; if (rt.connected && rt.cfg.visible) setLayerOn(rt, true); });
  }

  init();

  // Small debugging / extension handle (e.g. for future scoring or comparison tools)
  window.SiteExplorer = { map, state, selectFeature, clearSelection, featuresNear, geom: { haversine, distToGeom, geomIntersects, geomAreaSqm, pointInGeom, repPoint } };
})();
