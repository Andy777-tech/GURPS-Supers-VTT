import type { AssetId } from '../types/map';
import { connectionManager } from '../net/ConnectionManager';
import { Role } from '../../shared/session';
import { getAssetStore } from './assetStore';

/** Publish shared image bytes when this client is the connected host. */
export async function uploadAssetToPeers(assetId: AssetId): Promise<void> {
  if (connectionManager.status !== 'connected' || connectionManager.role !== Role.GM) return;
  const asset = await getAssetStore().get(assetId);
  if (!asset) throw new Error(`Imported asset ${assetId} is missing`);
  await connectionManager.uploadAsset(assetId, asset.bytes, asset.mime);
}
