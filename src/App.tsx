import { useState, useEffect } from 'react';
import { logger } from './utils/logger';
import { UnifiedShell } from './unified/UnifiedShell';
import { CampaignStoreProvider } from './state/campaignStore';
import { commitMigratedCampaignState, loadCampaignState } from './persistence/campaignStorage';
import { checkMigrationNeeded, migrateToV2 } from './persistence/dataMigration';
import { ToastProvider, ToastContainer, LoadingSpinner } from './components/ui';
import { StorageQuotaBanner } from './components/ui/StorageQuotaBanner';
import { SaveHealthBanner } from './components/ui/SaveHealthBanner';
import { NotificationBridge } from './components/ui/NotificationBridge';
import type { CampaignState } from './state/campaignReducer';

type MigrationStatus = 'checking' | 'migrating' | 'ready' | 'failed';

/**
 * Main App Component
 * Handles migration, initialization, and renders the Unified UI
 */
export default function GURPSPartyTool() {
  logger.log('GURPSPartyTool rendering');
  const [initialCampaignState, setInitialCampaignState] = useState<CampaignState | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus>('checking');
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Check for migration on startup and load campaign state
  useEffect(() => {
    // StrictMode runs this effect twice; the cancelled run must stop at its
    // next await, before it migrates, loads, or touches UI state.
    let cancelled = false;

    async function loadIntoApp() {
      const loadedState = await loadCampaignState();
      if (cancelled) return;
      setInitialCampaignState(loadedState);
      setMigrationStatus('ready');
    }

    async function initializeApp() {
      try {
        logger.log('Checking for migration...');
        const needsMigration = await checkMigrationNeeded();
        if (cancelled) return;

        if (needsMigration) {
          logger.log('Migration needed - running migration...');
          setMigrationStatus('migrating');

          const migratedState = await migrateToV2(commitMigratedCampaignState);
          if (cancelled) return;

          if (migratedState) {
            logger.log('Migration successful');
            setInitialCampaignState(migratedState);
            setMigrationStatus('ready');
          } else if (!(await checkMigrationNeeded())) {
            // The commit refuses when a campaign already exists (another tab
            // migrated first); use that campaign.
            if (cancelled) return;
            logger.log('A campaign appeared during migration - loading it instead');
            await loadIntoApp();
          } else if (!cancelled) {
            // Legacy keys are left untouched on failure, so a retry is safe.
            logger.error('Migration failed');
            setFailureMessage(
              "Your campaign from an older version of the app couldn't be converted. " +
              'The old data has not been changed.'
            );
            setMigrationStatus('failed');
          }
        } else {
          logger.log('No migration needed - loading campaign state');
          await loadIntoApp();
        }
      } catch (error) {
        logger.error('Error during initialization:', error);
        if (!cancelled) {
          setFailureMessage(
            `The campaign couldn't be loaded: ${error instanceof Error ? error.message : String(error)}`
          );
          setMigrationStatus('failed');
        }
      }
    }

    initializeApp();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Show loading screen while migration/initialization is in progress
  if (migrationStatus === 'checking') {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-0 text-fg-bright">
        <LoadingSpinner size="lg" label="Checking for updates..." />
      </div>
    );
  }

  if (migrationStatus === 'migrating') {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-0 text-fg-bright">
        <LoadingSpinner size="lg" label="Migrating to new storage format..." />
      </div>
    );
  }

  if (migrationStatus === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 h-screen bg-surface-0 text-fg-bright p-6 text-center">
        <p className="max-w-md text-sm text-fg-secondary">{failureMessage}</p>
        <button
          type="button"
          onClick={() => {
            setFailureMessage(null);
            setMigrationStatus('checking');
            setAttempt((n) => n + 1);
          }}
          className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-500 text-fg-bright text-sm font-medium"
        >
          Try again
        </button>
      </div>
    );
  }

  // Wait for campaign state to load
  if (!initialCampaignState) {
    return (
      <div className="min-h-screen bg-surface-0 text-fg-bright flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading campaign..." />
      </div>
    );
  }

  return (
    <ToastProvider>
      <CampaignStoreProvider initialCampaignState={initialCampaignState}>
        <UnifiedShell />
        <NotificationBridge />
        <ToastContainer position="top-right" />
        <StorageQuotaBanner />
        <SaveHealthBanner />
      </CampaignStoreProvider>
    </ToastProvider>
  );
}
