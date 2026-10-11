# Label fonts

Fonts for the lettering printed on top of maps (`@pnp/shared` `labelstyles.ts`, drawn by the server with resvg and by the
browser editor). Every font is under the SIL Open Font License 1.1 (texts in `licenses/`).

Each file is a Latin subset (Basic Latin, Latin‑1, Latin Extended‑A, common punctuation) whose family name was set to
`PNP <id>` (regular weight) so that SVG text finds it by that one name in resvg and in browsers alike.

| id | family | source |
|---|---|---|
| barlow, bebas, vt323, tektur, bigshoulders, notoserif, silkscreen, bangers, rye, shippori, specialelite | Barlow SemiBold, Bebas Neue, VT323, Tektur Bold, Big Shoulders Black, Noto Serif SC Black, Silkscreen Bold, Bangers, Rye, Shippori Mincho ExtraBold, Special Elite | Google Fonts, taken from the KINETIK VTT theme fonts |
| pirata, imfell, imfellit, sharetech, stardos, uncial, cinzeldeco | Pirata One, IM Fell English (+ Italic), Share Tech Mono, Stardos Stencil Bold, Uncial Antiqua, Cinzel Decorative Bold | Google Fonts (github.com/google/fonts, `ofl/`) |
| caveat, cherish | Caveat Bold (instanced from the variable font), Cherish | Google Fonts (`ofl/caveat`, `ofl/cherish`) |
