// Lettering styles for the names printed on top of maps: a library of looks, drawn as vector shapes + text (never AI-painted).
// Pure data and SVG strings — the browser editor and the server (resvg) draw the same thing.
// Fonts: every font id below is a file `assets/fonts/<id>.ttf` whose family name is "PNP <id>" (see FONT_FAMILY).

type Kind = 'pips' | 'inkmap' | 'halo' | 'rect' | 'cut' | 'skew' | 'pixel' | 'brackets' | 'tape' | 'seal' | 'double' | 'bar' | 'blueprint' | 'stencil' | 'stone' | 'banner';
type Deco = 'wave' | 'rivets' | 'hazard' | 'drips' | 'moss' | 'tag' | 'paw' | 'squiggle' | 'flourish';

export interface LabelStyleDef {
  id: string;
  name: string;
  /** which kind of campaign it is for */
  setting: string;
  kind: Kind;
  font: string;
  /** font size relative to the map's base lettering size */
  size: number;
  caps?: boolean;
  /** letter spacing in em */
  tracking: number;
  ink: string;
  /** outline around the letters (without a plate): colour + width in em */
  halo?: [string, number];
  fill?: string;
  stroke?: string;
  strokeW?: number;
  /** second colour: inner rules, trim, seal, accents */
  accent?: string;
  /** hard offset shadow behind the plate: colour (offset = 0.14em) */
  shadow?: string;
  padX: number;
  padY: number;
  deco?: Deco[];
  /** generated material (assets/labels/<id>.jpg) laid over the plate when present */
  texture?: string;
  /** darkens the material under the lettering (0..1) when it has pale patches */
  texShade?: number;
  /** extra space between words, in em (scripts with very tight word spaces) */
  wordGap?: number;
  /** hand-drawn feel: every letter sits a little off its baseline and leans a little (fraction of the font size) */
  wobble?: number;
  /** plate colours to choose from, by the name (a different paper for every name) */
  palette?: string[];
}

export const DEFAULT_LABEL_STYLE = 'plain-light';

const STYLES: LabelStyleDef[] = [
  { id: 'plain-light', name: 'Plain · light text', setting: 'any setting, any picture', kind: 'halo', font: 'barlow', size: 1, tracking: 0.04, ink: '#ffffff', halo: ['#101319', 0.2], padX: 0.15, padY: 0.1 },
  { id: 'plain-dark', name: 'Plain · dark text', setting: 'any setting, light pictures', kind: 'halo', font: 'barlow', size: 1, tracking: 0.04, ink: '#14161c', halo: ['#f6f3ea', 0.2], padX: 0.15, padY: 0.1 },

  { id: 'noir', name: 'Neo-Noir', setting: 'near-future, cyber, thrillers', kind: 'cut', font: 'bebas', size: 1.15, caps: true, tracking: 0.08, ink: '#e6eaf0', fill: '#0b0c10', stroke: '#00e5ff', strokeW: 0.07, shadow: '#ffb800', padX: 0.55, padY: 0.3, accent: '#00e5ff' },
  { id: 'terminal', name: 'Terminal', setting: 'hacking, sci-fi stations, bunkers', kind: 'brackets', font: 'vt323', size: 1.35, caps: true, tracking: 0.04, ink: '#bfe9d6', fill: '#030605', stroke: '#29e0a0', strokeW: 0.06, padX: 0.5, padY: 0.2, accent: '#29e0a0' },
  { id: 'cyberdeck', name: 'Cyberdeck', setting: 'cyberpunk, megacities', kind: 'cut', font: 'tektur', size: 1, caps: true, tracking: 0.1, ink: '#e9e6ff', fill: '#07061a', stroke: '#ff2bd6', strokeW: 0.08, shadow: '#19e9ff', padX: 0.6, padY: 0.32, accent: '#19e9ff' },
  { id: 'filmnoir', name: 'Film Noir', setting: 'crime, detectives, black and white', kind: 'rect', font: 'bigshoulders', size: 1.2, caps: true, tracking: 0.06, ink: '#ffffff', fill: '#000000', stroke: '#f2f2f2', strokeW: 0.05, shadow: '#ec1c24', padX: 0.5, padY: 0.2, accent: '#f2f2f2' },
  { id: 'wushu', name: 'Wushu', setting: 'martial arts, wuxia, ancient east', kind: 'seal', font: 'notoserif', size: 1.05, tracking: 0.1, ink: '#261f17', fill: '#e8dec6', stroke: '#261f17', strokeW: 0.07, padX: 0.5, padY: 0.28, accent: '#b9301d' , texture: 'wushu' },
  { id: '8bit', name: '8-Bit', setting: 'retro games, arcade, pixel worlds', kind: 'pixel', font: 'silkscreen', size: 0.95, caps: true, tracking: 0.04, ink: '#f4f4f4', fill: '#1a1c2c', stroke: '#ffcd75', strokeW: 0.1, shadow: '#41a6f6', padX: 0.5, padY: 0.3, accent: '#ffcd75' },
  { id: 'manga', name: 'Manga', setting: 'anime, shonen, comic action', kind: 'skew', font: 'bangers', size: 1.3, tracking: 0.05, ink: '#121216', fill: '#f1eee6', stroke: '#121216', strokeW: 0.1, shadow: '#ffd400', padX: 0.6, padY: 0.2, accent: '#b84a00' },
  { id: 'western', name: 'Western', setting: 'wild west, frontier, saloons', kind: 'double', font: 'rye', size: 1, caps: true, tracking: 0.05, ink: '#ecdcb9', fill: '#170f0a', stroke: '#dba94a', strokeW: 0.06, padX: 0.7, padY: 0.32, accent: '#d2603f' , texture: 'western' , texShade: 0.1 },
  { id: 'ukiyo', name: 'Ukiyo-e', setting: 'feudal Japan, woodblock prints', kind: 'seal', font: 'shippori', size: 1.05, tracking: 0.08, ink: '#f3e9d2', fill: '#0e2135', stroke: '#e8c26a', strokeW: 0.05, padX: 0.5, padY: 0.28, accent: '#c8372d' , texture: 'ukiyo' , texShade: 0.3 },
  { id: 'casefile', name: 'Case file', setting: 'investigation, 1920s–70s, mystery', kind: 'tape', font: 'specialelite', size: 1, caps: true, tracking: 0.06, ink: '#1d1a14', fill: '#e6d8b3', stroke: '#b3202a', strokeW: 0.05, padX: 0.6, padY: 0.28, accent: '#b3202a' , texture: 'casefile' },

  { id: 'pips', name: 'Pips & Paws', setting: 'cozy, cute, mouse and animal tales, storybooks', kind: 'pips', font: 'caveat', size: 1.45, tracking: 0.01, ink: '#241e13', fill: '#fdf9ee', stroke: '#241e13', strokeW: 0.1, padX: 0.55, padY: 0.12, deco: ['paw', 'squiggle'], accent: '#5b5136', wobble: 0.04, palette: ['#cdd6ad', '#bfcfda', '#f1c3b8', '#f3dc9c', '#d9cbe4'] },
  { id: 'inkmap', name: 'Cartographer’s ink', setting: 'hand-drawn maps, fantasy atlases, any world', kind: 'inkmap', font: 'cherish', size: 1.95, tracking: 0, ink: '#24170c', halo: ['#f6eeda', 0.075], deco: ['flourish'], accent: '#4a3622', padX: 0.2, padY: 0.06 },
  { id: 'grimoire', name: 'Grimoire', setting: 'gothic horror, vampires, curses', kind: 'bar', font: 'pirata', size: 1.45, tracking: 0.04, ink: '#b3141b', fill: '#1b0b0f', stroke: '#cdbf9f', strokeW: 0.05, padX: 0.95, padY: 0.3, deco: ['drips'], accent: '#5a0a10', texture: 'grimoire' },
  { id: 'seachart', name: 'Sea chart', setting: 'pirates, seafaring, exploration', kind: 'halo', font: 'imfellit', size: 1.3, tracking: 0.02, ink: '#2b2118', halo: ['#f4ecd6', 0.16], deco: ['wave'], padX: 0.2, padY: 0.1, accent: '#2b2118' },
  { id: 'blueprint', name: 'Blueprint', setting: 'sci-fi, heists, ships, building plans', kind: 'blueprint', font: 'sharetech', size: 1, caps: true, tracking: 0.1, ink: '#ffffff', fill: '#1d4f8f', stroke: '#ffffff', strokeW: 0.05, padX: 0.55, padY: 0.28, deco: ['tag'], accent: '#cfe1fb' , texture: 'blueprint' },
  { id: 'wasteland', name: 'Wasteland', setting: 'post-apocalypse, road warriors', kind: 'stencil', font: 'stardos', size: 1.15, caps: true, tracking: 0.08, ink: '#ecd9a0', fill: '#7a3b1d', stroke: '#2a160b', strokeW: 0.1, padX: 0.7, padY: 0.3, deco: ['rivets', 'hazard'], accent: '#e8c21a', texture: 'wasteland' , texShade: 0.18 },
  { id: 'runestone', name: 'Runestone', setting: 'dark fantasy, Norse, ancient ruins', kind: 'stone', font: 'uncial', size: 1.2, tracking: 0.02, ink: '#202220', fill: '#8f918d', stroke: '#5d5f5b', strokeW: 0.12, padX: 0.75, padY: 0.32, deco: ['moss'], accent: '#5f8a3c', texture: 'runestone' , texShade: 0.12 },
  { id: 'banner', name: 'Banner', setting: 'high fantasy, kingdoms, orders, cities', kind: 'banner', font: 'cinzeldeco', size: 1.05, tracking: 0.04, ink: '#e9c95c', fill: '#1f3a6b', stroke: '#d4a537', strokeW: 0.07, padX: 0.7, padY: 0.38, accent: '#5a3a1c', texture: 'banner' },
];

/** The library as one list: the two plain styles first, then every look by name. */
export const LABEL_STYLES: LabelStyleDef[] = [...STYLES.slice(0, 2), ...STYLES.slice(2).sort((a, b) => a.name.localeCompare(b.name))];

export const labelStyle = (id?: string): LabelStyleDef => LABEL_STYLES.find((s) => s.id === id) ?? LABEL_STYLES[0];
export const isLabelStyle = (id: string) => LABEL_STYLES.some((s) => s.id === id);

/** Every font file is called <id>.ttf and carries the family name "PNP <id>". */
export const FONT_FAMILY = (id: string) => `PNP ${id}`;
export const LABEL_FONTS = [...new Set(LABEL_STYLES.map((s) => s.font))];
/** Generated materials the styles can use (assets/labels/<id>.jpg); every style also looks right without them. */
export const LABEL_TEXTURES = [...new Set(LABEL_STYLES.map((s) => s.texture).filter((t): t is string => !!t))];

// -------------------------------------------------------------------------------------

/** Width in px of `text` set in font id `font` at `size` px (no letter spacing). The server measures with resvg, the browser with canvas. */
export type Measure = (text: string, font: string, size: number) => number;
export interface LabelCtx {
  measure: Measure;
  /** URL / data URL of a generated material, when there is one */
  texture?: (id: string) => string | undefined;
}

const AVG: Record<string, number> = { caveat: 0.4, cherish: 0.42, barlow: 0.54, bebas: 0.4, vt323: 0.4, tektur: 0.56, bigshoulders: 0.42, notoserif: 0.62, silkscreen: 0.66, bangers: 0.5, rye: 0.68, shippori: 0.62, specialelite: 0.6, pirata: 0.42, imfell: 0.5, imfellit: 0.44, sharetech: 0.54, stardos: 0.6, uncial: 0.6, cinzeldeco: 0.7 };
/** Good-enough width when nothing can measure (tests, very first paint). */
export const estimateWidth: Measure = (text, font, size) => text.length * size * (AVG[font] ?? 0.55);

export interface LabelBox {
  w: number;
  h: number;
  /** the SVG fragment with its top-left corner at x,y */
  draw(x: number, y: number): string;
}

let uid = 0;
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rnd = (seed: number, i: number) => { const x = Math.sin(seed * 0.0001 + i * 12.9898) * 43758.5453; return x - Math.floor(x); };
const f = (n: number) => Math.round(n * 100) / 100;
export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Lay out one name in a style at a font size (px). `maxW` wraps long names onto two lines. */
export function layoutLabel(text: string, styleId: string | undefined, base: number, ctx: LabelCtx, maxW = Infinity): LabelBox {
  const s = labelStyle(styleId);
  const size = base * s.size;
  const raw = (s.caps ? text.toUpperCase() : text).replace(/\s+/g, ' ').trim() || ' ';
  const tr = s.tracking * size;
  const gap = (s.wordGap ?? 0) * size;
  const wid = (t: string) => ctx.measure(t, s.font, size) + tr * Math.max(0, t.length - 1) + gap * (t.split(' ').length - 1);
  let lines = [raw];
  const padW = (s.padX * 2 + (s.kind === 'blueprint' ? 2.9 : 0) + (s.kind === 'seal' ? 1.2 : 0)) * size;
  if (wid(raw) + padW > maxW && raw.includes(' ')) {
    // two lines, split at the space that balances them best
    let best = 0, bestD = Infinity;
    for (let i = 0; i < raw.length; i++) if (raw[i] === ' ') { const d = Math.abs(wid(raw.slice(0, i)) - wid(raw.slice(i + 1))); if (d < bestD) { bestD = d; best = i; } }
    lines = [raw.slice(0, best), raw.slice(best + 1)];
  }
  if (s.kind === 'brackets') { lines = lines.slice(); lines[0] = `[ ${lines[0]}`; lines[lines.length - 1] += ' ]'; }
  const tw = Math.max(...lines.map(wid));
  const lh = size * 1.12;
  const th = lh * lines.length;
  const seed = hash(raw);
  const id = `pl${++uid}`;
  /** a hand-drawn line: each letter a little off the baseline and a little tilted (same for every copy of the line) */
  const shake = (ln: string, li: number) => {
    if (!s.wobble) return '';
    const n = [...ln].length;
    const dys: number[] = [], rots: number[] = [];
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = (rnd(seed + li * 7, i) - 0.5) * 2 * s.wobble * size;
      dys.push(f(t - prev));
      prev = t;
      rots.push(f((rnd(seed + li * 7, i + 211) - 0.5) * 2 * s.wobble * 70));
    }
    return ` dy="${dys.join(' ')}" rotate="${rots.join(' ')}"`;
  };
  const txt = (cx: number, top: number, o: { fill: string; halo?: [string, number]; dx?: number; dy?: number } = { fill: s.ink }) =>
    lines.map((ln, i) => `<text x="${f(cx + (o.dx ?? 0))}" y="${f(top + (o.dy ?? 0) + lh * i + size * 0.84)}"${shake(ln, i)} text-anchor="middle" font-family="${FONT_FAMILY(s.font)}" font-size="${f(size)}" letter-spacing="${f(tr)}"${gap ? ` word-spacing="${f(gap)}"` : ''} fill="${o.fill}"${o.halo ? ` stroke="${o.halo[0]}" stroke-width="${f(o.halo[1] * size * 2)}" stroke-linejoin="round" paint-order="stroke"` : ''}>${escapeXml(ln)}</text>`).join('');
  /** an ink-wobble: displaces what it is applied to by a little noise, like a pen that is not quite steady */
  const wobbleFilter = (fid: string, freq: number, k: number) =>
    `<filter id="${fid}" x="-8%" y="-15%" width="116%" height="135%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed % 97}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${f(size * k)}" xChannelSelector="R" yChannelSelector="G"/></filter>`;
  const pw = tw + s.padX * 2 * size;
  const ph = th + s.padY * 2 * size;
  const sw = (s.strokeW ?? 0.06) * size;
  const stroke = s.stroke ?? s.ink;
  const tex = s.texture ? ctx.texture?.(s.texture) : undefined;
  /** a path filled with the style's colour and, when there is one, its material clipped to the same path */
  const body = (d: string, x: number, y: number, w: number, h: number, fill: string, opts: { stroke?: string; sw?: number } = {}) => {
    const st = opts.stroke ? ` stroke="${opts.stroke}" stroke-width="${f(opts.sw ?? sw)}" stroke-linejoin="round"` : '';
    if (!tex) return `<path d="${d}" fill="${fill}"${st}/>`;
    const shade = s.texShade ? `<path d="${d}" fill="#000" fill-opacity="${s.texShade}"/>` : '';
    return `<path d="${d}" fill="${fill}"/><clipPath id="${id}c"><path d="${d}"/></clipPath><image href="${tex}" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}c)"/>${shade}<path d="${d}" fill="none"${st}/>`;
  };
  const rectD = (x: number, y: number, w: number, h: number, r = 0) => r <= 0 ? `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}z`
    : `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(r)}v${f(h - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(r)}h${f(-(w - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(-r)}v${f(-(h - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(-r)}z`;
  const sh = 0.14 * size;
  const shadowD = (d: (x: number, y: number) => string) => (s.shadow ? `<path d="${d(sh, sh)}" fill="${s.shadow}"/>` : '');
  const extraSh = s.shadow ? sh : 0;

  switch (s.kind) {
    case 'halo': {
      const wave = s.deco?.includes('wave');
      const gap = wave ? size * 0.42 : 0;
      const w = tw + s.padX * 2 * size, h = th + s.padY * 2 * size + gap;
      return {
        w, h,
        draw: (x, y) => {
          const cx = x + w / 2, top = y + s.padY * size;
          let out = txt(cx, top, { fill: s.ink, halo: s.halo });
          if (wave) {
            const wy = top + th + size * 0.12, ww = Math.min(w, tw * 0.9 + size), x0 = cx - ww / 2, n = Math.max(4, Math.round(ww / (size * 0.9)));
            const step = ww / n;
            let d = `M${f(x0)} ${f(wy)}`;
            for (let i = 0; i < n; i++) d += `Q${f(x0 + step * (i + 0.5))} ${f(wy + (i % 2 ? size * 0.2 : -size * 0.2))} ${f(x0 + step * (i + 1))} ${f(wy)}`;
            out += `<path d="${d}" fill="none" stroke="${s.halo?.[0] ?? '#fff'}" stroke-width="${f(size * 0.26)}" stroke-linecap="round" opacity="0.9"/><path d="${d}" fill="none" stroke="${s.accent ?? s.ink}" stroke-width="${f(size * 0.07)}" stroke-linecap="round"/>`;
          }
          return out;
        },
      };
    }
    case 'pips': {
      // Pips & Paws: a wobbly hand-inked card in a pastel paper colour, a hard ink shadow, a paw print and a squiggle under the name
      const paw = s.deco?.includes('paw') ? size * 1.05 : 0;
      const w = pw + paw, h = ph;
      const pal = s.palette ?? [s.fill ?? '#fdf9ee'];
      const paper = pal[seed % pal.length];
      const sd = size * 0.13;
      // corners with unequal round-offs, like the site's cards: big - small - medium - small
      const R = [[0.62, 0.22], [0.2, 0.5], [0.5, 0.2], [0.22, 0.58]].map(([a, b]) => [a * size, b * size]);
      const card = (x: number, y: number) => `M${f(x + R[0][0])} ${f(y)}H${f(x + w - R[1][0])}A${f(R[1][0])} ${f(R[1][1])} 0 0 1 ${f(x + w)} ${f(y + R[1][1])}V${f(y + h - R[2][1])}A${f(R[2][0])} ${f(R[2][1])} 0 0 1 ${f(x + w - R[2][0])} ${f(y + h)}H${f(x + R[3][0])}A${f(R[3][0])} ${f(R[3][1])} 0 0 1 ${f(x)} ${f(y + h - R[3][1])}V${f(y + R[0][1])}A${f(R[0][0])} ${f(R[0][1])} 0 0 1 ${f(x + R[0][0])} ${f(y)}z`;
      const ink = s.stroke ?? '#241e13';
      return {
        w: w + sd, h: h + sd,
        draw: (x, y) => {
          const fid = `${id}w`;
          let o = `<defs>${wobbleFilter(fid, 0.05, 0.14)}</defs><g filter="url(#${fid})">`;
          o += `<path d="${card(x + sd, y + sd)}" fill="${ink}"/>`;
          o += `<path d="${card(x, y)}" fill="${paper}" stroke="${ink}" stroke-width="${f(sw)}" stroke-linejoin="round"/>`;
          if (paw) {
            // a paw: pad + four toes
            const px = x + size * 0.62 + sw, py = y + h / 2 + size * 0.05;
            o += `<ellipse cx="${f(px)}" cy="${f(py + size * 0.14)}" rx="${f(size * 0.2)}" ry="${f(size * 0.16)}" fill="${ink}"/>`;
            for (const [tx, ty, r] of [[-0.27, -0.06, 0.075], [-0.09, -0.24, 0.085], [0.1, -0.24, 0.085], [0.28, -0.06, 0.075]]) o += `<ellipse cx="${f(px + tx * size)}" cy="${f(py + ty * size)}" rx="${f(r * size)}" ry="${f(r * size * 1.2)}" fill="${ink}"/>`;
          }
          if (s.deco?.includes('squiggle')) {
            const wx0 = x + paw + s.padX * size + sw, ww = Math.max(size, tw * 0.75), wy = y + h - size * 0.2 - sw;
            const n = Math.max(3, Math.round(ww / (size * 0.5))), st = ww / n;
            let d = `M${f(x + paw + pw / 2 - ww / 2)} ${f(wy)}`;
            for (let i = 0; i < n; i++) d += `q${f(st / 2)} ${f(i % 2 ? size * 0.12 : -size * 0.12)} ${f(st)} 0`;
            void wx0;
            o += `<path d="${d}" fill="none" stroke="${s.accent}" stroke-width="${f(size * 0.055)}" stroke-linecap="round"/>`;
          }
          o += '</g>';
          return o + txt(x + paw + pw / 2, y + s.padY * size - size * 0.04);
        },
      };
    }
    case 'inkmap': {
      // cartographer's ink: pen-drawn capitals on the map itself (a pale outline keeps them readable), a little flourish below
      const fl = s.deco?.includes('flourish');
      const gap = fl ? size * 0.42 : 0;
      const w = tw + s.padX * 2 * size, h = th + s.padY * 2 * size + gap;
      return {
        w, h,
        draw: (x, y) => {
          const cx = x + w / 2, top = y + s.padY * size;
          let o = '<g>';
          o += txt(cx, top, { fill: s.ink, halo: s.halo });
          if (fl) {
            const fy = top + th + size * 0.14, half = Math.min(tw * 0.5, size * 3.6), ink = s.accent ?? s.ink, dm = size * 0.13;
            // a diamond between two long strokes that curl at their ends and finish in a dot
            const arm = (dir: number) => `M${f(cx + dir * size * 0.28)} ${f(fy)}C${f(cx + dir * half * 0.45)} ${f(fy - size * 0.1)} ${f(cx + dir * half * 0.8)} ${f(fy + size * 0.1)} ${f(cx + dir * half)} ${f(fy - size * 0.02)}q${f(dir * size * 0.14)} ${f(-size * 0.12)} ${f(dir * size * 0.02)} ${f(-size * 0.2)}`;
            o += `<path d="M${f(cx)} ${f(fy - dm)}l${f(dm * 1.3)} ${f(dm)}l${f(-dm * 1.3)} ${f(dm)}l${f(-dm * 1.3)} ${f(-dm)}z" fill="${ink}"/>`;
            o += `<path d="${arm(1)}${arm(-1)}" fill="none" stroke="${ink}" stroke-width="${f(size * 0.075)}" stroke-linecap="round"/>`;
            o += `<circle cx="${f(cx + half + size * 0.16)}" cy="${f(fy - size * 0.22)}" r="${f(size * 0.045)}" fill="${ink}"/><circle cx="${f(cx - half - size * 0.16)}" cy="${f(fy - size * 0.22)}" r="${f(size * 0.045)}" fill="${ink}"/>`;
          }
          return o + '</g>';
        },
      };
    }
    case 'rect': case 'tape': case 'seal': case 'double': case 'brackets': {
      const seal = s.kind === 'seal' ? size * 1.0 : 0;
      const w = pw + seal, h = ph;
      const r = s.kind === 'brackets' || s.kind === 'tape' || s.kind === 'rect' ? 0 : size * 0.12;
      return {
        w: w + extraSh, h: h + extraSh,
        draw: (x, y) => {
          let o = shadowD((dx, dy) => rectD(x + dx, y + dy, w, h, r));
          o += body(rectD(x, y, w, h, r), x, y, w, h, s.fill ?? '#000', { stroke, sw });
          if (s.kind === 'double') {
            const i1 = size * 0.2;
            o += `<path d="${rectD(x + i1, y + i1, w - 2 * i1, h - 2 * i1, 0)}" fill="none" stroke="${stroke}" stroke-width="${f(sw * 0.55)}"/>`;
            const dm = size * 0.16, cy = y + h / 2;
            for (const cx of [x + i1 + size * 0.32, x + w - i1 - size * 0.32]) o += `<path d="M${f(cx)} ${f(cy - dm)}l${f(dm)} ${f(dm)}l${f(-dm)} ${f(dm)}l${f(-dm)} ${f(-dm)}z" fill="${s.accent}"/>`;
          } else if (s.kind === 'tape') {
            const ry = size * 0.14;
            o += `<path d="M${f(x)} ${f(y + ry)}h${f(w)}M${f(x)} ${f(y + h - ry)}h${f(w)}" stroke="${s.accent}" stroke-width="${f(sw * 0.8)}"/>`;
            o += `<circle cx="${f(x + size * 0.28)}" cy="${f(y + h / 2)}" r="${f(size * 0.1)}" fill="#00000033"/><circle cx="${f(x + w - size * 0.28)}" cy="${f(y + h / 2)}" r="${f(size * 0.1)}" fill="#00000033"/>`;
          } else if (s.kind === 'seal') {
            const sz = size * 0.62, sx = x + w - seal * 0.5 - sz / 2 - s.padX * size * 0.3 + size * 0.1, sy = y + h / 2 - sz / 2;
            o += `<rect x="${f(sx)}" y="${f(sy)}" width="${f(sz)}" height="${f(sz)}" fill="${s.accent}"/><path d="M${f(sx + sz * 0.25)} ${f(sy + sz * 0.3)}h${f(sz * 0.5)}M${f(sx + sz * 0.25)} ${f(sy + sz * 0.5)}h${f(sz * 0.5)}M${f(sx + sz * 0.25)} ${f(sy + sz * 0.7)}h${f(sz * 0.3)}" stroke="${s.fill}" stroke-width="${f(sz * 0.1)}"/>`;
          }
          o += txt(x + (w - seal) / 2, y + s.padY * size, { fill: s.ink });
          return o;
        },
      };
    }
    case 'cut': {
      const cs = size * 0.45;
      const poly = (x: number, y: number) => `M${f(x + cs)} ${f(y)}H${f(x + pw)}V${f(y + ph - cs)}L${f(x + pw - cs)} ${f(y + ph)}H${f(x)}V${f(y + cs)}z`;
      return {
        w: pw + extraSh, h: ph + extraSh,
        draw: (x, y) => shadowD((dx, dy) => poly(x + dx, y + dy)) + `<path d="${poly(x, y)}" fill="${s.fill}" stroke="${stroke}" stroke-width="${f(sw)}" stroke-linejoin="miter"/>` + txt(x + pw / 2, y + s.padY * size),
      };
    }
    case 'skew': {
      const k = size * 0.32;
      const poly = (x: number, y: number) => `M${f(x + k)} ${f(y)}H${f(x + pw + k)}L${f(x + pw)} ${f(y + ph)}H${f(x)}z`;
      return {
        w: pw + k + extraSh, h: ph + extraSh,
        draw: (x, y) => shadowD((dx, dy) => poly(x + dx, y + dy)) + `<path d="${poly(x, y)}" fill="${s.fill}" stroke="${stroke}" stroke-width="${f(sw)}" stroke-linejoin="round"/>` + txt(x + pw / 2 + k / 2, y + s.padY * size),
      };
    }
    case 'pixel': {
      const p = size * 0.2;
      const poly = (x: number, y: number) => `M${f(x + p)} ${f(y)}H${f(x + pw - p)}V${f(y + p)}H${f(x + pw)}V${f(y + ph - p)}H${f(x + pw - p)}V${f(y + ph)}H${f(x + p)}V${f(y + ph - p)}H${f(x)}V${f(y + p)}H${f(x + p)}z`;
      return {
        w: pw + extraSh, h: ph + extraSh,
        draw: (x, y) => shadowD((dx, dy) => poly(x + dx, y + dy)) + `<path d="${poly(x, y)}" fill="${s.fill}" stroke="${stroke}" stroke-width="${f(sw)}" stroke-linejoin="miter"/>` + txt(x + pw / 2, y + s.padY * size),
      };
    }
    case 'bar': {
      // grimoire: a ragged strip of dark leather, a bone-coloured inner rule with corner marks, wet blood-red lettering, drips
      const dripMax = size * 0.95;
      const amp = size * 0.07, step = size * 0.5;
      const ragged = (x: number, y: number) => {
        const nx = Math.max(4, Math.round(pw / step));
        const P: string[] = [];
        for (let i = 0; i <= nx; i++) P.push(`${f(x + (pw * i) / nx)} ${f(y + (i === 0 || i === nx ? 0 : (rnd(seed, i) - 0.3) * amp * 2))}`);
        for (let i = nx; i >= 0; i--) P.push(`${f(x + (pw * i) / nx + (i === 0 || i === nx ? (i ? 1 : -1) * amp * (0.5 + rnd(seed, 70 + i)) : 0))} ${f(y + ph + (i === 0 || i === nx ? 0 : (rnd(seed, 30 + i) - 0.3) * amp * 2))}`);
        return 'M' + P.join('L') + 'z';
      };
      return {
        w: pw, h: ph + dripMax,
        draw: (x, y) => {
          const g1 = `${id}g`, g2 = `${id}v`;
          let o = `<defs><radialGradient id="${g2}" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.65"/></radialGradient><linearGradient id="${g1}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0504a" stop-opacity="0.38"/><stop offset="0.55" stop-color="#e0504a" stop-opacity="0"/></linearGradient></defs>`;
          const d = ragged(x, y);
          o += body(d, x, y, pw, ph, s.fill ?? '#000', { stroke: '#000', sw: sw * 0.8 });
          o += `<path d="${d}" fill="url(#${g2})"/>`;
          // inner rule with an L-mark and a dot in every corner
          const i1 = size * 0.24, mk = size * 0.34, rr = s.stroke ?? '#cdbf9f';
          o += `<path d="${rectD(x + i1, y + i1, pw - 2 * i1, ph - 2 * i1)}" fill="none" stroke="${rr}" stroke-opacity="0.55" stroke-width="${f(size * 0.03)}"/>`;
          for (const [cx, cy, sx, sy] of [[x + i1, y + i1, 1, 1], [x + pw - i1, y + i1, -1, 1], [x + i1, y + ph - i1, 1, -1], [x + pw - i1, y + ph - i1, -1, -1]] as const) {
            o += `<path d="M${f(cx + sx * mk)} ${f(cy)}H${f(cx)}V${f(cy + sy * mk)}" fill="none" stroke="${rr}" stroke-opacity="0.9" stroke-width="${f(size * 0.06)}" stroke-linecap="square"/><circle cx="${f(cx + sx * size * 0.12)}" cy="${f(cy + sy * size * 0.12)}" r="${f(size * 0.05)}" fill="${rr}"/>`;
          }
          const cx = x + pw / 2, top = y + s.padY * size;
          // lettering: dark cut underneath, blood red, a wet highlight on its upper edge
          o += txt(cx, top, { fill: '#000000', dx: size * 0.05, dy: size * 0.07 });
          o += txt(cx, top, { fill: s.ink });
          o += `<g opacity="0.8">${txt(cx, top, { fill: `url(#${g1})` })}</g>`;
          if (s.deco?.includes('drips')) {
            const n = Math.max(3, Math.round(pw / (size * 2.2)));
            for (let i = 0; i < n; i++) {
              const dx = x + pw * ((i + 0.5 + (rnd(seed, i + 3) - 0.5) * 0.7) / n);
              const len = size * (0.3 + rnd(seed, i + 9) * 0.55), r = size * (0.075 + rnd(seed, i + 19) * 0.05), by = y + ph + amp;
              // a tapered run that swells into a drop
              o += `<path d="M${f(dx - r * 1.2)} ${f(by - size * 0.1)}Q${f(dx - r * 0.35)} ${f(by + len * 0.5)} ${f(dx - r)} ${f(by + len)}a${f(r)} ${f(r * 1.15)} 0 0 0 ${f(r * 2)} 0Q${f(dx + r * 0.35)} ${f(by + len * 0.5)} ${f(dx + r * 1.2)} ${f(by - size * 0.1)}z" fill="${s.accent}"/>`;
              o += `<ellipse cx="${f(dx - r * 0.3)}" cy="${f(by + len + r * 0.1)}" rx="${f(r * 0.25)}" ry="${f(r * 0.4)}" fill="#a02a30" opacity="0.5"/>`;
            }
            // a few splashes
            for (let i = 0; i < 3; i++) o += `<circle cx="${f(x + pw * (0.1 + rnd(seed, 50 + i) * 0.8))}" cy="${f(y + ph + size * (0.25 + rnd(seed, 60 + i) * 0.55))}" r="${f(size * (0.025 + rnd(seed, 66 + i) * 0.03))}" fill="${s.accent}" opacity="0.85"/>`;
          }
          return o;
        },
      };
    }
    case 'blueprint': {
      const tick = size * 1.35, tagH = size * 0.55;
      const w = pw + tick * 2, h = ph + tagH;
      const tag = `${String.fromCharCode(65 + (seed % 6))}-${String(1 + ((seed >> 4) % 24)).padStart(2, '0')}`;
      return {
        w, h,
        draw: (x, y) => {
          const bx = x + tick, by = y + tagH, cy = by + ph / 2, a = size * 0.28;
          let o = body(rectD(bx, by, pw, ph), bx, by, pw, ph, s.fill ?? '#1d4f8f', { stroke, sw });
          o += `<path d="M${f(x)} ${f(cy - a)}V${f(cy + a)}M${f(x)} ${f(cy)}H${f(bx)}M${f(x + w)} ${f(cy - a)}V${f(cy + a)}M${f(x + w)} ${f(cy)}H${f(bx + pw)}" stroke="${stroke}" stroke-width="${f(sw * 0.8)}" fill="none"/>`;
          o += `<path d="M${f(x + a * 1.6)} ${f(cy - a * 0.55)}L${f(x)} ${f(cy)}L${f(x + a * 1.6)} ${f(cy + a * 0.55)}M${f(x + w - a * 1.6)} ${f(cy - a * 0.55)}L${f(x + w)} ${f(cy)}L${f(x + w - a * 1.6)} ${f(cy + a * 0.55)}" stroke="${stroke}" stroke-width="${f(sw * 0.8)}" fill="none"/>`;
          if (s.deco?.includes('tag')) o += `<rect x="${f(bx + pw - size * 2.15)}" y="${f(by - tagH * 0.55)}" width="${f(size * 2.0)}" height="${f(tagH * 0.95)}" fill="${s.fill}" stroke="${stroke}" stroke-width="${f(sw * 0.7)}"/><text x="${f(bx + pw - size * 1.15)}" y="${f(by - tagH * 0.55 + tagH * 0.72)}" text-anchor="middle" font-family="${FONT_FAMILY(s.font)}" font-size="${f(size * 0.52)}" fill="${s.accent}">${tag}</text>`;
          return o + txt(bx + pw / 2, by + s.padY * size);
        },
      };
    }
    case 'stencil': {
      const hz = size * 0.42;
      const w = pw, h = ph + (s.deco?.includes('hazard') ? hz : 0);
      return {
        w, h,
        draw: (x, y) => {
          let o = '';
          if (s.deco?.includes('hazard')) {
            const hid = `${id}h`;
            o += `<defs><pattern id="${hid}" width="${f(size * 0.8)}" height="${f(size * 0.8)}" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="${f(size * 0.4)}" height="${f(size * 0.8)}" fill="${s.accent}"/><rect x="${f(size * 0.4)}" width="${f(size * 0.4)}" height="${f(size * 0.8)}" fill="#1b1a18"/></pattern></defs><rect x="${f(x)}" y="${f(y + ph)}" width="${f(w)}" height="${f(hz)}" fill="url(#${hid})" stroke="${stroke}" stroke-width="${f(sw * 0.6)}"/>`;
          }
          o += body(rectD(x, y, pw, ph, size * 0.06), x, y, pw, ph, s.fill ?? '#000', { stroke, sw });
          if (s.deco?.includes('rivets')) {
            const r = size * 0.1, m = size * 0.26;
            for (const [rx, ry] of [[x + m, y + m], [x + pw - m, y + m], [x + m, y + ph - m], [x + pw - m, y + ph - m]]) o += `<circle cx="${f(rx)}" cy="${f(ry)}" r="${f(r)}" fill="#2a160b"/><circle cx="${f(rx - r * 0.3)}" cy="${f(ry - r * 0.3)}" r="${f(r * 0.35)}" fill="#b98a5a"/>`;
          }
          return o + txt(x + pw / 2, y + s.padY * size, { fill: '#2a160b', dx: size * 0.06, dy: size * 0.07 }) + txt(x + pw / 2, y + s.padY * size);
        },
      };
    }
    case 'stone': {
      const j = size * 0.16;
      const pts = (x: number, y: number) => {
        const P: [number, number][] = [];
        const nx = Math.max(3, Math.round(pw / (size * 1.6))), ny = 2;
        for (let i = 0; i <= nx; i++) P.push([x + (pw * i) / nx, y + (i === 0 || i === nx ? 0 : rnd(seed, i) * j)]);
        for (let i = 1; i <= ny; i++) P.push([x + pw - (i === ny ? 0 : rnd(seed, 40 + i) * j * 0.5), y + (ph * i) / ny]);
        for (let i = nx - 1; i >= 0; i--) P.push([x + (pw * i) / nx, y + ph - (i === 0 || i === nx ? 0 : rnd(seed, 80 + i) * j)]);
        P.push([x + rnd(seed, 120) * j * 0.5, y + ph / 2]);
        return P;
      };
      const path = (x: number, y: number) => 'M' + pts(x, y).map((p) => `${f(p[0])} ${f(p[1])}`).join('L') + 'z';
      const light = '#e4e6e1', dark = '#161715';
      return {
        w: pw, h: ph,
        draw: (x, y) => {
          let o = body(path(x, y), x, y, pw, ph, s.fill ?? '#999', { stroke, sw });
          o += `<path d="M${f(x + pw * 0.62)} ${f(y)}l${f(-size * 0.2)} ${f(ph * 0.35)}l${f(size * 0.16)} ${f(ph * 0.2)}l${f(-size * 0.12)} ${f(ph * 0.3)}" fill="none" stroke="${dark}" stroke-width="${f(size * 0.045)}" opacity="0.55"/>`;
          if (s.deco?.includes('moss')) {
            const g = s.accent ?? '#5f8a3c';
            o += `<path d="M${f(x + pw * 0.08)} ${f(y + sw)}q${f(size * 0.4)} ${f(size * 0.55)} ${f(size * 0.9)} ${f(size * 0.05)}q${f(-size * 0.4)} ${f(-size * 0.2)} ${f(-size * 0.9)} ${f(-size * 0.05)}z" fill="${g}" opacity="0.9"/><path d="M${f(x + pw * 0.78)} ${f(y + ph - sw)}q${f(size * 0.3)} ${f(-size * 0.4)} ${f(size * 0.7)} ${f(-size * 0.02)}q${f(-size * 0.3)} ${f(size * 0.2)} ${f(-size * 0.7)} ${f(size * 0.02)}z" fill="${g}" opacity="0.85"/>`;
          }
          const cx = x + pw / 2, top = y + s.padY * size, e = size * 0.045;
          return o + txt(cx, top, { fill: light, dx: e, dy: e }) + txt(cx, top, { fill: dark, dx: -e, dy: -e }) + txt(cx, top, { fill: s.ink });
        },
      };
    }
    case 'banner': {
      const tail = size * 0.6, poleH = size * 0.26, over = size * 0.45;
      const cw = pw, ch = ph + tail + size * 0.14;
      const w = cw + over * 2, h = poleH + ch;
      return {
        w, h,
        draw: (x, y) => {
          const cx0 = x + over, cy0 = y + poleH * 0.55;
          const cloth = (ix: number, iy: number, iw: number, ih: number) => `M${f(ix)} ${f(iy)}H${f(ix + iw)}V${f(iy + ih)}L${f(ix + iw / 2)} ${f(iy + ih - tail)}L${f(ix)} ${f(iy + ih)}z`;
          let o = `<rect x="${f(x + size * 0.2)}" y="${f(y)}" width="${f(w - size * 0.4)}" height="${f(poleH)}" rx="${f(poleH / 2)}" fill="${s.accent}" stroke="#2a1a0c" stroke-width="${f(size * 0.03)}"/>`;
          o += `<circle cx="${f(x + size * 0.2)}" cy="${f(y + poleH / 2)}" r="${f(poleH * 0.8)}" fill="${s.stroke}"/><circle cx="${f(x + w - size * 0.2)}" cy="${f(y + poleH / 2)}" r="${f(poleH * 0.8)}" fill="${s.stroke}"/>`;
          o += body(cloth(cx0, cy0, cw, ch), cx0, cy0, cw, ch, s.fill ?? '#223', { stroke, sw });
          const i = size * 0.16;
          o += `<path d="${cloth(cx0 + i, cy0 + i, cw - 2 * i, ch - 2 * i - 0)}" fill="none" stroke="${stroke}" stroke-width="${f(sw * 0.45)}"/>`;
          return o + txt(cx0 + cw / 2, cy0 + s.padY * size + size * 0.1, { fill: '#0d1b38', dx: size * 0.05, dy: size * 0.06 }) + txt(cx0 + cw / 2, cy0 + s.padY * size + size * 0.1);
        },
      };
    }
  }
}
