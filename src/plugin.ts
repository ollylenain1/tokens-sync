import { savedWindowSize, windowSize } from './core/window-size';
import {
  Connection,
  Settings,
  SyncError,
  SyncPlan,
  TokenProject,
  defaultSettings,
  record,
  safeError,
} from './core/model';
import { buildDesired } from './core/desired';
import { FigmaAdapter } from './figma/adapter';
import { RegistryStore } from './figma/registry';
import { Choices, planSync } from './sync/planner';
import { RunControl, applyPlan } from './sync/engine';
import { previewPayload } from './ui/preview-model';
import { reportHasIssues, syncNotification } from './ui/sync-status';
import { readProviderRoute, PluginFetcher } from './providers/plugin-transport';

figma.showUI(__html__, {
  width: 440,
  height: 720,
  themeColors: true,
  title: 'Blueprint · Token Sync',
});
const store = new RegistryStore(figma.root, figma.fileKey);
const adapter = new FigmaAdapter(figma, store.identity);
let project: TokenProject | undefined,
  plan: SyncPlan | undefined,
  busy = false,
  control: RunControl | undefined;
const post = (message: unknown) => figma.ui.postMessage(message);

figma.ui.onmessage = async (message: unknown) => {
  if (!record(message) || typeof message.type !== 'string' || typeof message.id !== 'number')
    return;
  const id = message.id;
  if (message.type === 'cancel') {
    if (control) control.cancelled = true;
    post({ id, ok: true });
    return;
  }
  if (message.type === 'resize') {
    const size = windowSize(message);
    if (!size) {
      post({ id, ok: false, error: 'Window dimensions must be finite numbers.' });
      return;
    }
    try {
      figma.ui.resize(size.width, size.height);
      if (message.persist === true)
        await figma.clientStorage.setAsync('blueprint.windowSize', size);
      post({ id, ok: true, result: size });
    } catch (cause) {
      post({ id, ok: false, error: safeError(cause) });
    }
    return;
  }
  if (message.type === 'providerFetch') {
    try {
      const result = await readProviderRoute(
        message.connection as Connection,
        String(message.url),
        fetch as unknown as PluginFetcher,
        typeof message.accept === 'string' ? message.accept : undefined,
      );
      post({ id, ok: true, result });
    } catch (cause) {
      post({
        id,
        ok: false,
        error:
          cause instanceof SyncError
            ? cause.message
            : 'The configured Git host could not be reached. Check its HTTPS URL and VPN access.',
      });
    }
    return;
  }
  if (busy) {
    post({ id, ok: false, error: 'Another operation is running. Wait for it to finish.' });
    return;
  }
  busy = true;
  try {
    let result: unknown;
    switch (message.type) {
      case 'init': {
        const [saved, settings, state, savedSize] = await Promise.all([
          figma.clientStorage.getAsync('blueprint.connection'),
          figma.clientStorage.getAsync('blueprint.settings'),
          adapter.snapshot(),
          figma.clientStorage.getAsync('blueprint.windowSize'),
        ]);
        const dimensions = savedWindowSize(savedSize);
        figma.ui.resize(dimensions.width, dimensions.height);
        const credential = saved?.remember
          ? await figma.clientStorage.getAsync('blueprint.credential')
          : '';
        result = {
          windowSize: dimensions,
          connection: saved
            ? { ...saved, token: typeof credential === 'string' ? credential : '' }
            : undefined,
          settings: { ...defaultSettings, ...(settings ?? {}) },
          collections: state.collections.map((c) => ({
            id: c.id,
            name: c.name,
            canExtend: c.canExtend,
            modes: c.modes.map((m) => m.name),
          })),
        };
        break;
      }
      case 'saveConnection': {
        const connection = message.connection as Connection;
        if (
          !connection ||
          typeof connection.token !== 'string' ||
          !['github', 'gitlab'].includes(connection.provider)
        )
          throw new SyncError('CONFIG', 'Invalid connection configuration.');
        const { token, ...publicConfig } = connection;
        if (connection.remember) await figma.clientStorage.setAsync('blueprint.credential', token);
        else await figma.clientStorage.deleteAsync('blueprint.credential');
        await figma.clientStorage.setAsync('blueprint.connection', publicConfig);
        project = undefined;
        plan = undefined;
        result = true;
        break;
      }
      case 'disconnect':
        await figma.clientStorage.deleteAsync('blueprint.credential');
        await figma.clientStorage.deleteAsync('blueprint.connection');
        project = undefined;
        plan = undefined;
        result = true;
        break;
      case 'preview': {
        if (message.project) project = message.project as TokenProject;
        if (!project)
          throw new SyncError('NO_FETCH', 'Fetch token files before preparing a preview.');
        plan = undefined;
        const settings = message.settings as Settings;
        const model = await buildDesired(project, settings);
        const state = await adapter.snapshot();
        await adapter.prepareFonts(model);
        plan = planSync(model, state, store.read(), (message.choices ?? {}) as Choices);
        await figma.clientStorage.setAsync('blueprint.settings', settings);
        result = previewPayload(plan);
        break;
      }
      case 'sync': {
        if (!plan || message.planId !== plan.id)
          throw new SyncError(
            'STALE_PREVIEW',
            'This preview is no longer current. Refresh it before syncing.',
          );
        control = {
          cancelled: false,
          progress: (text, done, total) => post({ type: 'progress', text, done, total }),
        };
        const apply = plan;
        plan = undefined;
        const report = await applyPlan(apply, adapter, store.read(), store, control);
        result = report;
        figma.notify(syncNotification(report), {
          timeout: reportHasIssues(report) ? 7000 : 4000,
          error: report.failed > 0,
        });
        break;
      }
      default:
        throw new SyncError('MESSAGE', 'Unknown plugin action.');
    }
    post({ id, ok: true, result });
  } catch (error) {
    if (message.type === 'sync')
      figma.notify('Sync could not finish. Review the error in Blueprint.', {
        error: true,
        timeout: 7000,
      });
    post({
      id,
      ok: false,
      error: safeError(error),
      code: error instanceof SyncError ? error.code : 'PLUGIN',
    });
  } finally {
    busy = false;
    control = undefined;
  }
};
