# SPEC -- Qalam

One-page static site: a hand-rebuilt **design study of wordgard.net**, branded as **Qalam**, with a live rich-text editor demo. Craft/portfolio piece under the kazani namespace -- stated openly as a study, with credit. (Grill 2026-07-04: "writing tool identity" framing rejected as overclaim.)

## 1. Goal & success criteria

- A live page at `qalam.kazani.workers.dev` that captures the wordgard.net look and feel (crafted, editorial, hand-made) with 100% original assets and copy.
- "Good" = a visitor can type in the editor, reload, and find their text still there; the page reads as a real project page, not a template.
- Done when all acceptance criteria (§9) pass on desktop and mobile viewports.

## 2. Identity

- **Name:** Qalam ("pen" in Urdu/Hindi). Hero renders as a dictionary entry:
  *Qalam [qa-lam] noun -- a pen for cultivating words.*
- **Framing (grilled):** design study, stated. Hero keeps the dictionary-entry charm; the about section says plainly it's a hand-rebuilt study of wordgard.net's design, with a link. No product pretense.
- **Author display:** "kazani" only -- never the real name. Git identity: kazani + noreply email, set before first commit.
- **Companion asset:** BlogChain/Farcaster write-up is a separate follow-up task after ship. During build, keep `NOTES.md` (uncommitted or committed, author's call) logging design observations as raw material.

## 3. Page structure (mirrors original)

1. Header: title art (SVG), nav right-aligned below.
2. Hero: dictionary-entry paragraph.
3. **Live editor demo** (`#editor`): wordgard editor with menubar + history, seeded with a short intro doc. Rounded corners, max-height scroller -- same treatment as original.
4. Ink divider (replaces floral `<hr>`).
5. Features grid: 6–8 cards, honest copy about what the demo actually does (schema-based editing, keyboard-friendly, persistent, no build step, open source, RTL-capable...).
6. Ink divider.
7. About: what Qalam is -- a design study of wordgard.net (credited, linked) -- plus credit to the wordgard library (MIT, linked).
8. Footer: "a design study of wordgard.net · hand-built by kazani", site sources link (GitHub).

**Nav:** Try (anchor to #editor) / About (anchor) / kazani → kazani.pages.dev / Code → GitHub repo (added once pushed).

## 4. Design system

- Headings: Merriweather Bold (self-hosted woff2, Google Fonts download -- OFL license).
- Body: 17px system sans, line-height 1.35.
- Content column: 720px; highlight color: ours, an ink blue-black (exact value at build time; NOT the original's #0662d0 -- small deliberate delta).
- Art: hand-written minimal SVG line art -- pen nib / ink swirl title mark, calligraphic stroke dividers. No raster images, no third-party art.
- Responsive: must work at 375px wide and ~375x400 (keyboard-open) heights.

## 5. Technical architecture

- Static hand-written HTML + CSS + ES modules. No framework, no build step, no bundler.
- Editor: `wordgard@0.1.0` (npm, MIT) -- modules copied into `./modules/` and wired via import map, exactly like the original site does. Config: `fullSchema() + history() + menuBar()`.
- **Persistence (the one functional change):** editor content saved to `localStorage` under versioned key `qalam-doc-v1` (debounced on update), restored on load; falls back to seed doc when empty or on parse failure. Graceful if localStorage unavailable (private mode) -- editor still works, just doesn't persist. Bumping the seed copy bumps the key version.
- Deploy: Cloudflare Pages, project `qalam`, no build command, root output.
- Repo: **public GitHub repo `qalam`** (grilled) -- kazani identity, noreply email, new repo-scoped PAT per token rules. Nav "Code" links here.

## 6. Decisions & rejected options

| Decision | Chosen | Rejected & why |
|---|---|---|
| Purpose | Design study, stated + portfolio | Literal mirror (art/copy not licensed); "writing tool" framing (overclaim, no product); playground-no-origin (silence worse than credit) |
| Write-up | Separate follow-up, NOTES.md during build | In-scope (doubles scope), skip (loses the conversion asset) |
| Repo | Public GitHub `qalam` | Private (hides the craft), no-repo (breaks Code link + Pages pattern) |
| Name | Qalam | Siyahi, Mashq -- user picked Qalam |
| Editor role | Demo block like original | Full writing surface (more scope), decorative (pointless) |
| Functional delta | localStorage persistence only | Export button, extra pages -- scope cut |
| Art | Hand-written SVG line art | Typographic-only (loses charm), generated raster (adds weight/step) |
| Copy | Honest demo features | Aspirational product copy (overclaims), meta/personal copy |
| Stack | Static HTML + import maps | Astro/frameworks -- unjustified for one page |
| Hosting | CF Pages free | -- |

## 7. Out of scope

Docs pages, examples pages, forum/discuss, search, collaborative editing, custom domain, analytics, export/download, any second page.

## 8. Risks & open questions

- `wordgard@0.1.0` is a 0.x release -- API may differ from the site's inline example; verify the import-map wiring against the actual package files during build.
- Merriweather must be self-hosted (verify woff2 renders locally before committing to it -- external-resource rule).
- Licensing: MIT notice for wordgard included in repo + footer credit.

## 9. Acceptance criteria

1. Page renders correctly at 1280px, 375px, and ~375x400 viewports (verified in Claude_Preview, screenshots).
2. Editor is interactive: typing, bold/italic via menubar, undo/redo work.
3. Typed content survives a reload (localStorage); clearing storage restores seed doc.
4. No console errors; no network requests to wordgard.net or any third party (fonts self-hosted).
5. All nav links resolve (no dead links).
6. Zero copied assets: no original art, title image, or copy text present in the repo.
7. README exists (what/run/test) before ship.
