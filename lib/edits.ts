import sharp from 'sharp'

// Phase 2 "Modify" operations (Build Spec Section 4.1.3) — transforms on an
// existing step's output, distinct from a full regeneration. Scoped to the
// two edit_types that are a straightforward transform on pixels already in
// hand: crop and color_adjust. region_edit (inpainting) needs a mask UI and
// a different provider call; composite and text_rewrite don't apply to an
// image-only Phase 2 — left for a later phase rather than half-built here.

export interface CropParams {
  leftPct: number
  topPct: number
  widthPct: number
  heightPct: number
}

export async function applyCrop(buffer: Buffer, p: CropParams): Promise<Buffer> {
  const meta = await sharp(buffer).metadata()
  if (!meta.width || !meta.height) throw new Error('Could not read image dimensions')

  const left = Math.max(0, Math.round(p.leftPct * meta.width))
  const top = Math.max(0, Math.round(p.topPct * meta.height))
  const width = Math.max(1, Math.min(Math.round(p.widthPct * meta.width), meta.width - left))
  const height = Math.max(1, Math.min(Math.round(p.heightPct * meta.height), meta.height - top))

  return sharp(buffer).extract({ left, top, width, height }).png().toBuffer()
}

export interface ColorAdjustParams {
  brightness?: number
  saturation?: number
}

export async function applyColorAdjust(buffer: Buffer, p: ColorAdjustParams): Promise<Buffer> {
  return sharp(buffer)
    .modulate({ brightness: p.brightness, saturation: p.saturation })
    .png()
    .toBuffer()
}
