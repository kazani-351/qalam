# Qalam

Hand-rebuilt design study of wordgard.net. Static HTML/CSS + ES modules, **no build step, no framework** — keep it that way.

- SPEC.md defines done. Verify against its acceptance criteria (§9), not vibes.
- Never copy original assets or copy text from wordgard.net (no license). Layout/structure only; all art is our own SVG.
- Editor: `wordgard@0.1.0` modules copied into `./modules/`, wired via import map in index.html. Don't add a bundler.
- localStorage key is versioned (`qalam-doc-vN`) — bump N whenever the seed doc changes.
- Git identity: kazani <kazani-351@users.noreply.github.com>. Public repo. Never push without explicit user OK.
- NOTES.md is gitignored (write-up raw material, personal).
