#!/usr/bin/env python3
"""Build the installable PWA: python3 tools/build.py /path/to/app.html
Writes index.html (app + desktop shim + manifest link) and version.json (version + sha256)."""
import sys, re, hashlib, json, datetime, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
shim = (root / 'tools' / 'bd-local.js').read_text(encoding='utf-8')
version = (sys.argv[2] if len(sys.argv) > 2 else datetime.datetime.utcnow().strftime('%Y.%m.%d-%H%M'))
shim = shim.replace('__BD_VERSION__', version)
head = '<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#141414"><script>' + shim + '</script>'
assert src.count('<head>') == 1, 'expected one <head>'
out = src.replace('<head>', '<head>' + head, 1)
(root / 'index.html').write_text(out, encoding='utf-8')
sha = hashlib.sha256(out.encode('utf-8')).hexdigest()
(root / 'version.json').write_text(json.dumps({'version': version, 'sha256': sha, 'built': datetime.datetime.utcnow().isoformat() + 'Z'}, indent=1))
print(version, sha[:12], len(out))
