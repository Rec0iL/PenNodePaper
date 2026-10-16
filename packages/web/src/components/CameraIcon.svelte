<script lang="ts">
  // The camera a map is painted with, drawn as a camera that is turned: tilted for the natural painted-map look,
  // pointing straight down for the top-down plan, a satellite for the survey map (the same angle as top-down), and a
  // camera at a free angle with a pencil for the camera the GM describes in their own words.
  let { kind, size = 38 }: { kind: 'default' | 'strict' | 'plan' | 'custom'; size?: number } = $props();

  const ANGLE = { default: 35, strict: 90, custom: -20 } as const;
  const rad = (d: number) => (d * Math.PI) / 180;
  const cam = $derived.by(() => {
    if (kind === 'plan') return null;
    const a = ANGLE[kind];
    const cx = kind === 'default' ? 13 : kind === 'custom' ? 12 : 20;
    const cy = kind === 'default' ? 10 : kind === 'custom' ? 17 : 9;
    const tip = { x: cx + 11 * Math.cos(rad(a)), y: cy + 11 * Math.sin(rad(a)) };
    const ray = (d: number) => ({ x: tip.x + 9 * Math.cos(rad(a + d)), y: tip.y + 9 * Math.sin(rad(a + d)) });
    return { a, cx, cy, tip, rays: [ray(-17), ray(17)] };
  });
</script>

<svg viewBox="0 0 40 32" width={size} height={size * 0.8} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <!-- the ground -->
  <path d={kind === 'custom' ? 'M3 29.5h19' : 'M3 29.5h34'} opacity=".55" />
  {#if cam}
    <g transform={`translate(${cam.cx} ${cam.cy}) rotate(${cam.a})`}>
      <rect x="-8" y="-5" width="13" height="10" rx="2" />
      <path d="M5 -3 L10.5 -5.5 V5.5 L5 3 Z" />
      <path d="M-5 -5 V-7.5 H-1 V-5" />
    </g>
    {#each cam.rays as r}<path d={`M${cam.tip.x.toFixed(1)} ${cam.tip.y.toFixed(1)} L${r.x.toFixed(1)} ${r.y.toFixed(1)}`} stroke-dasharray="2 2.4" opacity=".75" />{/each}
    {#if kind === 'custom'}
      <!-- a pencil: the angle is written by hand -->
      <path d="M25.5 29 l1.3-4.3 8.2-8.2 3 3 -8.2 8.2 z" />
      <path d="M33.1 18.4 l3 3" />
    {/if}
  {:else}
    <!-- satellite: body, two solar panels, dish and the beam down to the ground -->
    <rect x="16" y="4" width="8" height="7" rx="1.5" />
    <rect x="4" y="5.5" width="9.5" height="4" rx=".6" />
    <rect x="26.5" y="5.5" width="9.5" height="4" rx=".6" />
    <path d="M13.5 7.5H16M24 7.5h2.5M8.8 5.5v4M31.2 5.5v4" opacity=".7" />
    <path d="M17 14.5q3 4 6 0" />
    <path d="M20 11v4" />
    <path d="M20 19 L13 29 M20 19 L27 29" stroke-dasharray="2 2.4" opacity=".75" />
  {/if}
</svg>
