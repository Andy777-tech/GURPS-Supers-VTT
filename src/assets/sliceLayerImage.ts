import type { AssetId, MapImageLayer } from '../types/map';
import type { MeasureBox } from '../utils/stamps';
import { layerPixelRect } from '../utils/stamps';
import { normalizeRotation } from '../utils/imageLayerTransform';
import { getAssetStore } from './assetStore';

/** Crop the displayed image, including its image-space mirrors and clockwise grid rotation. */
export async function sliceLayerImage(
  layer: MapImageLayer,
  box: MeasureBox
): Promise<{ assetId: AssetId; mime: string } | null> {
  const store = getAssetStore();
  const url = layer.assetId ? await store.getObjectUrl(layer.assetId) : layer.src;
  if (!url) return null;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load layer image'));
    image.src = url;
  });
  const rotation = normalizeRotation(layer.rotation);
  const quarter = rotation === 90 || rotation === 270;
  const transformed = document.createElement('canvas');
  transformed.width = quarter ? img.naturalHeight : img.naturalWidth;
  transformed.height = quarter ? img.naturalWidth : img.naturalHeight;
  const rect = layerPixelRect(layer, transformed.width, transformed.height, box);
  if (!rect) return null;
  const ctx = transformed.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');
  // MapScene.buildImageLayers scales mirrors before its negative local-Z rotation.
  // Canvas y points down, so a positive angle gives the same clockwise grid turn.
  ctx.translate(transformed.width / 2, transformed.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(layer.mirrorX ? -1 : 1, layer.mirrorY ? -1 : 1);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  const crop = document.createElement('canvas');
  crop.width = Math.max(1, Math.round(rect.sw));
  crop.height = Math.max(1, Math.round(rect.sh));
  const cropCtx = crop.getContext('2d');
  if (!cropCtx) throw new Error('Could not get canvas context');
  cropCtx.drawImage(transformed, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, crop.width, crop.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    crop.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Failed to encode image'))),
      'image/jpeg',
      0.85
    );
  });
  const mime = blob.type || 'image/jpeg';
  return { assetId: await store.put(new Uint8Array(await blob.arrayBuffer()), mime), mime };
}
