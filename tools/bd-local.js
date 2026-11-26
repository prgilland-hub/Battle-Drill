/* Battle Drill desktop shim: gives the app the same window.claude.use('db' | 'downloads' | 'sample')
   interface it sees on claude.ai, but backed by IndexedDB, file downloads and the Anthropic API. */
(function () {
  'use strict';
  if (window.claude && typeof window.claude.use === 'function') return; /* running on claude.ai: leave it alone */
  const VERSION = '__BD_VERSION__';
  const KEY_LS = 'battleDrill.local.apiKey', MODEL_LS = 'battleDrill.local.model';
  const DEFAULT_MODEL = 'claude-sonnet-5-5';
  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

  /* ---------- IndexedDB document store ---------- */
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('battle-drill-local', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('docs', { keyPath: 'k' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const tx = async (mode, fn) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('docs', mode), s = t.objectStore('docs'); let out; Promise.resolve(fn(s)).then(v => { out = v; }); t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const cache = new Map(); /* coll -> Map(id -> data) */
  async function load(coll) {
    if (cache.has(coll)) return cache.get(coll);
    const m = new Map(); const d = await idb();
    await new Promise((res, rej) => { const t = d.transaction('docs', 'readonly'); const rq = t.objectStore('docs').openCursor(); rq.onsuccess = () => { const c = rq.result; if (!c) return res(); if (c.value.coll === coll) m.set(c.value.id, c.value.data); c.continue(); }; rq.onerror = () => rej(rq.error); });
    cache.set(coll, m); return m;
  }
  async function put(coll, id, data) { const m = await load(coll); m.set(id, data); await tx('readwrite', s => { s.put({ k: coll + '/' + id, coll, id, data }); }); }
  async function del(coll, id) { const m = await load(coll); m.delete(id); await tx('readwrite', s => { s.delete(coll + '/' + id); }); }
  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => clone(data) });
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  function query(coll, f) {
    return {
      where(field, op, val) { return query(coll, Object.assign({}, f, { w: (f.w || []).concat([[field, op, val]]) })); },
      orderBy(field, dir) { return query(coll, Object.assign({}, f, { o: [field, dir === 'desc' ? -1 : 1] })); },
      limit(n) { return query(coll, Object.assign({}, f, { l: n })); },
      async get() {
        const m = await load(coll); let rows = [...m.entries()].map(([id, data]) => ({ id, data }));
        for (const [field, op, val] of (f.w || [])) rows = rows.filter(r => { const v = r.data[field]; return op === '>' ? v > val : op === '>=' ? v >= val : op === '<' ? v < val : op === '<=' ? v <= val : op === '==' || op === '===' ? v === val : true; });
        if (f.o) rows.sort((a, b) => f.o[1] * cmp(a.data[f.o[0]], b.data[f.o[0]]));
        if (f.l) rows = rows.slice(0, f.l);
        return { docs: rows.map(r => snap(r.id, r.data)), size: rows.length, empty: !rows.length, forEach(fn) { this.docs.forEach(fn); } };
      },
    };
  }
  const db = {
    collection(coll) {
      const q = query(coll, {});
      return Object.assign({}, q, {
        doc(id) { id = String(id); return { id, async get() { const m = await load(coll); return snap(id, m.get(id)); }, async set(d) { await put(coll, id, clone(d)); }, async update(d) { const m = await load(coll); await put(coll, id, Object.assign({}, m.get(id) || {}, clone(d))); }, async delete() { await del(coll, id); } }; },
        async add(d) { const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)); await put(coll, id, clone(d)); return { id }; },
      });
    },
  };

  /* ---------- downloads ---------- */
  const downloads = { async save({ filename, data }) { const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename || 'battle-drill.txt'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); } };

  /* ---------- the coach: Anthropic API with your own key ---------- */
  const getKey = () => { try { return localStorage.getItem(KEY_LS) || ''; } catch (e) { return ''; } };
  const getModel = () => { try { return localStorage.getItem(MODEL_LS) || DEFAULT_MODEL; } catch (e) { return DEFAULT_MODEL; } };
  const fail = (code, text) => { const e = new Error(text || code); e.code = code; e.text = text; return e; };
  async function sample(turns, opts) {
    opts = opts || {}; const key = getKey();
    if (!key) throw fail('no_key');
    const tools = (opts.tools || []).map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    const exec = {}; (opts.tools || []).forEach(t => { exec[t.name] = t.execute; });
    const msgs = (turns || []).map(t => ({ role: t.role, content: t.content }));
    let all = '', truncated = false;
    for (let round = 0; round < 6; round++) {
      let resp;
      try {
        resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: getModel(), max_tokens: opts.maxTokens || 2048, stream: true, messages: msgs, tools: tools.length ? tools : undefined }) });
      } catch (e) { if (e && e.name === 'AbortError') throw Object.assign(fail('cancelled'), { text: all }); throw fail('upstream_error'); }
      if (!resp.ok) { const c = resp.status; throw fail(c === 401 || c === 403 ? 'bad_key' : c === 429 ? 'rate_limited' : c === 413 ? 'prompt_too_large' : 'upstream_error'); }
      const blocks = [], reader = resp.body.getReader(), dec = new TextDecoder(); let buf = '', stop = '';
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf('\n\n')) >= 0) {
            const ev = buf.slice(0, i); buf = buf.slice(i + 2);
            const line = ev.split('\n').find(l => l.startsWith('data:')); if (!line) continue; let j; try { j = JSON.parse(line.slice(5)); } catch (e) { continue; }
            if (j.type === 'content_block_start') blocks[j.index] = j.content_block.type === 'tool_use' ? { type: 'tool_use', id: j.content_block.id, name: j.content_block.name, json: '' } : { type: 'text', text: '' };
            else if (j.type === 'content_block_delta') { const b = blocks[j.index]; if (!b) continue; if (j.delta.type === 'text_delta') { b.text += j.delta.text; if (opts.onText) { try { opts.onText({ text: all + blocks.filter(x => x && x.type === 'text').map(x => x.text).join('') }); } catch (e) { } } } else if (j.delta.type === 'input_json_delta') b.json += j.delta.partial_json; }
            else if (j.type === 'message_delta' && j.delta && j.delta.stop_reason) stop = j.delta.stop_reason;
            else if (j.type === 'error') throw fail(j.error && j.error.type === 'rate_limit_error' ? 'rate_limited' : 'upstream_error');
          }
        }
      } catch (e) { if (e && e.name === 'AbortError') throw Object.assign(fail('cancelled'), { text: all + blocks.filter(x => x && x.type === 'text').map(x => x.text).join('') }); throw e.code ? e : fail('upstream_error'); }
      const text = blocks.filter(x => x && x.type === 'text').map(x => x.text).join('');
      if (stop === 'tool_use') {
        const uses = blocks.filter(x => x && x.type === 'tool_use');
        msgs.push({ role: 'assistant', content: blocks.filter(Boolean).map(b => b.type === 'text' ? { type: 'text', text: b.text } : { type: 'tool_use', id: b.id, name: b.name, input: (() => { try { return b.json ? JSON.parse(b.json) : {}; } catch (e) { return {}; } })() }).filter(b => b.type !== 'text' || b.text) });
        const results = [];
        for (const u of uses) { let out, err = false; try { out = await exec[u.name](u.json ? JSON.parse(u.json) : {}); } catch (e) { out = String((e && e.message) || e); err = true; } results.push({ type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out), is_error: err }); }
        msgs.push({ role: 'user', content: results }); all += text ? text + '\n\n' : ''; continue;
      }
      all += text; truncated = stop === 'max_tokens';
      if (!all.trim()) throw fail('empty_completion');
      return { text: all, truncated };
    }
    return { text: all || 'I ran out of steps for that question.', truncated: true };
  }
  sample.limits = async () => ({ tools: true });

  window.claude = { local: true, version: VERSION, use: async name => { if (name === 'db') return db; if (name === 'downloads') return downloads; if (name === 'sample') return sample; throw fail('not_declared', name + ' is not available in the desktop app'); } };
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }

  /* ---------- small desktop menu: key, update, backup, fullscreen ---------- */
  async function dump() { const d = await idb(); const rows = await req(d.transaction('docs').objectStore('docs').getAll()); const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('battleDrill.') && k !== KEY_LS) ls[k] = localStorage.getItem(k); } return { app: 'battle-drill', version: VERSION, at: new Date().toISOString(), docs: rows, ls }; }
  async function restore(j) { if (!j || j.app !== 'battle-drill' || !Array.isArray(j.docs)) throw new Error('not a Battle Drill backup'); const d = await idb(); await new Promise((res, rej) => { const t = d.transaction('docs', 'readwrite'), s = t.objectStore('docs'); j.docs.forEach(r => s.put(r)); t.oncomplete = res; t.onerror = () => rej(t.error); }); Object.entries(j.ls || {}).forEach(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) { } }); }
  async function checkUpdate(ui) {
    ui('Checking…');
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); const v = await r.json();
      if (v.version === VERSION) return ui('You have the latest version (' + VERSION + ').');
      ui('Downloading ' + v.version + '…');
      const h = await fetch('index.html?t=' + Date.now(), { cache: 'no-store' }); if (!h.ok) throw new Error('HTTP ' + h.status); const buf = await h.arrayBuffer();
      if (v.sha256) { const dig = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join(''); if (dig !== v.sha256) throw new Error('download did not match its checksum, not installed'); }
      const c = await caches.open('battle-drill'); await c.put('index.html', new Response(buf, { headers: { 'content-type': 'text/html' } }));
      ui('Updated to ' + v.version + '. Reloading…'); setTimeout(() => location.reload(), 800);
    } catch (e) { ui('Update failed: ' + ((e && e.message) || e)); }
  }
  function menu() {
    const css = document.createElement('style'); css.textContent = '#bdl-b{position:fixed;left:8px;bottom:8px;z-index:99999;width:30px;height:30px;border-radius:50%;border:1px solid #888;background:#222;color:#ddd;font:16px/1 sans-serif;cursor:pointer;opacity:.45}#bdl-b:hover{opacity:1}#bdl-p{position:fixed;left:8px;bottom:46px;z-index:99999;width:300px;background:#1d1d1d;color:#eee;border:1px solid #666;border-radius:8px;padding:12px;font:13px/1.4 sans-serif;display:none}#bdl-p input,#bdl-p button{font:inherit;margin:3px 0}#bdl-p input[type=password],#bdl-p input[type=text]{width:100%;box-sizing:border-box}#bdl-p button{padding:4px 8px;cursor:pointer}#bdl-p h4{margin:8px 0 2px;font-size:12px;color:#aaa;text-transform:uppercase}#bdl-s{color:#9c9;min-height:1.2em}';
    document.head.appendChild(css);
    const b = document.createElement('button'); b.id = 'bdl-b'; b.title = 'Desktop settings'; b.textContent = '⚙'; const p = document.createElement('div'); p.id = 'bdl-p';
    p.innerHTML = '<h4>App and updates</h4><p class="muted">Battle Drill desktop v' + VERSION + '</p><button id="bdl-u">Check for update</button><div id="bdl-s"></div><h4>Coach</h4><p class="muted">Your Anthropic API key and model, kept on this computer only.</p><input type="password" id="bdl-k" placeholder="sk-ant-…" autocomplete="off"><input type="text" id="bdl-m" placeholder="model"><button id="bdl-ks">Save key and model</button><h4>Backup</h4><p class="muted">Armies, saved games and settings, as one file.</p><button id="bdl-ex">Back up everything</button> <button id="bdl-im">Restore backup</button><h4>3D models</h4><div id="bdl-ms" style="color:#aaa"></div><button id="bdl-mi">Import models folder…</button><div id="bdl-mf" style="max-height:200px;overflow:auto"></div> <button id="bdl-mx">Remove</button><label style=\"display:block;margin:5px 0\"><input type="checkbox" id="bdl-mo"> Use my models on the 3D board</label><label style=\"display:block;margin:5px 0\"><input type="checkbox" id="bdl-mm"> Mirror left/right</label><label style=\"display:block;margin:5px 0\"><input type="checkbox" id="bdl-mk"> Turn cold blue Khorne models blood red</label><label style=\"display:block;margin:5px 0\">Turn all models <select id="bdl-my"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label><label style=\"display:block;margin:5px 0\">Detail on import <select id="bdl-mq"><option value="1">Standard (about 10k triangles per model)</option><option value="2.5">Higher (about 25k)</option><option value="full">Full, no simplifying (very large)</option></select></label><label style=\"display:block;margin:5px 0\">Also keep a high-detail copy <select id="bdl-mh"><option value="">No</option><option value="hi">High (about 40k triangles, 100k for big models)</option><option value="max">Maximum (about 120k, 250k for big models)</option></select></label><div style="color:#999;font-size:.85em;margin:2px 0 6px">The high-detail copy is used in the datasheet previews. Re-import your models after changing either setting. Maximum uses a lot of disk space (roughly 3 MB per model).</div><label style=\"display:block;margin:5px 0\"><input type="checkbox" id="bdl-mb"> Use the high-detail models in battles</label><div id="bdl-mhs" style="color:#999;font-size:.85em"></div><h4>Window</h4><button id="bdl-f">Toggle full screen</button>';
    const host = document.querySelector('#tab-settings .settings');
    if (host) {
      /* inside the app's Settings page: one section per heading, in the app's own look, no floating button */
      css.textContent = '#bdl-p{display:block}#bdl-p input[type=password],#bdl-p input[type=text]{width:100%;max-width:420px;box-sizing:border-box}#bdl-p button,#bdl-p select{margin:3px 6px 3px 0}#bdl-s{min-height:1.2em;font-size:.88rem}#bdl-mf{max-height:220px;overflow:auto}#bdl-p label{display:block;margin:6px 0}';
      document.head.appendChild(css);
      p.innerHTML = p.innerHTML.replace(/<h4>/g, '</div><div class="set-sec"><h3>').replace(/<\/h4>/g, '</h3>');
      p.innerHTML = p.innerHTML.replace(/^<\/div>/, '');
      p.innerHTML = '<div class="set-sec">' + p.innerHTML + '</div>';
      p.querySelectorAll('button').forEach(x => { if (!x.className) x.className = 'btn'; });
      p.querySelectorAll('[style*="color:#9"],[style*="color:#a"]').forEach(x => { x.style.color = ''; x.classList.add('muted'); });
      const hd = document.createElement('h2'); hd.textContent = 'Desktop app'; hd.style.cssText = 'margin:18px 0 0;padding-top:12px;border-top:1px solid var(--line)';
      host.appendChild(hd); host.appendChild(p); b.remove();
      /* the app and update section goes first in Settings */
      { const top = p.querySelector('.set-sec'), intro = host.querySelector(':scope > p'); if (top && intro) { top.id = 'bdl-top'; css.textContent += '#bdl-top button{margin:3px 6px 3px 0}'; intro.after(top); } }
    } else { document.body.appendChild(css); document.body.appendChild(b); document.body.appendChild(p); }
    const $ = id => document.getElementById(id), say = t => { $('bdl-s').textContent = t; };
    if (!host) b.onclick = () => { p.style.display = p.style.display === 'block' ? 'none' : 'block'; $('bdl-k').value = getKey(); $('bdl-m').value = getModel(); };
    if (host) { $('bdl-k').value = getKey(); $('bdl-m').value = getModel(); }
    $('bdl-u').onclick = () => checkUpdate(say);
    $('bdl-ks').onclick = () => { try { localStorage.setItem(KEY_LS, $('bdl-k').value.trim()); localStorage.setItem(MODEL_LS, $('bdl-m').value.trim() || DEFAULT_MODEL); say('Saved on this computer only.'); } catch (e) { say('Could not save: ' + e.message); } };
    $('bdl-ex').onclick = async () => { try { const j = await dump(); await downloads.save({ filename: 'battle-drill-backup-' + new Date().toISOString().slice(0, 10) + '.json', data: JSON.stringify(j) }); say('Backup downloaded.'); } catch (e) { say('Backup failed: ' + e.message); } };
    $('bdl-im').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json'; i.onchange = async () => { try { await restore(JSON.parse(await i.files[0].text())); say('Restored. Reloading…'); setTimeout(() => location.reload(), 800); } catch (e) { say('Restore failed: ' + e.message); } }; i.click(); };
    const M = () => window.BDModels, mstat = () => { const m = M(); $('bdl-ms').textContent = m && m.count() ? m.count() + ' models loaded: ' + Object.entries(m.factions()).sort().map(([k, v]) => k + ' ' + v).join(', ') + '.' : 'No models imported yet.'; try { hstat(); } catch (e) { } };
    const mfx = () => { try { document.dispatchEvent(new Event('bd-models-changed')); window.dispatchEvent(new Event('bd-models-changed')); } catch (e) { } };
    setTimeout(async () => { if (M()) { await M().load(); mstat(); $('bdl-mo').checked = M().get('on', '1') === '1'; $('bdl-mm').checked = M().get('mirror', '1') === '1'; $('bdl-mk').checked = M().get('khfix', '1') === '1'; $('bdl-my').value = M().get('yaw', '0'); $('bdl-mq').value = M().get('q', '1'); $('bdl-mh').value = M().get('hiq', 'hi'); $('bdl-mb').checked = M().get('hiBattle', '1') === '1'; hstat(); mfx(); } }, 0);
    $('bdl-mo').onchange = () => { M().set('on', $('bdl-mo').checked ? '1' : '0'); mfx(); };
    $('bdl-mk').onchange = async () => { M().set('khfix', $('bdl-mk').checked ? '1' : '0'); await M().reprep(); mfx(); };
    $('bdl-mm').onchange = async () => { M().set('mirror', $('bdl-mm').checked ? '1' : '0'); await M().reprep(); mfx(); };
    $('bdl-my').onchange = async () => { M().set('yaw', $('bdl-my').value); await M().reprep(); mfx(); };
    const hstat = () => { const m = M(); if (!m) return; const n = m.hiCount ? m.hiCount() : 0; $('bdl-mhs').textContent = n ? n + ' models have a high-detail copy (about ' + Math.round(m.hiTris() / 1000) + 'k triangles in total).' : 'No high-detail copies yet. Pick a level above, then import your models again.'; };
    $('bdl-mq').onchange = () => M().set('q', $('bdl-mq').value);
    $('bdl-mh').onchange = () => M().set('hiq', $('bdl-mh').value);
    $('bdl-mb').onchange = () => { M().set('hiBattle', $('bdl-mb').checked ? '1' : '0'); mfx(); };
    $('bdl-mx').onclick = async () => { await M().clearAll(); mstat(); mfx(); say('Models removed.'); };
    $('bdl-mi').onclick = () => {
      const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.setAttribute('webkitdirectory', ''); i.onchange = async () => {
        if (!i.files.length) return; const box = $('bdl-mf'); box.textContent = 'Reading folder…';
        let sc; try { sc = await M().scan(i.files); } catch (e) { box.textContent = ''; say('Import failed: ' + ((e && e.message) || e)); return; }
        const have = M().factions();
        box.innerHTML = '<div style="margin:4px 0"><a href="#" id="bdl-fa">all</a> · <a href="#" id="bdl-fn">none</a></div>' + sc.factions.map((f, k) => '<label style="display:block"><input type="checkbox" data-k="' + k + '"' + (have[f.name] ? '' : ' checked') + '> ' + f.name + ' <span style="color:#999">(' + f.count + (have[f.name] ? ', imported' : '') + ')</span></label>').join('') + '<button id="bdl-fg" style="margin-top:6px">Import selected</button>';
        const cbs = () => [...box.querySelectorAll('input[data-k]')];
        $('bdl-fa').onclick = e => { e.preventDefault(); cbs().forEach(c => c.checked = true); }; $('bdl-fn').onclick = e => { e.preventDefault(); cbs().forEach(c => c.checked = false); };
        $('bdl-fg').onclick = async () => {
          const names = cbs().filter(c => c.checked).map(c => sc.factions[+c.dataset.k].name); if (!names.length) return;
          const q = $('bdl-mq').value, t0 = Date.now(); $('bdl-fg').disabled = true;
          try { const r = await M().importFactions(sc, names, q === 'full' ? { full: true, hi: $('bdl-mh').value } : { scale: +q, hi: $('bdl-mh').value }, t => { $('bdl-ms').textContent = t; }); box.textContent = ''; const fl = Object.entries(r.why || {}).flatMap(([f, l]) => l.map(x => f + ' - ' + x)); if (fl.length) { const dt = document.createElement('details'), sm = document.createElement('summary'), pr = document.createElement('pre'); sm.textContent = 'Show all ' + fl.length + ' skipped'; pr.style.cssText = 'white-space:pre-wrap;font-size:11px;max-height:220px;overflow:auto;user-select:text'; pr.textContent = fl.join('\n'); dt.append(sm, pr); box.appendChild(dt); } mstat(); mfx(); say('Imported ' + r.ok + ' models' + (r.bad ? ' (' + r.bad + ' skipped, e.g. ' + Object.values(r.why).flat().slice(0, 3).join('; ') + ')' : '') + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s.'); }
          catch (e) { say('Import failed: ' + ((e && e.message) || e)); mstat(); $('bdl-fg').disabled = false; }
        };
      }; i.click();
    };
    $('bdl-f').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => { }); };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', menu); else menu();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });

  /* ---------- local helper (Battle Drill.cmd): one-click Wahapedia update ---------- */
  (function () {
    const H = 'http://127.0.0.1:47811';
    const j = async (p, o) => { const r = await fetch(H + p, Object.assign({ cache: 'no-store' }, o)); if (!r.ok) throw new Error('helper ' + r.status); return r; };
    let up = false;
    const say = t => { const e = document.getElementById('bdl-whs'); if (e) e.textContent = t; };
    async function ping() { try { await j('/ping'); up = true; } catch (e) { up = false; } return up; }
    async function run(btn) {
      btn.disabled = true;
      try {
        if (!(await ping())) { say('The helper is not running. Open Battle Drill with the "Battle Drill" shortcut in your Battle Drill folder.'); return; }
        say('Downloading from Wahapedia…');
        const u = await (await j('/datasheets/update', { method: 'POST' })).json();
        if (!u.ok) { say('Wahapedia gave nothing back. Try again later.'); return; }
        const list = (await (await j('/datasheets')).json()).files, dt = new DataTransfer();
        for (const f of list) { const b = await (await j('/datasheets/file/' + encodeURIComponent(f.name))).blob(); dt.items.add(new File([b], f.name, { type: 'text/csv' })); }
        const inp = document.getElementById('wh-files'); if (!inp) { say('Open the datasheet import screen first.'); return; }
        inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
        say((u.changed ? 'New data found: ' : 'No changes since last time: ') + u.got.length + ' tables' + (u.skipped.length ? ' (' + u.skipped.length + ' not published)' : '') + '. Importing…');
      } catch (e) { say('Update failed: ' + ((e && e.message) || e)); }
      finally { btn.disabled = false; }
    }
    function mount() {
      const inp = document.getElementById('wh-files'); if (!inp || document.getElementById('bdl-wh')) return;
      const row = inp.closest('.row') || inp.parentElement.parentElement; if (!row) return;
      const b = document.createElement('button'); b.type = 'button'; b.id = 'bdl-wh'; b.className = 'btn primary'; b.textContent = 'Update from Wahapedia';
      const sp = document.createElement('span'); sp.id = 'bdl-whs'; sp.style.cssText = 'font-size:12px;opacity:.8';
      b.onclick = () => run(b); row.insertBefore(b, row.firstChild); row.appendChild(sp);
      ping().then(ok => say(ok ? 'Helper connected.' : ''));
    }
    setInterval(mount, 2000);
    ping().then(() => setInterval(() => ping(), 60000));
  })();
})();
