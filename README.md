# Qalam

*Qalam* (qalam, قلم, pen) is a hand-rebuilt design study of
[wordgard.net](https://wordgard.net), the home of Marijn Haverbeke's
Wordgard rich-text editor library. Same bones and rhythm as the
original, my own words and art, and a live editor you can actually
write in.

Nothing is copied from wordgard.net: the layout and typographic
system were studied and reimplemented by hand, all art is original
SVG, and all copy is original. The editor itself is the real
[Wordgard](https://wordgard.net) library (MIT license), vendored
unmodified under `modules/`.

## What it is

- Static HTML, CSS, and ES modules. No build step, no framework, no bundler.
- The Wordgard editor wired up via a browser import map (see the
  `<script type="importmap">` in `index.html`).
- Whatever you type in the demo editor is saved to your browser's
  localStorage as you go, and restored when you come back. Nothing
  is sent to a server.

## Run it locally

Any static file server works, since there's no build step:

```
python3 -m http.server 8642
```

Then open `http://localhost:8642/`.

## Test it

There's no test suite (a one-page static site doesn't need one).
To confirm the editor and persistence work:

1. Open the page, click into the editor demo, type something.
2. Reload the page: your text should still be there.
3. Clear `localStorage` for the page and reload: it should fall
   back to the seed copy.

## Structure

```
index.html          the whole page
style/site.css       styles
style/favicon.svg    favicon
style/og.svg / og.png  social share card (og.png is rendered from og.svg)
style/font/          self-hosted Merriweather Bold
modules/             vendored wordgard library + its 3 dependencies (MIT)
```

## License

The page (markup, styles, art, copy) is original work by kazani.
`modules/` vendors the [Wordgard](https://wordgard.net) library,
MIT-licensed; see `modules/LICENSE-wordgard.txt`.
