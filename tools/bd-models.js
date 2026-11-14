/* ===== MODELIMP: turn a local folder of Tabletop Simulator meshes + textures into light figures with baked vertex colours ===== */
const MODELIMP = (function () {
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  /* OBJ text -> positions, uvs, and one (position, uv) index pair per triangle corner */
  function parseOBJ(txt) {
    const P = [], T = [], F = []; let i = 0; const n = txt.length;
    while (i < n) {
      let e = txt.indexOf('\n', i); if (e < 0) e = n; const c0 = txt.charCodeAt(i), c1 = txt.charCodeAt(i + 1);
      if (c0 === 118 /*v*/ && c1 === 32) { const s = txt.substring(i + 2, e).trim().split(/\s+/); P.push(+s[0], +s[1], +s[2]); }
      else if (c0 === 118 && c1 === 116 /*vt*/) { const s = txt.substring(i + 3, e).trim().split(/\s+/); T.push(+s[0], +s[1]); }
      else if (c0 === 102 /*f*/ && c1 === 32) {
        const s = txt.substring(i + 2, e).trim().split(/\s+/), np = P.length / 3, nt = T.length / 2, vs = [];
        for (const w of s) { const a = w.split('/'); let v = parseInt(a[0], 10), t = a[1] ? parseInt(a[1], 10) : 0; v = v < 0 ? np + v : v - 1; t = a[1] ? (t < 0 ? nt + t : t - 1) : -1; vs.push([v, t]); }
        for (let k = 1; k + 1 < vs.length; k++) F.push(vs[0][0], vs[0][1], vs[k][0], vs[k][1], vs[k + 1][0], vs[k + 1][1]);
      }
      i = e + 1;
    }
    return { P: new Float32Array(P), T: new Float32Array(T), F: Int32Array.from(F) };
  }
  /* decode an image blob to at most `max` px on its long side */
  async function decodeTex(blob, max) {
    const bmp = await createImageBitmap(blob), k = Math.min(1, (max || 1024) / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }), g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, w, h); const d = g.getImageData(0, 0, w, h); if (bmp.close) bmp.close(); return { w, h, d: d.data };
  }
  function sample(tx, u, v, out) {
    u -= Math.floor(u); v -= Math.floor(v); const x = u * tx.w - .5, y = (1 - v) * tx.h - .5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const W = tx.w, H = tx.h, d = tx.d, at = (xx, yy) => ((((yy % H) + H) % H) * W + (((xx % W) + W) % W)) * 4;
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), e = at(x0 + 1, y0 + 1);
    for (let k = 0; k < 3; k++) out[k] = ((d[a + k] * (1 - fx) + d[b + k] * fx) * (1 - fy) + (d[c + k] * (1 - fx) + d[e + k] * fx) * fy) / 255;
  }
  /* expand to one vertex per distinct (position, uv) pair, with a colour sampled from the texture */
  function expand(m, tex, fallback) {
    const key = new Map(), X = [], C = [], tris = [], nt = m.T.length / 2 + 1, col = [0, 0, 0];
    for (let i = 0; i < m.F.length; i += 6) for (let k = 0; k < 3; k++) {
      const v = m.F[i + k * 2], t = m.F[i + k * 2 + 1], kk = v * nt + (t + 1); let id = key.get(kk);
      if (id === undefined) {
        id = X.length / 3; key.set(kk, id); X.push(m.P[v * 3], m.P[v * 3 + 1], m.P[v * 3 + 2]);
        if (tex && t >= 0) { sample(tex, m.T[t * 2], m.T[t * 2 + 1], col); C.push(col[0], col[1], col[2]); } else C.push(fallback[0], fallback[1], fallback[2]);
      }
      tris.push(id);
    }
    return { X: Float32Array.from(X), C: Float32Array.from(C), T: Int32Array.from(tris) };
  }
  /* vertex clustering: every vertex in a cell merges into one; returns the simplified mesh */
  function cluster(g, cell, org) {
    const n = g.X.length / 3, map = new Map(), id = new Int32Array(n); let m = 0;
    const SX = [], SC = [], CN = [];
    for (let i = 0; i < n; i++) {
      const ix = Math.floor((g.X[i * 3] - org[0]) / cell), iy = Math.floor((g.X[i * 3 + 1] - org[1]) / cell), iz = Math.floor((g.X[i * 3 + 2] - org[2]) / cell), k = (ix * 4096 + iy) * 4096 + iz;
      let c = map.get(k); if (c === undefined) { c = m++; map.set(k, c); SX.push(0, 0, 0); SC.push(0, 0, 0); CN.push(0); }
      id[i] = c; SX[c * 3] += g.X[i * 3]; SX[c * 3 + 1] += g.X[i * 3 + 1]; SX[c * 3 + 2] += g.X[i * 3 + 2]; SC[c * 3] += g.C[i * 3]; SC[c * 3 + 1] += g.C[i * 3 + 1]; SC[c * 3 + 2] += g.C[i * 3 + 2]; CN[c]++;
    }
    const seen = new Set(), T = [];
    for (let i = 0; i < g.T.length; i += 3) {
      const a = id[g.T[i]], b = id[g.T[i + 1]], c = id[g.T[i + 2]]; if (a === b || b === c || a === c) continue;
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi, kk = (lo * 1048576 + mid) * 1048576 + hi; if (seen.has(kk)) continue; seen.add(kk); T.push(a, b, c);
    }
    const X = new Float32Array(m * 3), C = new Float32Array(m * 3); for (let c = 0; c < m; c++) for (let k = 0; k < 3; k++) { X[c * 3 + k] = SX[c * 3 + k] / CN[c]; C[c * 3 + k] = SC[c * 3 + k] / CN[c]; }
    return { X, C, T: Int32Array.from(T), tris: T.length / 3 };
  }
  function decimate(g, target) {
    const tr = g.T.length / 3; if (tr <= target) return { X: g.X, C: g.C, T: g.T, tris: tr };
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < g.X.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], g.X[i + k]); mx[k] = Math.max(mx[k], g.X[i + k]); }
    const ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2], 1e-3); let lo = ext / 900, hi = ext / 2, best = null;
    for (let it = 0; it < 14; it++) { const mid = Math.sqrt(lo * hi), r = cluster(g, mid, mn); if (r.tris > target) lo = mid; else { hi = mid; best = r; } }
    return best || cluster(g, hi, mn);
  }
  /* smooth normals; if the surface faces inward (mirrored or reversed winding) flip it so lighting is right */
  function finish(g) {
    const n = g.X.length / 3, N = new Float32Array(n * 3), T = g.T; let cx = 0, cy = 0, cz = 0; for (let i = 0; i < n; i++) { cx += g.X[i * 3]; cy += g.X[i * 3 + 1]; cz += g.X[i * 3 + 2]; } cx /= n; cy /= n; cz /= n;
    let sgn = 0;
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3, X = g.X, ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      sgn += nx * ((X[a] + X[b] + X[c]) / 3 - cx) + ny * ((X[a + 1] + X[b + 1] + X[c + 1]) / 3 - cy) + nz * ((X[a + 2] + X[b + 2] + X[c + 2]) / 3 - cz);
      for (const q of [a, b, c]) { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; }
    }
    const flip = sgn < 0 ? -1 : 1;
    for (let i = 0; i < n; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] *= flip / l; N[i * 3 + 1] *= flip / l; N[i * 3 + 2] *= flip / l; }
    if (flip < 0) for (let i = 0; i < T.length; i += 3) { const t = T[i + 1]; T[i + 1] = T[i + 2]; T[i + 2] = t; }
    return N;
  }
  /* Unity-style transform: scale, then rotate about Z, X, Y (degrees), then move */
  function mat(x) {
    const d = Math.PI / 180, cx = Math.cos(x[3] * d), sx = Math.sin(x[3] * d), cy = Math.cos(x[4] * d), sy = Math.sin(x[4] * d), cz = Math.cos(x[5] * d), sz = Math.sin(x[5] * d);
    const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1], Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
    const mm = (A, B) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return r; };
    const R = mm(Ry, mm(Rx, Rz));
    return [R[0] * x[6], R[1] * x[7], R[2] * x[8], x[0], R[3] * x[6], R[4] * x[7], R[5] * x[8], x[1], R[6] * x[6], R[7] * x[7], R[8] * x[8], x[2]];
  }
  const mul = (A, B) => { const r = new Array(12); for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) r[i * 4 + j] = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j]; r[i * 4 + 3] = A[i * 4] * B[3] + A[i * 4 + 1] * B[7] + A[i * 4 + 2] * B[11] + A[i * 4 + 3]; } return r; };
  /* unit = { name, parts:[{m,t,p,x}] }; files: id -> async () => Blob (mesh text via .text()). Returns { name, parts:[{V,N,C,T}], h, r, tris } */
  async function build(unit, getMesh, getTex, opt) {
    opt = opt || {}; const parts = unit.parts, W = [], raw = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], L = mat(p.x), par = p.p; let M;
      if (par < 0) M = mat([0, 0, 0, 0, (p.x[4] || 0) - 180, 0, p.x[6], p.x[7], p.x[8]]); else M = mul(W[par], L); W.push(M);
    }
    let total = 0; const texs = {};
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]; let txt; try { txt = await getMesh(p.m); } catch (e) { raw.push(null); continue; }
      const m = parseOBJ(txt); let tex = null; if (p.t) { if (!(p.t in texs)) { try { texs[p.t] = await decodeTex(await getTex(p.t), opt.texMax || 1024); } catch (e) { texs[p.t] = null; } } tex = texs[p.t]; }
      const g = expand(m, tex, p.p < 0 ? [.2, .18, .15] : [.5, .5, .5]); raw.push(g); total += g.T.length / 3;
    }
    let dmn = [1e9, 1e9, 1e9], dmx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < parts.length; i++) { const g = raw[i]; if (!g) continue; const M = W[i], st = Math.max(1, Math.floor(g.X.length / 3 / 400)); for (let k = 0; k < g.X.length; k += 3 * st) { const x = g.X[k], y = g.X[k + 1], z = g.X[k + 2], q = [M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]]; for (let j = 0; j < 3; j++) { dmn[j] = Math.min(dmn[j], q[j]); dmx[j] = Math.max(dmx[j], q[j]); } } }
    const diag = Math.hypot(dmx[0] - dmn[0], dmx[1] - dmn[1], dmx[2] - dmn[2]), budget = opt.budget || (diag > 5 ? 30000 : 10000) * (opt.scale || 1), out = []; let tris = 0, mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
    for (let i = 0; i < parts.length; i++) {
      const g = raw[i]; if (!g) continue; const tr = g.T.length / 3, share = opt.full ? 1e9 : Math.max(400, Math.round(budget * tr / Math.max(1, total)));
      const d = decimate(g, share), M = W[i], V = new Float32Array(d.X.length);
      for (let k = 0; k < d.X.length; k += 3) {
        const x = d.X[k], y = d.X[k + 1], z = d.X[k + 2];
        V[k] = M[0] * x + M[1] * y + M[2] * z + M[3]; V[k + 1] = M[4] * x + M[5] * y + M[6] * z + M[7]; V[k + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
        mnx = Math.min(mnx, V[k]); mxx = Math.max(mxx, V[k]); mny = Math.min(mny, V[k + 1]); mxy = Math.max(mxy, V[k + 1]); mnz = Math.min(mnz, V[k + 2]); mxz = Math.max(mxz, V[k + 2]);
      }
      const gg = { X: V, T: Int32Array.from(d.T) }; const N = finish(gg);
      const C8 = new Uint8Array(d.C.length); for (let k = 0; k < C8.length; k++) C8[k] = Math.round(clamp(d.C[k], 0, 1) * 255);
      out.push({ V, N, C: C8, T: Uint16Array.from(gg.T) }); tris += gg.T.length / 3;
    }
    return { name: unit.name, parts: out, tris, bbox: [mnx, mny, mnz, mxx, mxy, mxz], big: diag > 5 };
  }
  return { parseOBJ, decodeTex, expand, decimate, build, mat };
})();

/* ===== BDModels: local model library (IndexedDB), folder import, and lookup for the 3D board ===== */
const BDModels = (function () {
  const LS = k => 'battleDrill.models.' + k, get = (k, d) => { try { const v = localStorage.getItem(LS(k)); return v === null ? d : v; } catch (e) { return d; } }, set = (k, v) => { try { localStorage.setItem(LS(k), v); } catch (e) { } };
  let figs = [], loaded = false;
  const idbOpen = () => new Promise((res, rej) => { const r = indexedDB.open('battleDrillModels', 1); r.onupgradeneeded = () => r.result.createObjectStore('figs', { keyPath: 'key' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  /* pose the stored mesh for the board: optional left-right mirror and a turn so every model faces +z */
  function prep(rec) {
    const mir = get('mirror', '1') === '1', turn = (+get('yaw', '0')) * Math.PI / 180, c = Math.cos(turn), s = Math.sin(turn);
    let hy = 0; for (const p of rec.parts) for (let i = 1; i < p.V.length; i += 3) if (p.V[i] > hy) hy = p.V[i];
    return { name: rec.name, big: rec.big, tris: rec.tris, h: hy, parts: rec.parts.map(p => {
      const V = new Float32Array(p.V), N = new Float32Array(p.N), T = new Uint32Array(p.T);
      for (let i = 0; i < V.length; i += 3) {
        let x = V[i], z = V[i + 2], nx = N[i], nz = N[i + 2]; if (mir) { x = -x; nx = -nx; }
        V[i] = x * c + z * s; V[i + 2] = -x * s + z * c; N[i] = nx * c + nz * s; N[i + 2] = -nx * s + nz * c;
      }
      if (mir) for (let i = 0; i < T.length; i += 3) { const t = T[i + 1]; T[i + 1] = T[i + 2]; T[i + 2] = t; }
      const C = new Float32Array(p.C.length); for (let i = 0; i < C.length; i++) C[i] = p.C[i] / 255;
      return { V, N, C, T };
    }) };
  }
  async function load() { try { const d = await idbOpen(), rows = await rq(d.transaction('figs').objectStore('figs').getAll()); figs = rows.map(r => prep(r)); d.close(); } catch (e) { figs = []; } loaded = true; return figs.length; }
  /* datasheet name (+faction) -> which stored models may stand in for it */
  const DG = f => /death guard/i.test(f || ''), ANY = () => true;
  const RULES = [
    [/^plague marines?\b|^plague marine squad/, DG, /^(plague marine|pleague marine|kill team - plague|death guard kill team)/],
    [/^poxwalkers?/, ANY, /^poxwalkers/], [/^blightlord/, ANY, /^blightlord terminator/], [/^deathshroud/, ANY, /^deathshroud/],
    [/^(death guard )?rhino/, DG, /^(death guard rhino|dg rino|rhino)/], [/predator/, DG, /predator/], [/land ?raider/, DG, /landraider/], [/defiler/, DG, /defiler/], [/helbrute/, DG, /helbrute/],
    [/maulerfiend/, ANY, /maulerfiend/], [/forgefiend/, ANY, /forgefiend/], [/plagueburst crawler/, ANY, /plagueburst crawler/], [/foetid bloat-?drone/, ANY, /bloatdrone|plague drone/], [/myphitic blight-?hauler/, ANY, /blight hauler/],
    [/mortarion/, ANY, /^mortarion/], [/lord of contagion|typhus/, ANY, /lord of contagion|lord felthius/], [/lord of poxes/, ANY, /lord of poxes/], [/lord of virulence/, ANY, /lord of virulence/], [/biologus putrifier/, ANY, /biologus/],
    [/plague surgeon/, ANY, /plague surgeon/], [/tallyman/, ANY, /tallyman/], [/foul blightspawn/, ANY, /foul blightspawn/], [/noxious blightbringer/, ANY, /noxious blightbringer/], [/malignant plaguecaster/, ANY, /malignant plaguecaster/],
    [/chaos lord/, DG, /^chaos lord/], [/sorcerer/, DG, /sorcerer/], [/daemon prince/, ANY, /daemon prince of nurgle/], [/cultist/, DG, /cultist/], [/chaos spawn/, DG, /chaos spawn/], [/vindicator/, DG, /vindicator/], [/thunderhawk/, DG, /thunderhawk/],
    [/nightmare hulk/, ANY, /nightmare hulk/], [/vulgrar/, ANY, /vulgrar/], [/vox-?shambler/, ANY, /vox-shambler/], [/glitchling/, ANY, /glitchling/], [/cursemite/, ANY, /cursemite/], [/eyestinger/, ANY, /eyestinger/], [/malignifier/, ANY, /malignifier/],
    [/^plaguebearers?/, ANY, /^plaguebearer( w\/ icon)?$|^plaguebearer - plagueridden/], [/great unclean one/, ANY, /^great unclean one/], [/rotigus/, ANY, /^rotigus/], [/beasts? of nurgle/, ANY, /^beasts? of nurgle/], [/^nurglings?/, ANY, /^nurglings/],
    [/poxbringer/, ANY, /^poxbringer/], [/sloppity|bilepiper/, ANY, /piper/], [/spoilpox/, ANY, /spoilpox/], [/slimux/, ANY, /slimux/], [/gnarlmaw/, ANY, /gnarlmaw/],
  ];
  const poolCache = new Map(); const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function pool(ds, faction) {
    const k = ds + '|' + faction; if (poolCache.has(k)) return poolCache.get(k); const n = String(ds || '').toLowerCase().trim(); let out = null;
    for (const [re, fOk, pr] of RULES) { if (re.test(n) && fOk(faction)) { const l = figs.filter(f => f.h > .45 && pr.test(f.name.toLowerCase())); /* entries that are only a bare base are skipped */ if (l.length) { out = l; break; } } }
    poolCache.set(k, out); return out;
  }
  function pick(ds, faction, key) { if (!figs.length || get('on', '1') !== '1') return null; const p = pool(ds, faction); return p ? p[hash(String(key)) % p.length] : null; }
  function add(mb, fig, x, y, z, yaw) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const g of fig.parts) {
      const n = g.V.length / 3, base = mb.n;
      for (let j = 0; j < n; j++) {
        const vx = g.V[j * 3], vz = g.V[j * 3 + 2], nx = g.N[j * 3], nz = g.N[j * 3 + 2];
        mb.P.push(vx * cy + vz * sy + x, g.V[j * 3 + 1] + y, -vx * sy + vz * cy + z); mb.N.push(nx * cy + nz * sy, g.N[j * 3 + 1], -nx * sy + nz * cy); mb.C.push(g.C[j * 3], g.C[j * 3 + 1], g.C[j * 3 + 2]); mb.M.push(.16, 0);
      }
      for (let j = 0; j < g.T.length; j++) mb.I.push(g.T[j] + base);
    }
  }
  /* import: files = FileList from a folder picker (units.json, files.json, parts/*) */
  async function importFolder(files, opt, say) {
    const byPath = new Map(); for (const f of files) { const rp = f.webkitRelativePath || f.name, parts = rp.split('/'); byPath.set(parts.slice(1).join('/'), f); byPath.set(parts[parts.length - 1], f); }
    const uf = byPath.get('units.json'), ff = byPath.get('files.json'); if (!uf || !ff) throw new Error('that folder has no units.json and files.json. Pick the DeathGuard folder the downloader made');
    const units = JSON.parse(await uf.text()), map = JSON.parse(await ff.text()), faction = units.faction || 'Death Guard';
    const getMesh = async id => { const f = byPath.get('parts/' + map[id]) || byPath.get(map[id]); if (!f) throw new Error('missing ' + id); return await f.text(); };
    const getTex = async id => { const f = byPath.get('parts/' + map[id]) || byPath.get(map[id]); if (!f) throw new Error('missing ' + id); return f; };
    const d = await idbOpen(); let ok = 0, bad = 0, i = 0;
    await new Promise((res, rej) => { const t = d.transaction('figs', 'readwrite'); t.objectStore('figs').clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
    for (const u of units.units) {
      i++; say('Converting ' + i + ' of ' + units.units.length + ': ' + u.name);
      try {
        const r = await MODELIMP.build(u, getMesh, getTex, opt);
        if (!r.parts.length) { bad++; continue; }
        const rec = { key: faction + '|' + i, faction, name: u.name, big: r.big, tris: r.tris, parts: r.parts.map(p => ({ V: p.V, N: p.N, C: p.C, T: p.T })) };
        await new Promise((res, rej) => { const t = d.transaction('figs', 'readwrite'); t.objectStore('figs').put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); }); ok++;
      } catch (e) { bad++; console.warn('model skipped', u.name, e); }
      if (i % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }
    d.close(); poolCache.clear(); await load(); return { ok, bad };
  }
  async function clearAll() { const d = await idbOpen(); await new Promise((res, rej) => { const t = d.transaction('figs', 'readwrite'); t.objectStore('figs').clear(); t.oncomplete = res; t.onerror = () => rej(t.error); }); d.close(); figs = []; poolCache.clear(); }
  return { load, pick, add, importFolder, clearAll, on: () => figs.length > 0 && get('on', '1') === '1', count: () => figs.length, get, set, reprep: async () => { poolCache.clear(); await load(); } };
})();
window.BDModels = BDModels; window.MODELIMP = MODELIMP;
