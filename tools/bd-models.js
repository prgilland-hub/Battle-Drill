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
  /* ---- textured copies: keep each model's real texture and UVs instead of baking the paint into vertex colours ---- */
  function expandUV(m) {
    const key = new Map(), X = [], UV = [], tris = [], nt = m.T.length / 2 + 1;
    for (let i = 0; i < m.F.length; i += 6) for (let k = 0; k < 3; k++) {
      const v = m.F[i + k * 2], t = m.F[i + k * 2 + 1], kk = v * nt + (t + 1); let id = key.get(kk);
      if (id === undefined) { id = X.length / 3; key.set(kk, id); X.push(m.P[v * 3], m.P[v * 3 + 1], m.P[v * 3 + 2]); if (t >= 0) UV.push(m.T[t * 2], 1 - m.T[t * 2 + 1]); else UV.push(0, 0); }
      tris.push(id);
    }
    return { X: Float32Array.from(X), UV: Float32Array.from(UV), T: Int32Array.from(tris) };
  }
  /* vertex clustering that keeps different parts of the texture apart, so painted detail is not smeared across UV islands */
  function clusterUV(g, cell, org) {
    const n = g.X.length / 3, map = new Map(), id = new Int32Array(n); let m = 0; const SX = [], SU = [], CN = [];
    for (let i = 0; i < n; i++) {
      const ix = Math.floor((g.X[i * 3] - org[0]) / cell), iy = Math.floor((g.X[i * 3 + 1] - org[1]) / cell), iz = Math.floor((g.X[i * 3 + 2] - org[2]) / cell);
      const iu = Math.max(0, Math.min(31, Math.floor((g.UV[i * 2] - Math.floor(g.UV[i * 2])) * 32))), iv = Math.max(0, Math.min(31, Math.floor((g.UV[i * 2 + 1] - Math.floor(g.UV[i * 2 + 1])) * 32)));
      const k = (((ix * 4096 + iy) * 4096 + iz) * 32 + iu) * 32 + iv; let c = map.get(k); if (c === undefined) { c = m++; map.set(k, c); SX.push(0, 0, 0); SU.push(0, 0); CN.push(0); }
      id[i] = c; SX[c * 3] += g.X[i * 3]; SX[c * 3 + 1] += g.X[i * 3 + 1]; SX[c * 3 + 2] += g.X[i * 3 + 2]; SU[c * 2] += g.UV[i * 2]; SU[c * 2 + 1] += g.UV[i * 2 + 1]; CN[c]++;
    }
    const seen = new Set(), T = [];
    for (let i = 0; i < g.T.length; i += 3) {
      const a = id[g.T[i]], b = id[g.T[i + 1]], c = id[g.T[i + 2]]; if (a === b || b === c || a === c) continue;
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi, kk = (lo * 1048576 + mid) * 1048576 + hi; if (seen.has(kk)) continue; seen.add(kk); T.push(a, b, c);
    }
    const X = new Float32Array(m * 3), UV = new Float32Array(m * 2); for (let c = 0; c < m; c++) { for (let k = 0; k < 3; k++) X[c * 3 + k] = SX[c * 3 + k] / CN[c]; UV[c * 2] = SU[c * 2] / CN[c]; UV[c * 2 + 1] = SU[c * 2 + 1] / CN[c]; }
    return { X, UV, T: Int32Array.from(T), tris: T.length / 3 };
  }
  function decimateUV(g, target) {
    const tr = g.T.length / 3; if (tr <= target) return { X: g.X, UV: g.UV, T: g.T, tris: tr };
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < g.X.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], g.X[i + k]); mx[k] = Math.max(mx[k], g.X[i + k]); }
    const ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2], 1e-3); let lo = ext / 900, hi = ext / 2, best = null;
    for (let it = 0; it < 12; it++) { const mid = Math.sqrt(lo * hi), r = clusterUV(g, mid, mn); if (r.tris > target) lo = mid; else { hi = mid; best = r; } }
    return best || clusterUV(g, hi, mn);
  }
  /* smooth normals, welded by position so texture seams do not show as hard lines; flips an inside-out surface like finish() */
  function finishW(g) {
    const n = g.X.length / 3, X = g.X, T = g.T, w = new Map(), wid = new Int32Array(n); let nw = 0, mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mnz = 1e9, mxz = -1e9;
    for (let i = 0; i < n; i++) { mnx = Math.min(mnx, X[i * 3]); mxx = Math.max(mxx, X[i * 3]); mny = Math.min(mny, X[i * 3 + 1]); mxy = Math.max(mxy, X[i * 3 + 1]); mnz = Math.min(mnz, X[i * 3 + 2]); mxz = Math.max(mxz, X[i * 3 + 2]); }
    const q = Math.max(mxx - mnx, mxy - mny, mxz - mnz, 1e-3) / 20000;
    for (let i = 0; i < n; i++) { const k = (Math.round(X[i * 3] / q) * 65537 + Math.round(X[i * 3 + 1] / q)) * 65537 + Math.round(X[i * 3 + 2] / q); let c = w.get(k); if (c === undefined) { c = nw++; w.set(k, c); } wid[i] = c; }
    const A = new Float32Array(nw * 3); let cx = 0, cy = 0, cz = 0; for (let i = 0; i < n; i++) { cx += X[i * 3]; cy += X[i * 3 + 1]; cz += X[i * 3 + 2]; } cx /= n; cy /= n; cz /= n; let sgn = 0;
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3, ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; sgn += nx * ((X[a] + X[b] + X[c]) / 3 - cx) + ny * ((X[a + 1] + X[b + 1] + X[c + 1]) / 3 - cy) + nz * ((X[a + 2] + X[b + 2] + X[c + 2]) / 3 - cz);
      for (const v of [T[i], T[i + 1], T[i + 2]]) { const o = wid[v] * 3; A[o] += nx; A[o + 1] += ny; A[o + 2] += nz; }
    }
    const flip = sgn < 0 ? -1 : 1, N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const o = wid[i] * 3, l = Math.hypot(A[o], A[o + 1], A[o + 2]) || 1; N[i * 3] = A[o] * flip / l; N[i * 3 + 1] = A[o + 1] * flip / l; N[i * 3 + 2] = A[o + 2] * flip / l; }
    if (flip < 0) for (let i = 0; i < T.length; i += 3) { const t = T[i + 1]; T[i + 1] = T[i + 2]; T[i + 2] = t; }
    return N;
  }
  /* a decoded texture -> a JPEG blob small enough to keep in the library */
  async function encodeTex(tx, flat) {
    const w = tx ? tx.w : 4, h = tx ? tx.h : 4, cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }), g = cv.getContext('2d');
    if (tx) g.putImageData(new ImageData(new Uint8ClampedArray(tx.d.buffer, tx.d.byteOffset, tx.d.length), w, h), 0, 0); else { g.fillStyle = 'rgb(' + flat.map(v => Math.round(v * 255)).join(',') + ')'; g.fillRect(0, 0, w, h); }
    return cv.convertToBlob ? await cv.convertToBlob({ type: 'image/jpeg', quality: .9 }) : await new Promise(r => cv.toBlob(r, 'image/jpeg', .9));
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
    opt = opt || {}; build.err = ''; const parts = unit.parts, W = [], raw = [], rawM = [], rawT = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], L = mat(p.x), par = p.p; let M;
      if (par < 0) M = mat([0, 0, 0, 0, (p.x[4] || 0) - 180, 0, p.x[6], p.x[7], p.x[8]]); else M = mul(W[par], L); W.push(M);
    }
    let total = 0; const texs = {};
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]; let txt; try { txt = await getMesh(p.m); } catch (e) { raw.push(null); if (!build.err) build.err = (e && e.name && e.name !== 'Error' ? e.name + ' ' : '') + (e && e.message || e); continue; }
      const m = parseOBJ(txt); let tex = null; if (p.t) { if (!(p.t in texs)) { try { texs[p.t] = await decodeTex(await getTex(p.t), opt.texMax || 1024); } catch (e) { texs[p.t] = null; } } tex = texs[p.t]; }
      const g = expand(m, tex, p.p < 0 ? [.2, .18, .15] : [.5, .5, .5]); raw.push(g); rawM[i] = opt.tex ? m : null; rawT[i] = tex; total += g.T.length / 3;
    }
    let dmn = [1e9, 1e9, 1e9], dmx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < parts.length; i++) { const g = raw[i]; if (!g) continue; const M = W[i], st = Math.max(1, Math.floor(g.X.length / 3 / 400)); for (let k = 0; k < g.X.length; k += 3 * st) { const x = g.X[k], y = g.X[k + 1], z = g.X[k + 2], q = [M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]]; for (let j = 0; j < 3; j++) { dmn[j] = Math.min(dmn[j], q[j]); dmx[j] = Math.max(dmx[j], q[j]); } } }
    const diag = Math.hypot(dmx[0] - dmn[0], dmx[1] - dmn[1], dmx[2] - dmn[2]), stdBudget = opt.budget || (diag > 5 ? 30000 : 10000) * (opt.scale || 1);
    const mkPass = (budget, u32) => { const out = []; let tris = 0, mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
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
      out.push({ V, N, C: C8, T: u32 ? Uint32Array.from(gg.T) : Uint16Array.from(gg.T) }); tris += gg.T.length / 3;
    }
    return { name: unit.name, parts: out, tris, bbox: [mnx, mny, mnz, mxx, mxy, mxz], big: diag > 5 }; };
    const res = mkPass(stdBudget, false);
    /* a second, richer copy for previews and (optionally) the battle: High about 4x, Maximum about 12x the standard triangles, capped so the library stays a sensible size */
    /* with textures kept, the richer copy is a textured one: the same triangle budget, but the model wears its real paint */
    if (opt.tex) {
      const hb = opt.hi === 'max' ? (diag > 5 ? 250000 : 120000) : (diag > 5 ? 100000 : 40000), out = [], tl = [], tmap = new Map(); let tris = 0;
      for (let i = 0; i < parts.length; i++) {
        const m = rawM[i]; if (!m) continue; const g = expandUV(m), tr = g.T.length / 3, share = Math.max(400, Math.round(hb * tr / Math.max(1, total)));
        const d = decimateUV(g, share), M = W[i], V = new Float32Array(d.X.length);
        for (let k = 0; k < d.X.length; k += 3) { const x = d.X[k], y = d.X[k + 1], z = d.X[k + 2]; V[k] = M[0] * x + M[1] * y + M[2] * z + M[3]; V[k + 1] = M[4] * x + M[5] * y + M[6] * z + M[7]; V[k + 2] = M[8] * x + M[9] * y + M[10] * z + M[11]; }
        const gg = { X: V, T: Int32Array.from(d.T) }, N = finishW(gg), tk = rawT[i] ? parts[i].t : (parts[i].p < 0 ? '#flat-base' : '#flat'); let ti = tmap.get(tk); if (ti === undefined) { ti = tl.length; tmap.set(tk, ti); tl.push(rawT[i] ? { tex: rawT[i] } : { flat: parts[i].p < 0 ? [.2, .18, .15] : [.5, .5, .5] }); }
        out.push({ V, N, UV: d.UV, T: Uint32Array.from(gg.T), ti }); tris += gg.T.length / 3;
      }
      if (out.length) { const blobs = []; for (const t of tl) blobs.push(await encodeTex(t.tex, t.flat)); res.hi = { tris, parts: out, texs: blobs, textured: true, bbox: res.bbox, big: res.big }; }
    } else
    if (opt.hi === 'hi' || opt.hi === 'max') { const hb = opt.hi === 'max' ? (diag > 5 ? 250000 : 120000) : (diag > 5 ? 100000 : 40000); if (hb > stdBudget * 1.5) res.hi = mkPass(hb, true); }
    return res;
  }
  return { parseOBJ, decodeTex, expand, decimate, build, mat, expandUV, decimateUV, finishW, encodeTex };
})();

/* ===== BDModels: local model library (IndexedDB), folder import, and lookup for the 3D board ===== */
const BDModels = (function () {
  const LS = k => 'battleDrill.models.' + k, get = (k, d) => { try { const v = localStorage.getItem(LS(k)); return v === null ? d : v; } catch (e) { return d; } }, set = (k, v) => { try { localStorage.setItem(LS(k), v); } catch (e) { } };
  let index = [], cache = new Map(), loading = new Set(), poolCache = new Map(), pingT = 0;
  const idbOpen = () => new Promise((res, rej) => { const r = indexedDB.open('battleDrillModels2', 1); r.onupgradeneeded = () => { r.result.createObjectStore('figs', { keyPath: 'key' }); r.result.createObjectStore('index', { keyPath: 'key' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = (d, st, mode) => d.transaction(st, mode || 'readonly');
  const done = t => new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  const ping = () => { clearTimeout(pingT); pingT = setTimeout(() => { try { window.dispatchEvent(new Event('bd-models-changed')); } catch (e) { } }, 120); };
  /* pose the stored mesh for the board: optional left-right mirror and a turn so every model faces +z */
  /* Khorne models whose texture came out a cold blue/violet: pull blue, violet and magenta hues round to blood red, leaving greys, bone, brass and the reds already there alone */
  const KHORNE = /bloodthirster|kharn|khârn|slaughterbound|khorne|angron|skarbrand|bloodletter|bloodcrusher|flesh hound|karanak|skarr|skulltaker|valkia|blood throne|skull cannon/i;
  function recolour(C) {
    for (let i = 0; i < C.length; i += 3) {
      const r = C[i], g = C[i + 1], b = C[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < .05 || mx < .04) continue;
      let h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; const sat = d / mx;
      if (h < 165 || h > 345) continue;
      const ns = Math.min(1, sat * 1.1 + .12), nh = 358, v = mx * .96, c = v * ns, hp = ((nh % 360) / 60), x = c * (1 - Math.abs(hp % 2 - 1)), m = v - c;
      let rr = 0, gg = 0, bb = 0; if (hp < 1) { rr = c; gg = x; } else if (hp < 2) { rr = x; gg = c; } else if (hp < 3) { gg = c; bb = x; } else if (hp < 4) { gg = x; bb = c; } else if (hp < 5) { rr = x; bb = c; } else { rr = c; bb = x; }
      C[i] = rr + m; C[i + 1] = gg + m; C[i + 2] = bb + m;
    }
  }
  function prep(rec, imgs) {
    const fix = get('khfix', '1') === '1' && KHORNE.test(String(rec.name || '')), mir = get('mirror', '1') === '1', turn = (+get('yaw', '0')) * Math.PI / 180, c = Math.cos(turn), s = Math.sin(turn);
    return { name: rec.name, parts: rec.parts.map(p => {
      const V = new Float32Array(p.V), N = new Float32Array(p.N), T = new Uint32Array(p.T);
      for (let i = 0; i < V.length; i += 3) {
        let x = V[i], z = V[i + 2], nx = N[i], nz = N[i + 2]; if (mir) { x = -x; nx = -nx; }
        V[i] = x * c + z * s; V[i + 2] = -x * s + z * c; N[i] = nx * c + nz * s; N[i + 2] = -nx * s + nz * c;
      }
      if (mir) for (let i = 0; i < T.length; i += 3) { const t = T[i + 1]; T[i + 1] = T[i + 2]; T[i + 2] = t; }
      if (imgs) return { V, N, UV: p.UV, T, img: imgs[p.ti] };
      const C = new Float32Array(p.C.length); for (let i = 0; i < C.length; i++) C[i] = p.C[i] / 255;
      if (fix) recolour(C);
      return { V, N, C, T };
    }) };
  }
  async function load() { try { const d = await idbOpen(); index = await rq(tx(d, 'index').objectStore('index').getAll()); d.close(); } catch (e) { index = []; } cache.clear(); loading.clear(); poolCache.clear(); return index.length; }
  const figOf = new WeakMap(), hiOrder = []; let hiLeft = 0;
  function fetchFig(m, hi) {
    const k = hi ? m.key + '#hi' : m.key;
    if (cache.has(k)) return cache.get(k); if (loading.has(k)) return null; loading.add(k);
    idbOpen().then(async d => { const rec = await rq(tx(d, 'figs').objectStore('figs').get(k)); d.close(); if (!rec) console.warn('[BDModels] indexed but not stored:', k, m.name); if (rec) { if (hi) { hiOrder.push(k); while (hiOrder.length > 40) cache.delete(hiOrder.shift()); } else if (cache.size > 350) cache.delete(cache.keys().next().value); const imgs = rec.texs ? await Promise.all(rec.texs.map(b => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))) : null; const fg = prep(rec, imgs); figOf.set(fg, m); cache.set(k, fg); } loading.delete(k); ping(); }).catch(e => { loading.delete(k); console.warn('[BDModels] could not load', m.name, e); });
    return null;
  }
  /* the richer copy of a model you already hold (previews): it arrives a moment later and the preview refreshes */
  function upgrade(fig) { if (!fig || get('hiPrev', '1') !== '1') return fig; const m = figOf.get(fig); if (!m || !m.hi) return fig; return fetchFig(m, true) || fig; }
  const frame = n => { hiLeft = n == null ? 450000 : n; };
  /* datasheet name (+faction) -> which stored models may stand in for it */
  const DG = f => /death guard/i.test(f || ''), ANY = () => true;
  const RULES = [
    [/^plague marines?\b|^plague marine squad/, DG, /^(plague marine|pleague marine|kill team - plague|death guard kill team)/],
    [/^poxwalkers?/, ANY, /^poxwalkers/], [/^blightlord/, ANY, /^blightlord terminator/], [/^deathshroud/, ANY, /^deathshroud/],
    [/^(death guard )?rhino/, DG, /^(death guard rhino|dg rino|rhino)/], [/predator/, DG, /predator/], [/land ?raider/, DG, /landraider/], [/defiler/, DG, /defiler/], [/helbrute/, DG, /helbrute/],
    [/maulerfiend/, ANY, /maulerfiend/], [/forgefiend/, ANY, /forgefiend/], [/plagueburst crawler/, ANY, /plagueburst crawler/], [/foetid bloat-?drone/, ANY, /bloatdrone|plague drone/], [/myphitic blight-?hauler/, ANY, /blight hauler/],
    [/mortarion/, ANY, /^mortarion/], [/lord of contagion|typhus/, ANY, /lord of contagion|lord felthius/], [/lord of poxes/, ANY, /lord of poxes/], [/lord of virulence/, ANY, /lord of virulence/], [/biologus putrifier/, ANY, /biologus/],
    [/plague surgeon/, ANY, /plague surgeon/], [/tallyman/, ANY, /tallyman/], [/foul blightspawn/, ANY, /foul blightspawn/], [/noxious blightbringer/, ANY, /noxious blightbringer/], [/malignant plaguecaster/, ANY, /malignant plaguecaster/],
    [/chaos lord/, DG, /^chaos lord/], [/sorcerer/, DG, /sorcerer/], [/daemon prince/, DG, /daemon prince of nurgle/], [/cultist/, DG, /cultist/], [/chaos spawn/, DG, /chaos spawn/], [/vindicator/, DG, /vindicator/], [/thunderhawk/, DG, /thunderhawk/],
    [/nightmare hulk/, ANY, /nightmare hulk/], [/vulgrar/, ANY, /vulgrar/], [/vox-?shambler/, ANY, /vox-shambler/], [/glitchling/, ANY, /glitchling/], [/cursemite/, ANY, /cursemite/], [/eyestinger/, ANY, /eyestinger/], [/malignifier/, ANY, /malignifier/],
    [/^plaguebearers?/, ANY, /^plaguebearer( w\/ icon)?$|^plaguebearer - plagueridden/], [/great unclean one/, ANY, /^great unclean one/], [/rotigus/, ANY, /^rotigus/], [/beasts? of nurgle/, ANY, /^beasts? of nurgle/], [/^nurglings?/, ANY, /^nurglings/],
    [/poxbringer/, ANY, /^poxbringer/], [/sloppity|bilepiper/, ANY, /piper/], [/spoilpox/, ANY, /spoilpox/], [/slimux/, ANY, /slimux/], [/gnarlmaw/, ANY, /gnarlmaw/],
  ];
  /* every other faction: match the datasheet's words against the model names */
  const ALIAS = [[/^angron/, ['daemon prince of khorne with wings', 'daemon prince of khorne', 'bloodthirster', 'daemon prince']], [/^skarbrand/, ['bloodthirster', 'daemon prince of khorne']], [/wolf guard terminator|wolf guard \w* ?terminator/, ['terminator']], [/battle leader|wolf lord|wolf guard|wolf priest|rune priest|njal|ragnar|logan|arjac|bjorn/, ['captain', 'lieutenant', 'primaris captain', 'chaplain']], [/sword brethren/, ['bladeguard veteran', 'crusader', 'primaris crusader', 'intercessor']], [/execrator|grimaldus|castellan|marshal|champion/, ['chaplain', 'captain']], [/terminator assault|assault terminator/, ['terminator']]];
  const WEAKHEAD = new Set(['sword', 'assault', 'heavy', 'storm', 'death', 'great', 'grand', 'high', 'lord', 'chaos', 'plague', 'imperial']);
  const STOP = new Set(['squad', 'unit', 'the', 'of', 'with', 'w', 'and', 'model', 'models', 'a', 'in', 'on']);
  const toks = s => String(s || '').toLowerCase().replace(/armour/g, 'armor').replace(/\bwargear\b/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)).map(w => w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  const FAM = [['space marines', 'black templars', 'ultramarines', 'imperial fists', 'iron hands', 'raven guard', 'salamanders', 'white scars', 'blood angels', 'dark angels', 'deathwatch', 'raptors'], ['chaos space marines', 'world eaters', 'thousand sons', 'night lords', 'word bearers', 'alpha legion', 'red corsairs', "emperor's children", 'death guard', 'chaos daemons'], ['imperial knights', 'chaos knights'], ['adepta sororitas', 'sisters and agents'], ['aeldari', 'drukhari']];
  const related = (a, b) => { a = String(a || '').toLowerCase(); b = String(b || '').toLowerCase(); if (!a || !b || b === '?' || a === '?') return true; if (a.includes(b) || b.includes(a)) return true; return FAM.some(g => g.some(x => a.includes(x)) && g.some(x => b.includes(x))); };
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const factionsNow = () => { const c = {}; for (const m of index) c[m.faction] = (c[m.faction] || 0) + 1; return c; };
  pool.warned = new Set();
  function pool(ds, faction) {
    const k = ds + '|' + faction; if (poolCache.has(k)) return poolCache.get(k); const n = String(ds || '').toLowerCase().trim(); let out = null;
    for (const [re, fOk, pr] of RULES) { if (re.test(n) && fOk(faction)) { const l = index.filter(f => f.h > .45 && pr.test(f.name.toLowerCase())); if (l.length) { out = l; break; } } }
    if (!out) {
      const t = toks(ds); if (t.length) {
        const FW = new Set(['chaos', 'heretic', 'astartes', 'traitor', 'imperial', 'adeptus', 'astra', 'dg', 'death', 'guard', 'thousand', 'son', 'word', 'bearer', 'world', 'eater', 'night', 'lord', 'emperor', 'child', 'alpha', 'legion', 'iron', 'hand', 'raven', 'fist', 'blood', 'angel', 'dark', 'salamander', 'ultramarine', 'tau', 'ork']), t2 = t.filter(w => !FW.has(w));
        const find = tt => index.filter(f => { if (f.h <= .45) return false; const ft = new Set(toks(f.name)); return tt.every(w => ft.has(w)); });
        let m = find(t); if (!m.length && t2.length && t2.length < t.length) m = find(t2);
        if (!m.length) { const tt = t2.length ? t2 : t; m = index.filter(f => { if (f.h <= .45) return false; const ns = toks(f.name).join(''); return tt.every(w => ns.includes(w)); }); }
        const VEH = /land ?raider|rhino|predator|repulsor|impulsor|bunker|dreadnought|gladiator|redemptor|razorback|vindicator|whirlwind|stormhawk|thunderhawk/i; if (!VEH.test(ds)) { const nv = m.filter(f => !VEH.test(f.name)); if (nv.length) m = nv; }
        const same = m.filter(f => related(faction, f.faction)); out = same.length ? same : (m.length && !FAM.some(g => g.some(x => String(faction || '').toLowerCase().includes(x))) ? m : null);
      }
    }
    if (out && !out.length) out = null;
    if (!out && /\swith\s/.test(n)) { const cut = n.replace(/\swith\s(?!.*\swith\s).*$/, ''); if (cut && cut !== n) out = pool(cut, faction); }
    /* stand-ins when the library has no exact model: a named alias first, then the same datasheet with its trailing words dropped ("Terminator Assault Squad" -> Terminator, "Chaplain in Terminator Armour" -> Chaplain) */
    if (!out) for (const [re, alts] of ALIAS) { if (re.test(n)) { for (const alt of alts) { out = pool(alt, faction); if (out) break; } if (out) break; } }
    if (!out) { const t = toks(ds); for (let k = t.length - 1; k >= 1 && !out; k--) { const sub = t.slice(0, k).join(' '); if (!WEAKHEAD.has(sub)) out = pool(sub, faction); } }
    if (!out && !pool.warned.has(k)) { pool.warned.add(k); try { console.info('[BDModels] no model for "' + ds + '" (' + faction + '). Library: ' + index.length + ' models in ' + JSON.stringify(factionsNow())); } catch (e) { } } poolCache.set(k, out); return out;
  }
  /* returns the model if it is ready; otherwise starts loading it and returns null (the board redraws when it arrives) */
  /* squads of mixed models: the first model is the sergeant/champion if one exists, every fourth model after that carries a special or heavy weapon, the rest are the plain troopers */
  const LEADERISH = /sergeant|sarge|champion|aspiring|aspirant|\bicon\b|banner|ancient|\bnob\b|\bboss\b|alpha|\bhost\b|\bsuperior\b|\bsister superior\b|exemplar|\bastartes sergeant\b/i;
  const SPECIAL = /flamer|melta|plasma|launcher|cannon|lascannon|missile|\bgun\b|blaster|reaper|heavy|havoc|sniper|gatling|autocannon|grenade|spewer|\bbigshoota\b|rokkit|burna|\bmortar|\bheavy bolter|\bwarflam|\bsoulreaper|\bwarpflamer|\bfusion|\bvolkite|\bhellgun|\bflakk|\bgauntlet|\bscythe/i;
  function roleFilter(p, idx, n) {
    if (!(n > 1) || p.length < 2) return p;
    const lead = p.filter(f => LEADERISH.test(f.name)), spec = p.filter(f => !LEADERISH.test(f.name) && SPECIAL.test(f.name)), plain = p.filter(f => !LEADERISH.test(f.name) && !SPECIAL.test(f.name));
    if (idx === 0 && lead.length) return lead;
    if (idx > 0 && idx % 4 === 3 && spec.length) return spec;
    return plain.length ? plain : p;
  }
  function pick(ds, faction, key, idx, n, hi) { if (!index.length || get('on', '1') !== '1') return null; let p = pool(ds, faction); if (!p) return null; p = roleFilter(p, idx | 0, n | 0); const m = p[hash(String(key)) % p.length];
    /* battle: use the richer copy while the scene stays within a triangle budget (so a big army never stalls the redraw); the standard copy fills in until it has loaded */
    if (hi && m.hi && hiLeft >= m.hi) { const f = fetchFig(m, true); if (f) { hiLeft -= m.hi; return f; } }
    const f0 = fetchFig(m) || cache.get(m.key) || null; if (f0 && !figOf.has(f0)) figOf.set(f0, m); return f0; }
  function add(mb, fig, x, y, z, yaw) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    /* the texture colours are screen (sRGB) values but the renderer lights in linear light, like the built-in figures: convert once and keep both copies, so the models keep their painted colours instead of washing out pale */
    const gm = typeof BF_LIN !== 'undefined' && BF_LIN.on ? (BF_LIN.g || 2.2) : 1;
    for (const g of fig.parts) {
      if (g.img) {
        const TX = mb.tx || (mb.tx = new Map()); let b = TX.get(g.img); if (!b) { b = { P: [], N: [], UV: [], M: [], I: [], n: 0 }; TX.set(g.img, b); }
        const nn = g.V.length / 3, bs0 = b.n;
        for (let j = 0; j < nn; j++) { const vx = g.V[j * 3], vz = g.V[j * 3 + 2], nx = g.N[j * 3], nz = g.N[j * 3 + 2]; b.P.push(vx * cy + vz * sy + x, g.V[j * 3 + 1] + y, -vx * sy + vz * cy + z); b.N.push(nx * cy + nz * sy, g.N[j * 3 + 1], -nx * sy + nz * cy); b.UV.push(g.UV[j * 2], g.UV[j * 2 + 1]); b.M.push(.16, 0); }
        for (let j = 0; j < g.T.length; j++) b.I.push(g.T[j] + bs0); b.n += nn; continue;
      }
      const n = g.V.length / 3, base = mb.n;
      const C = gm !== 1 ? (g.CLg === gm ? g.CL : (g.CLg = gm, g.CL = Float32Array.from(g.C, v => Math.pow(v < 0 ? 0 : v, gm)))) : g.C;
      for (let j = 0; j < n; j++) {
        const vx = g.V[j * 3], vz = g.V[j * 3 + 2], nx = g.N[j * 3], nz = g.N[j * 3 + 2];
        mb.P.push(vx * cy + vz * sy + x, g.V[j * 3 + 1] + y, -vx * sy + vz * cy + z); mb.N.push(nx * cy + nz * sy, g.N[j * 3 + 1], -nx * sy + nz * cy); mb.C.push(C[j * 3], C[j * 3 + 1], C[j * 3 + 2]); mb.M.push(.16, 0);
      }
      for (let j = 0; j < g.T.length; j++) mb.I.push(g.T[j] + base);
    }
  }
  /* look inside a picked folder: which factions does it hold? */
  async function scan(files) {
    const byName = new Map(), dirs = new Map(); let rootFiles = null;
    for (const f of files) {
      const rp = f.webkitRelativePath || f.name, a = rp.split('/'), nm = a[a.length - 1], dir = a.slice(0, -1).join('/');
      byName.set(nm, f);
      if (nm === 'units.json') dirs.set(dir, { units: f }); else if (nm === 'files.json') { if (!dirs.has(dir)) dirs.set(dir, {}); dirs.get(dir).files = f; if (!rootFiles || dir.length < rootFiles.dir.length) rootFiles = { dir, f }; }
    }
    const out = [];
    for (const [dir, o] of dirs) { if (!o.units) continue; let name = dir.split('/').pop(), n = 0; try { const j = JSON.parse(await o.units.text()); name = j.faction || name; n = j.units.length; } catch (e) { continue; } out.push({ name, count: n, units: o.units, files: o.files || (rootFiles && rootFiles.f) }); }
    if (!out.length) throw new Error('no faction folders found. Pick the BattleDrillModels folder the downloader made');
    out.sort((a, b) => a.name.localeCompare(b.name)); return { byName, factions: out };
  }
  async function importFactions(sc, names, opt, say) {
    const d = await idbOpen(); let ok = 0, bad = 0; const why = {};
    for (const fac of sc.factions.filter(f => names.includes(f.name))) {
      const units = JSON.parse(await fac.units.text()), map = fac.files ? JSON.parse(await fac.files.text()) : {};
      const file = id => sc.byName.get(map[id] || '') || sc.byName.get(id + '.obj') || sc.byName.get(id + '.tex.jpg') || sc.byName.get(id + '.tex.png') || sc.byName.get(id + '.tex.img');
      const getMesh = async id => { const f = file(id); if (!f) throw new Error('missing ' + id); return await f.text(); }, getTex = async id => { const f = file(id); if (!f) throw new Error('missing ' + id); return f; };
      { const t = tx(d, ['figs', 'index'], 'readwrite'), rngk = IDBKeyRange.bound(fac.name + '|', fac.name + '|￿'); t.objectStore('figs').delete(rngk); t.objectStore('index').delete(rngk); await done(t); }
      let i = 0;
      for (const u of units.units) {
        i++; say(fac.name + ': converting ' + i + ' of ' + units.units.length + ' (' + u.name + ')');
        try {
          const r = await MODELIMP.build(u, getMesh, getTex, opt); if (!r.parts.length) { bad++; (why[fac.name] = why[fac.name] || []).push(u.name + ': empty' + (MODELIMP.build.err ? ' (' + MODELIMP.build.err + ')' : '')); continue; }
          let hy = 0; for (const p of r.parts) for (let k = 1; k < p.V.length; k += 3) if (p.V[k] > hy) hy = p.V[k];
          const key = fac.name + '|' + i, rec = { key, faction: fac.name, name: u.name, big: r.big, tris: r.tris, parts: r.parts.map(p => ({ V: p.V, N: p.N, C: p.C, T: p.T })) };
          const t = tx(d, ['figs', 'index'], 'readwrite'); t.objectStore('figs').put(rec); if (r.hi) t.objectStore('figs').put(r.hi.textured ? { key: key + '#hi', faction: fac.name, name: u.name, big: r.big, tris: r.hi.tris, textured: 1, texs: r.hi.texs, parts: r.hi.parts.map(p => ({ V: p.V, N: p.N, UV: p.UV, T: p.T, ti: p.ti })) } : { key: key + '#hi', faction: fac.name, name: u.name, big: r.big, tris: r.hi.tris, parts: r.hi.parts.map(p => ({ V: p.V, N: p.N, C: p.C, T: p.T })) }); t.objectStore('index').put({ key, faction: fac.name, name: u.name, h: hy, tris: r.tris, hi: r.hi ? r.hi.tris : 0, htx: r.hi && r.hi.textured ? 1 : 0 }); await done(t); ok++;
        } catch (e) { bad++; (why[fac.name] = why[fac.name] || []).push(u.name + ': ' + (e && e.message || e)); console.warn('model skipped', u.name, e); }
        if (i % 4 === 0) await new Promise(r => setTimeout(r, 0));
      }
    }
    d.close(); await load(); ping(); window.__bdImportFails = why; return { ok, bad, why };
  }
  async function clearAll() { const d = await idbOpen(); const t = tx(d, ['figs', 'index'], 'readwrite'); t.objectStore('figs').clear(); t.objectStore('index').clear(); await done(t); d.close(); index = []; cache.clear(); poolCache.clear(); ping(); }
  const factions = () => { const c = {}; for (const m of index) c[m.faction] = (c[m.faction] || 0) + 1; return c; };
  return { debug: (ds, fac) => { const t = toks(ds).filter(w => w.length > 3)[0] || toks(ds)[0] || '', hits = index.filter(f => toks(f.name).some(w => w === t || w.includes(t))); const mine = index.filter(f => String(f.faction).toLowerCase() === String(fac).toLowerCase()); return 'faction has ' + mine.length + ' models' + (mine.length ? ' (tallest ' + Math.max(...mine.map(f => f.h)).toFixed(2) + ')' : '') + '; name hits for "' + t + '": ' + (hits.length ? hits.slice(0, 3).map(f => f.faction + ': ' + f.name + ' h=' + f.h.toFixed(2)).join(' | ') : 'none'); }, variants: (ds, fac) => pool(ds, fac) || [], fig: m => fetchFig(m) || cache.get(m.key) || null, why: (ds, fac) => { const p = pool(ds, fac); return p ? p.map(f => f.faction + ': ' + f.name) : 'no match among ' + index.length + ' models'; }, load, pick, add, scan, importFactions, clearAll, factions, on: () => index.length > 0 && get('on', '1') === '1', count: () => index.length, get, set, reprep: async () => { cache.clear(); hiOrder.length = 0; poolCache.clear(); ping(); }, upgrade, frame, hiCount: () => index.filter(m => m.hi).length, texCount: () => index.filter(m => m.htx).length, hiTris: () => index.reduce((n, m) => n + (m.hi || 0), 0) };
})();
window.BDModels = BDModels; window.MODELIMP = MODELIMP;

/* ===== BDPreview: click a unit name in the army builder to open its datasheet with a rotatable 3D model ===== */
(function () {
  'use strict';
  let cv = null, R = null, cam = null, raf = 0, last = 0, idle = 0, ext = new WeakMap(), cur = null;
  const ENV = { sun: [-.45, .62, .5], sunC: [1.5, 1.42, 1.3], ambT: [.34, .36, .42], ambB: [.2, .2, .22], fog: [.075, .08, .09], fogD: .0004, dust: 0 };
  const ENV0 = JSON.parse(JSON.stringify(ENV)), ENVF = { sun: [-.45, .62, .5], sunC: [0, 0, 0], ambT: [1.9, 1.9, 1.9], ambB: [1.9, 1.9, 1.9], fog: [.075, .08, .09], fogD: 0, dust: 0 }; let flatLight = false;
  function ensureGL() {
    if (R) return true;
    try {
      if (typeof BF === 'undefined') return false;
      cv = document.createElement('canvas'); cv.style.cssText = 'display:block;width:100%;height:100%;border-radius:inherit;touch-action:none;cursor:grab';
      R = new BF.Renderer(cv); R.q.shadow = 1024; R.q.dpr = Math.min(window.devicePixelRatio || 1, 1.5); R.makeShadow(); cam = new BF.Cam(); cam.pitch = .38;
      let d = null;
      cv.addEventListener('pointerdown', e => { d = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
      cv.addEventListener('pointermove', e => { if (!d) return; cam.yaw -= (e.clientX - d[0]) * .01; cam.pitch = Math.max(.05, Math.min(1.4, cam.pitch + (e.clientY - d[1]) * .006)); d = [e.clientX, e.clientY]; idle = performance.now() + 4000; });
      cv.addEventListener('pointerup', () => { d = null; cv.style.cursor = 'grab'; });
      cv.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.max(1.2, Math.min(80, cam.dist * (e.deltaY > 0 ? 1.1 : .9))); idle = performance.now() + 4000; }, { passive: false });
      return true;
    } catch (e) { console.warn('3D preview unavailable', e); R = null; cv = null; return false; }
  }
  function extent(fig) {
    let e = ext.get(fig); if (e) return e; let h = 0, r = 0;
    for (const p of fig.parts) for (let i = 0; i < p.V.length; i += 3) { if (p.V[i + 1] > h) h = p.V[i + 1]; const d = Math.hypot(p.V[i], p.V[i + 2]); if (d > r) r = d; }
    e = { h: h || 1, r: r || 1 }; ext.set(fig, e); return e;
  }
  function upload(fig) {
    fig = BDModels.upgrade(fig);
    R.clear(); const mb = new BF.MB(), e = extent(fig), cx = 30, cz = 22, rd = Math.max(e.r * 1.25, .8);
    for (let k = 0; k < 28; k++) { const a = k / 28 * 6.2832, b = (k + 1) / 28 * 6.2832, base = mb.n; mb.vtx([cx, .004, cz], [0, 1, 0], [.17, .17, .19], [0, 0]); mb.vtx([cx + Math.cos(a) * rd, .004, cz + Math.sin(a) * rd], [0, 1, 0], [.13, .13, .15], [0, 0]); mb.vtx([cx + Math.cos(b) * rd, .004, cz + Math.sin(b) * rd], [0, 1, 0], [.13, .13, .15], [0, 0]); mb.I.push(base, base + 2, base + 1); }
    BDModels.add(mb, fig, cx, 0, cz, 0); R.upload(mb, 'solid');
    cam.target = [cx, e.h * .45, cz]; cam.dist = Math.max(1.7, Math.max(e.h, e.r * 1.5) * 2.0); cam.fov = .6; cam.yaw = 0; cam.pitch = .38;
  }
  function frame(now) {
    raf = 0; const m = document.getElementById('modal'); if (!cv || !cv.isConnected || !m || m.hidden) return;
    const dt = Math.min(.1, (now - (last || now)) / 1000); last = now; if (now > idle) cam.yaw += dt * .7;
    try { R.draw(cam, ENV); } catch (e) { console.warn(e); return; }
    raf = requestAnimationFrame(frame);
  }
  /* put the current model into the datasheet's picture slot */
  /* a one-line readout of what a figure is made of, so a pale model can be told apart from a pale texture */
  function diagOf(fig) {
    try {
      const imgs = [...new Set(fig.parts.filter(q => q.img).map(q => q.img))];
      if (!imgs.length) return 'vertex-colour copy (no texture)' + (fig.parts.length ? ', ' + Math.round(fig.parts.reduce((a, q) => a + q.T.length / 3, 0) / 1000) + 'k tris' : '');
      const cv = document.createElement('canvas'); cv.width = cv.height = 16; const g = cv.getContext('2d', { willReadFrequently: true }); let r = 0, gg = 0, b = 0, n = 0, dims = [];
      for (const im of imgs) { g.clearRect(0, 0, 16, 16); g.drawImage(im, 0, 0, 16, 16); const d = g.getImageData(0, 0, 16, 16).data; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; } dims.push(im.width + 'x' + im.height); }
      let th = ''; try { const big = imgs.slice().sort((a, b) => b.width - a.width)[0], t = document.createElement('canvas'); t.width = t.height = 96; t.getContext('2d').drawImage(big, 0, 0, 96, 96); th = '<img src="' + t.toDataURL('image/jpeg', .8) + '" width="96" height="96" style="display:block;margin:4px auto;border:1px solid #555">'; } catch (e) { }
      return th + 'textured copy, ' + imgs.length + ' texture' + (imgs.length > 1 ? 's' : '') + ' (' + dims.join(', ') + '), average colour rgb(' + Math.round(r / n) + ',' + Math.round(gg / n) + ',' + Math.round(b / n) + '), ' + Math.round(fig.parts.reduce((a, q) => a + q.T.length / 3, 0) / 1000) + 'k tris';
    } catch (e) { return 'diagnostic failed: ' + e.message; }
  }
  function mount() {
    let slot = document.querySelector('#modal-box .ds-img'); if (!cur) return; const head = document.querySelector('#modal-box .ds-head');
    if (!slot) { if (!head) return; slot = document.createElement('div'); slot.className = 'ds-img mini'; slot.style.cssText = 'display:none'; head.insertBefore(slot, head.firstChild); }
    const note = t => { let b = document.getElementById('bdp-bar'); if (!b) { b = document.createElement('div'); b.id = 'bdp-bar'; b.style.cssText = 'text-align:center;font-size:12px;opacity:.85;margin-bottom:8px'; slot.after(b); } b.textContent = t; };
    if (!BDModels.on()) return note('3D models are switched off or none are imported.');
    const vars = BDModels.variants(cur.ds, cur.faction); if (!vars.length) return note('No 3D model matched "' + cur.ds + '" (' + cur.faction + '). ' + BDModels.count() + ' models loaded; ' + BDModels.debug(cur.ds, cur.faction));
    cur.vi = ((cur.vi % vars.length) + vars.length) % vars.length; const m = vars[cur.vi], fig = BDModels.fig(m); if (!fig) return note('Loading 3D model: ' + m.name + '…'); if (!ensureGL()) return note('3D view needs WebGL 2.');
    slot.classList.add('mini'); slot.style.cssText = 'position:static;display:block;width:min(100%,340px);height:auto;aspect-ratio:1;margin:2px auto 4px;background:#16181c;border-radius:10px;overflow:hidden';
    const shown = BDModels.upgrade(fig); try { if (cur.fig !== shown) { const keep = cur.fig ? [cam.yaw, cam.pitch, cam.dist] : null; upload(shown); cur.fig = shown; if (keep) { cam.yaw = keep[0]; cam.pitch = keep[1]; cam.dist = keep[2]; } } } catch (e) { console.warn(e); return note('Could not draw ' + m.name + ': ' + (e && e.message || e)); }
    if (cv.parentNode !== slot) slot.appendChild(cv);
    let bar = document.getElementById('bdp-bar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'bdp-bar'; bar.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:10px;font-size:12px;opacity:.85;margin-bottom:8px'; slot.after(bar); }
    bar.innerHTML = (vars.length > 1 ? '<button class="btn" id="bdp-p" type="button">‹</button>' : '') + '<span>' + m.name.replace(/</g, '&lt;') + (vars.length > 1 ? ' · ' + (cur.vi + 1) + ' of ' + vars.length : '') + ' · drag to turn, scroll to zoom</span>' + (vars.length > 1 ? '<button class="btn" id="bdp-n" type="button">›</button>' : '') + '<button class="btn" id="bdp-f" type="button" style="font-size:11px">' + (flatLight ? 'Normal light' : 'Flat light') + '</button><div style="flex-basis:100%;font-size:10px;opacity:.7">' + diagOf(shown) + (shown === fig && m.hi && BDModels.get('hiPrev', '1') === '1' ? ' · loading the richer copy…' : '') + '</div>';
    const fb = bar.querySelector('#bdp-f'); if (fb) fb.onclick = () => { flatLight = !flatLight; Object.assign(ENV, JSON.parse(JSON.stringify(flatLight ? ENVF : ENV0))); try { R.draw(cam, ENV); } catch (e) { } mount(); };
    const go = d => () => { cur.vi += d; cur.fig = null; mount(); }; const p = bar.querySelector('#bdp-p'), n = bar.querySelector('#bdp-n'); if (p) p.onclick = go(-1); if (n) n.onclick = go(1);
    R.resize(); try { R.draw(cam, ENV); } catch (e) { } if (raf) cancelAnimationFrame(raf); last = 0; raf = requestAnimationFrame(frame);
  }
  function open(el) {
    let u = null; try { u = findLib(el.dataset.libid); } catch (e) { } if (!u || typeof openModal !== 'function' || typeof datasheetCard !== 'function') return;
    const nm = +el.dataset.nm; if (nm > 0) u = Object.assign({}, u, { models: nm });
    openModal('<div class="row"><h2 style="margin:0">' + String(u.name).replace(/</g, '&lt;') + '</h2><button class="btn" id="m-close" type="button">Close</button></div>' + datasheetCard(u, u.faction, {}));
    const c = document.getElementById('m-close'); if (c) c.addEventListener('click', closeModal);
    cur = { ds: u.ds || u.name, faction: u.faction, key: u.id, vi: 0, fig: null };
    const p = BDModels.pick(cur.ds, cur.faction, u.id), vars = BDModels.variants(cur.ds, cur.faction); if (p) cur.vi = Math.max(0, vars.findIndex(m => BDModels.fig(m) === p));
    mount();
  }
  /* hover pop-ups: swap the token picture for a slowly turning model (click the name for the one you can rotate) */
  let hov = null, tip = null, tshown = null;
  function unitOf(el) {
    try {
      let n = el.closest && el.closest('[data-libid]'); if (n) { const u = findLib(n.dataset.libid); if (u) return { key: u.id, ds: u.ds || u.name, faction: u.faction }; }
      n = el.closest && el.closest('[data-bu]'); if (n) { const [bid, bi] = n.dataset.bu.split('|'), bb = findBuild(bid), u = bb && bb.units[+bi]; if (u) return { key: bid + ':' + bi, ds: u.ds || u.name, faction: bb.faction || u.faction }; }
      n = el.closest && el.closest('[data-uid]'); if (n && typeof G !== 'undefined') { const u = (G.units || []).find(x => String(x.id) === n.dataset.uid); if (u) return { key: u.id, ds: u.ds || u.name, faction: typeof miniFactionOf === 'function' ? miniFactionOf(u) : u.faction }; }
    } catch (e) { }
    return null;
  }
  function tipAttach() {
    const m = document.getElementById('modal'); if (!tip || tip.style.display !== 'block' || !hov || !BDModels.on() || (m && !m.hidden)) return;
    const fig = BDModels.pick(hov.ds, hov.faction, hov.key); if (!fig || !ensureGL()) return;
    let slot = tip.querySelector('.ds-img'); if (!slot) { const head = tip.querySelector('.ds-head'); if (!head) return; slot = document.createElement('div'); slot.className = 'ds-img mini'; head.insertBefore(slot, head.firstChild); }
    else if (!slot.classList.contains('mini')) return;
    if (tshown !== fig || cur) { upload(fig); tshown = fig; cur = null; }
    slot.style.backgroundImage = 'none'; if (cv.parentNode !== slot) slot.appendChild(cv); R.resize(); try { R.draw(cam, ENV); } catch (e) { }
    if (!raf) { last = 0; raf = requestAnimationFrame(tframe); }
  }
  function tframe(now) {
    raf = 0; if (!cv || !cv.isConnected || !tip || tip.style.display !== 'block') return;
    const dt = Math.min(.1, (now - (last || now)) / 1000); last = now; cam.yaw += dt * .7; try { R.draw(cam, ENV); } catch (e) { return; } raf = requestAnimationFrame(tframe);
  }
  function watch() { tip = document.querySelector('.tip-pop'); if (!tip) return setTimeout(watch, 500); new MutationObserver(() => { if (tip.style.display === 'block') tipAttach(); }).observe(tip, { childList: true, attributes: true, attributeFilter: ['style'] }); }
  document.addEventListener('mouseover', e => { const u = unitOf(e.target); if (u) hov = u; }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('#builder [data-libid]'); if (!el || (e.target.closest && e.target.closest('button,select,input,a'))) return;
    open(el);
  });
  window.addEventListener('bd-models-changed', () => { tshown = null; tipAttach(); if (cur && document.querySelector('#modal-box .ds-img')) mount(); });
  /* an inline turning model inside a datasheet that is part of a page (the Crusade unit preview) */
  let pane = null;
  function paneFrame(now) {
    raf = 0; if (!pane || !pane.box.isConnected || !cv || cv.parentNode !== pane.slot) return;
    const dt = Math.min(.1, (now - (last || now)) / 1000); last = now; if (now > idle) cam.yaw += dt * .7;
    try { R.draw(cam, ENV); } catch (e) { return; } raf = requestAnimationFrame(paneFrame);
  }
  function mountPane(box, ds, faction, key, vi) {
    if (!box || !box.isConnected || !BDModels.on()) { pane = null; return; }
    const head = box.querySelector('.ds-head'); if (!head) return; const vars = BDModels.variants(ds, faction); if (!vars.length) { pane = null; return; }
    vi = ((vi == null ? Math.max(0, vars.findIndex(m => BDModels.fig(m) === BDModels.pick(ds, faction, key))) : vi) % vars.length + vars.length) % vars.length;
    const m = vars[vi], fig = BDModels.fig(m); pane = { box, ds, faction, key, vi, slot: null }; if (!fig || !ensureGL()) return;
    let slot = box.querySelector('.ds-img'); if (!slot) { slot = document.createElement('div'); slot.className = 'ds-img mini'; head.insertBefore(slot, head.firstChild); }
    slot.classList.add('mini'); slot.style.cssText = 'position:static;display:block;width:min(100%,300px);height:auto;aspect-ratio:1;margin:2px auto 4px;background:#16181c;border-radius:10px;overflow:hidden'; slot.style.backgroundImage = 'none';
    try { upload(fig); } catch (e) { console.warn(e); return; } cur = null; tshown = null; pane.slot = slot; if (cv.parentNode !== slot) slot.appendChild(cv);
    let bar = box.querySelector('.bdp-pbar'); if (!bar) { bar = document.createElement('div'); bar.className = 'bdp-pbar'; bar.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:10px;font-size:12px;opacity:.85;margin-bottom:8px'; slot.after(bar); }
    bar.innerHTML = (vars.length > 1 ? '<button class="btn" data-d="-1" type="button">‹</button>' : '') + '<span>' + m.name.replace(/</g, '&lt;') + (vars.length > 1 ? ' · ' + (vi + 1) + ' of ' + vars.length : '') + ' · drag to turn</span>' + (vars.length > 1 ? '<button class="btn" data-d="1" type="button">›</button>' : '');
    bar.querySelectorAll('button').forEach(b => b.onclick = () => mountPane(box, ds, faction, key, vi + +b.dataset.d));
    R.resize(); try { R.draw(cam, ENV); } catch (e) { } if (!raf) { last = 0; raf = requestAnimationFrame(paneFrame); }
  }
  window.addEventListener('bd-models-changed', () => { if (pane && pane.box.isConnected) mountPane(pane.box, pane.ds, pane.faction, pane.key, pane.vi); });
  /* several inline turning models at once (the two datasheets in the dice quiz): each card gets its own small renderer so both turn together */
  const cards = [];
  function cardFrame(now) {
    craf = 0; for (let i = cards.length - 1; i >= 0; i--) if (!cards[i].box.isConnected) { try { const g = cards[i].cv.getContext('webgl2'); const x = g && g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { } cards.splice(i, 1); }
    if (!cards.length) return;
    /* spin the tokens at about 30 frames a second, only the ones actually on screen, and not at all in a hidden tab: scrolling past a screenful of cards stays smooth */
    if (document.hidden || now - (clast || 0) < 30) { craf = requestAnimationFrame(cardFrame); return; }
    const dt = Math.min(.1, (now - (clast || now)) / 1000); clast = now; const vh = innerHeight, vw = innerWidth;
    const sv = [R, cam, cv]; for (const V of cards) { if (!V.slot.isConnected || V.slot.offsetParent === null) continue; const rc = V.slot.getBoundingClientRect(); if (rc.bottom < 0 || rc.top > vh || rc.right < 0 || rc.left > vw) continue; R = V.R; cam = V.cam; cv = V.cv; cam.yaw += dt * .7; try { R.draw(cam, ENV); } catch (e) { } }
    R = sv[0]; cam = sv[1]; cv = sv[2]; craf = requestAnimationFrame(cardFrame);
  }
  let craf = 0, clast = 0;
  function mountCards(root) {
    if (!BDModels.on() || typeof BF === 'undefined') return;
    (root || document).querySelectorAll('.ds[data-3d], .sch-3d[data-3d]').forEach(box => {
      const solo = box.classList.contains('sch-3d');
      if (box._bd3 || box.closest('.tip-pop') || box.closest('#modal-box')) return;
      for (let i = cards.length - 1; i >= 0; i--) if (cards[i].box === box) cards.splice(i, 1);
      const head = solo ? box : box.querySelector('.ds-head'); if (!head) return; const fig = BDModels.upgrade(BDModels.pick(box.dataset.ds3, box.dataset.fac3, box.dataset.key3)); if (!fig) return; box._bd3 = 1;
      const c2 = document.createElement('canvas'); c2.style.cssText = 'display:block;width:100%;height:100%;border-radius:inherit;touch-action:none'; let V;
      const sv = [R, cam, cv];
      try { cv = c2; R = new BF.Renderer(c2); R.q.shadow = 512; R.q.dpr = Math.min(window.devicePixelRatio || 1, 1.5); R.makeShadow(); cam = new BF.Cam(); cam.pitch = .38; upload(fig); V = { box, cv: c2, R, cam }; } catch (e) { console.warn('card 3D unavailable', e); R = sv[0]; cam = sv[1]; cv = sv[2]; return; }
      R = sv[0]; cam = sv[1]; cv = sv[2];
      let slot; if (solo) { slot = box; box.hidden = false; box.innerHTML = ''; box.appendChild(c2); } else { slot = head.querySelector('.ds-img'); if (!slot) { slot = document.createElement('div'); head.insertBefore(slot, head.firstChild); }
        slot.className = 'ds-img mini ds-3dslot'; slot.style.cssText = 'display:block;aspect-ratio:1;height:auto;background:#16181c;border-radius:12px;overflow:hidden;border:2px solid rgba(255,255,255,.35)'; slot.innerHTML = ''; slot.appendChild(c2); } V.slot = slot;
      let d = null; c2.style.cursor = 'grab'; c2.addEventListener('pointerdown', e => { d = e.clientX; c2.setPointerCapture(e.pointerId); }); c2.addEventListener('pointermove', e => { if (d == null) return; V.cam.yaw -= (e.clientX - d) * .012; d = e.clientX; }); c2.addEventListener('pointerup', () => { d = null; });
      cards.push(V); const s2 = [R, cam, cv]; R = V.R; cam = V.cam; cv = V.cv; try { R.resize(); R.draw(cam, ENV); } catch (e) { } R = s2[0]; cam = s2[1]; cv = s2[2];
      if (!craf) { clast = 0; craf = requestAnimationFrame(cardFrame); }
    });
  }
  { let pend = 0; const kick = () => { if (pend) return; pend = setTimeout(() => { pend = 0; try { mountCards(document); } catch (e) { console.warn(e); } }, 60); };
    const start = () => new MutationObserver(kick).observe(document.body, { childList: true, subtree: true });
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    window.addEventListener('bd-models-changed', () => { document.querySelectorAll('.ds[data-3d], .sch-3d[data-3d]').forEach(b => { b._bd3 = 0; }); kick(); }); }
  window.BDPreview = { enabled: () => true, set: () => { }, pane: (box, ds, faction, key) => mountPane(box, ds, faction, key), cards: mountCards };
})();
