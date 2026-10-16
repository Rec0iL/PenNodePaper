import { imageSize, swapMaskParts, type MapDoc } from '@pnp/shared';
import { imageDimensions, sniffImage } from './imagefile.js';
import { toPng } from './maps.js';

// Bringing an earlier painting of a prop / structure group back: the older picture shows through a soft mask around the group,
// everything else stays as in the latest picture. Done with the renderer that makes the plan pictures, so it needs no ComfyUI.

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

/** The latest picture with the group taken from an older one. Both have to be the size of the map's picture. */
export function composeVariant(m: MapDoc, groupId: string, latest: Buffer, older: Buffer): Buffer {
  const mask = swapMaskParts(m, groupId);
  if (!mask) throw new Error(`This map has no group "${groupId}".`);
  const want = imageSize(m);
  for (const [name, b] of [['latest picture', latest], ['older picture', older]] as const) {
    const d = imageDimensions(b);
    if (!sniffImage(b) || !d) throw new Error(`The ${name} cannot be read.`);
    if (d.w !== want.w || d.h !== want.h) throw new Error(`The ${name} is ${d.w}×${d.h} px but the map's picture is ${want.w}×${want.h} px (the map was resized since): paint the group again instead.`);
  }
  const uri = (b: Buffer) => `data:${MIME[sniffImage(b)!]};base64,${b.toString('base64')}`;
  const { w, h } = mask;
  return toPng(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${mask.defs}<mask id="swap" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">${mask.body}</mask></defs>`
    + `<image href="${uri(latest)}" width="${w}" height="${h}"/><image href="${uri(older)}" width="${w}" height="${h}" mask="url(#swap)"/></svg>`,
  );
}
