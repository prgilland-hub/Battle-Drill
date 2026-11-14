# Battle Drill

Warhammer 40,000 practice app: solo battles, calculators and army builder. Runs as an installable web app (PWA).

## Install on Windows (Chrome or Edge)
1. Open the app's GitHub Pages address in Chrome or Edge.
2. Click the install icon in the address bar (or menu > Cast, save and share > Install page as app).
3. Launch "Battle Drill" from the Start menu. It opens full screen. Press F11 to leave full screen.

## In the app: the gear at bottom-left
- **Check for update**: downloads the newest version from this site and installs it (checksum verified).
- **Coach**: paste your Anthropic API key. It is stored only in this browser, on your PC, and sent only to api.anthropic.com.
- **Back up / restore**: your armies, library and settings live in this browser's storage. Back them up before clearing browser data.

## For the maker
`python3 tools/build.py /path/to/app.html` writes `index.html` and `version.json`. Commit and push both; installed copies pick the update up when you press Check for update.
