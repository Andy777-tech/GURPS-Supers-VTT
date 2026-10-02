import '@testing-library/jest-dom';
import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GURPSPartyTool from '../App';
import { createCampaignState } from '../state/campaignReducer';
import { checkMigrationNeeded, migrateToV2 } from '../persistence/dataMigration';
import {
  commitMigratedCampaignState,
  loadCampaignState,
  saveCampaignState,
} from '../persistence/campaignStorage';

vi.mock('../unified/UnifiedShell', () => ({ UnifiedShell: () => <div>shell ready</div> }));
vi.mock('../components/ui/NotificationBridge', () => ({ NotificationBridge: () => null }));
vi.mock('../persistence/dataMigration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../persistence/dataMigration')>()),
  checkMigrationNeeded: vi.fn(),
  migrateToV2: vi.fn(),
}));
vi.mock('../persistence/campaignStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../persistence/campaignStorage')>()),
  loadCampaignState: vi.fn(),
  saveCampaignState: vi.fn(),
}));

const needsMigration = vi.mocked(checkMigrationNeeded);
const migrate = vi.mocked(migrateToV2);
const load = vi.mocked(loadCampaignState);

describe('App initialisation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(saveCampaignState).mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('shows the load error with a retry instead of spinning forever', async () => {
    needsMigration.mockResolvedValue(false);
    load.mockRejectedValueOnce(new Error('disk I/O error')).mockResolvedValue(createCampaignState());

    render(<GURPSPartyTool />);

    expect(await screen.findByText(/couldn't be loaded: disk I\/O error/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('shell ready')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('retries a failed migration, which left the legacy data untouched', async () => {
    needsMigration.mockResolvedValue(true);
    migrate.mockResolvedValueOnce(null).mockResolvedValue(createCampaignState());

    render(<GURPSPartyTool />);

    expect(await screen.findByText(/couldn't be converted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('shell ready')).toBeInTheDocument();
    expect(migrate).toHaveBeenCalledTimes(2);
    expect(migrate).toHaveBeenCalledWith(commitMigratedCampaignState);
  });

  it('loads the campaign another tab committed while this one migrated', async () => {
    needsMigration.mockResolvedValueOnce(true).mockResolvedValue(false);
    migrate.mockResolvedValue(null);
    load.mockResolvedValue(createCampaignState());

    render(<GURPSPartyTool />);

    expect(await screen.findByText('shell ready')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('migrates once under StrictMode', async () => {
    needsMigration.mockResolvedValue(true);
    migrate.mockResolvedValue(createCampaignState());

    render(<StrictMode><GURPSPartyTool /></StrictMode>);

    expect(await screen.findByText('shell ready')).toBeInTheDocument();
    expect(needsMigration).toHaveBeenCalledTimes(2);
    expect(migrate).toHaveBeenCalledTimes(1);
  });

  it('loads once under StrictMode', async () => {
    needsMigration.mockResolvedValue(false);
    load.mockResolvedValue(createCampaignState());

    render(<StrictMode><GURPSPartyTool /></StrictMode>);

    expect(await screen.findByText('shell ready')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
