// libraries/nestjs-libraries/src/database/prisma/media/media.janitor.service.spec.ts
//
// Unit coverage for MediaJanitorService — orchestration, error containment,
// post-commit unlink ordering, dryRun semantics, ENOENT-as-success,
// resurrection routing (architect §4, plan §Two-phase state machine,
// invariants #4 / #5 / #9 / #10).
//
// Repository, resolver, and upload provider are all mocked here — repository
// behavior under real Postgres is covered by the integration suite. The unit
// here validates that the SERVICE correctly:
//   - delegates to repository with integer ageDays/graceDays (invariant #3)
//   - skips the markSoftDeleted UPDATE on dryRun (invariant #4 dry-run leg)
//   - routes each HardDeleteRowResult to the right log + counter
//   - runs the resolver BEFORE removeFile (invariant #1 path topology)
//   - skips removeFile on kind:'remote' (SD4)
//   - Sentry-captures kind:'rejected' and PathConfinementError from layer-2 (SD1)
//   - treats ENOENT as success (invariant #5)
//   - WARN-logs other unlink errors but does NOT rethrow (invariant #10
//     disk-orphan acceptable, dangling-row NOT acceptable)
//
// SCENARIO-W (auditor YELLOW): repository receives BOTH graceDays AND ageDays
// from the service — when the cutoff topology shifts (e.g., grace + age vs
// grace alone), this is the call-site whose contract must not silently drift.
jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: jest.fn(),
  },
}));

import * as Sentry from '@sentry/nestjs';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { MediaJanitorService } from './media.janitor.service';
import {
  HardDeleteRowOutcome,
  HardDeleteRowResult,
  SoftDeleteCandidate,
} from './media.janitor.repository';
import { PathConfinementError } from '@gitroom/nestjs-libraries/upload/path.confinement.error';

type ResolveResult =
  | { kind: 'local'; absolutePath: string }
  | { kind: 'remote'; reason: 'http_scheme'; url: string }
  | { kind: 'rejected'; reason: string };

function buildOpts(overrides: Partial<{
  runId: string;
  dryRun: boolean;
  ageDays: number;
  graceDays: number;
  batchSize: number;
}> = {}) {
  return {
    runId: overrides.runId ?? 'mj-test-000000',
    dryRun: overrides.dryRun ?? false,
    ageDays: overrides.ageDays ?? 7,
    graceDays: overrides.graceDays ?? 7,
    batchSize: overrides.batchSize ?? 100,
  };
}

function buildCandidate(
  partial: Partial<SoftDeleteCandidate> = {}
): SoftDeleteCandidate {
  return {
    id: partial.id ?? 'media-1',
    path: partial.path ?? '/2025/06/15/hit.png',
    organizationId: partial.organizationId ?? 'org-1',
    fileSize: partial.fileSize ?? 1024,
  };
}

function buildOutcome(
  result: HardDeleteRowResult,
  partial: Partial<HardDeleteRowOutcome> = {}
): HardDeleteRowOutcome {
  return {
    mediaId: partial.mediaId ?? 'media-1',
    path: partial.path ?? '/2025/06/15/hit.png',
    fileSize: partial.fileSize ?? 1024,
    organizationId: partial.organizationId ?? 'org-1',
    result,
  };
}

function buildService(overrides: {
  repository?: any;
  resolver?: any;
  uploadProvider?: any;
} = {}) {
  const uploadProvider = overrides.uploadProvider ?? {
    removeFile: jest.fn(async () => undefined),
  };
  (UploadFactory.createStorage as jest.Mock).mockReturnValue(uploadProvider);

  const repository = overrides.repository ?? {
    findSoftDeleteCandidates: jest.fn(async () => []),
    markSoftDeleted: jest.fn(async () => ({ transitioned: 0 })),
    hardDeleteBatch: jest.fn(async () => []),
  };
  const resolver = overrides.resolver ?? {
    resolveForDelete: jest.fn(),
  };
  const service = new MediaJanitorService(repository, resolver);
  return { service, repository, resolver, uploadProvider };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MediaJanitorService.runSoftDeletePhase', () => {
  it('passes integer ageDays + batchSize to repository (invariant #3)', async () => {
    const { service, repository } = buildService();
    await service.runSoftDeletePhase(buildOpts({ ageDays: 7, batchSize: 50 }));
    expect(repository.findSoftDeleteCandidates).toHaveBeenCalledWith({
      ageDays: 7,
      batchSize: 50,
    });
  });

  it('summarizes scanned + eligible + bytes from candidates', async () => {
    const repository = {
      findSoftDeleteCandidates: jest.fn(async () => [
        buildCandidate({ id: 'a', fileSize: 100 }),
        buildCandidate({ id: 'b', fileSize: 200 }),
      ]),
      markSoftDeleted: jest.fn(async () => ({ transitioned: 2 })),
      hardDeleteBatch: jest.fn(),
    };
    const { service } = buildService({ repository });
    const summary = await service.runSoftDeletePhase(buildOpts());
    expect(summary.scanned).toBe(2);
    expect(summary.eligible).toBe(2);
    expect(summary.bytesReclaimedEstimate).toBe(300);
    expect(summary.transitioned).toBe(2);
  });

  it('dryRun=true: candidates scanned, markSoftDeleted NOT called (invariant #4 dry-run leg)', async () => {
    const repository = {
      findSoftDeleteCandidates: jest.fn(async () => [buildCandidate()]),
      markSoftDeleted: jest.fn(),
      hardDeleteBatch: jest.fn(),
    };
    const { service } = buildService({ repository });
    const summary = await service.runSoftDeletePhase(
      buildOpts({ dryRun: true })
    );
    expect(repository.markSoftDeleted).not.toHaveBeenCalled();
    expect(summary.eligible).toBe(1);
    expect(summary.transitioned).toBe(0);
  });

  it('empty candidate list short-circuits (no UPDATE issued)', async () => {
    const repository = {
      findSoftDeleteCandidates: jest.fn(async () => []),
      markSoftDeleted: jest.fn(),
      hardDeleteBatch: jest.fn(),
    };
    const { service } = buildService({ repository });
    const summary = await service.runSoftDeletePhase(buildOpts());
    expect(repository.markSoftDeleted).not.toHaveBeenCalled();
    expect(summary.transitioned).toBe(0);
  });

  it('rethrows phase-level repository errors (Sentry surfaces them)', async () => {
    const repository = {
      findSoftDeleteCandidates: jest.fn(async () => {
        throw new Error('db unreachable');
      }),
      markSoftDeleted: jest.fn(),
      hardDeleteBatch: jest.fn(),
    };
    const { service } = buildService({ repository });
    await expect(
      service.runSoftDeletePhase(buildOpts())
    ).rejects.toThrow('db unreachable');
  });

  it('markSoftDeleted failure is per-row-contained: errors counter set, never rethrown', async () => {
    const repository = {
      findSoftDeleteCandidates: jest.fn(async () => [buildCandidate()]),
      markSoftDeleted: jest.fn(async () => {
        throw new Error('UPDATE failed');
      }),
      hardDeleteBatch: jest.fn(),
    };
    const { service } = buildService({ repository });
    const summary = await service.runSoftDeletePhase(buildOpts());
    expect(summary.errors).toBe(1);
    expect(summary.transitioned).toBe(0);
  });
});

describe('MediaJanitorService.runHardDeletePhase', () => {
  it('passes BOTH ageDays AND graceDays to repository (SCENARIO-W contract anchor)', async () => {
    // SCENARIO-W (auditor YELLOW): the repository accepts both parameters even
    // though the current impl uses graceDays alone (the `void ageDays;` site).
    // This test pins the SERVICE→REPOSITORY contract so that if the cutoff
    // topology evolves (e.g., grace+age explicit), the service is already
    // passing both parameters.
    const { service, repository } = buildService();
    await service.runHardDeletePhase(
      buildOpts({ ageDays: 7, graceDays: 7, batchSize: 50 })
    );
    expect(repository.hardDeleteBatch).toHaveBeenCalledWith({
      ageDays: 7,
      graceDays: 7,
      batchSize: 50,
      dryRun: false,
    });
  });

  it('threads dryRun through to repository.hardDeleteBatch', async () => {
    const { service, repository } = buildService();
    await service.runHardDeletePhase(buildOpts({ dryRun: true }));
    expect(repository.hardDeleteBatch).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true })
    );
  });

  describe('outcome routing', () => {
    it('result=deleted, kind=local → calls removeFile with the resolver absolutePath', async () => {
      const repository = {
        findSoftDeleteCandidates: jest.fn(),
        markSoftDeleted: jest.fn(),
        hardDeleteBatch: jest.fn(async () => [buildOutcome('deleted')]),
      };
      const resolver = {
        resolveForDelete: jest.fn(async (): Promise<ResolveResult> => ({
          kind: 'local',
          absolutePath: '/abs/2025/06/15/hit.png',
        })),
      };
      const uploadProvider = { removeFile: jest.fn(async () => undefined) };
      const { service } = buildService({ repository, resolver, uploadProvider });

      const summary = await service.runHardDeletePhase(buildOpts());

      expect(resolver.resolveForDelete).toHaveBeenCalledTimes(1);
      expect(uploadProvider.removeFile).toHaveBeenCalledWith(
        '/abs/2025/06/15/hit.png'
      );
      expect(summary.hardDeleted).toBe(1);
      expect(summary.bytesReclaimed).toBe(1024);
      expect(summary.unlinkErrors).toBe(0);
      expect(summary.pathRejected).toBe(0);
    });

    it('result=deleted, dryRun=true → no resolver, no removeFile (repository ROLLBACKed)', async () => {
      const repository = {
        findSoftDeleteCandidates: jest.fn(),
        markSoftDeleted: jest.fn(),
        hardDeleteBatch: jest.fn(async () => [buildOutcome('deleted')]),
      };
      const resolver = {
        resolveForDelete: jest.fn(),
      };
      const uploadProvider = { removeFile: jest.fn() };
      const { service } = buildService({ repository, resolver, uploadProvider });

      const summary = await service.runHardDeletePhase(
        buildOpts({ dryRun: true })
      );

      expect(resolver.resolveForDelete).not.toHaveBeenCalled();
      expect(uploadProvider.removeFile).not.toHaveBeenCalled();
      // Counter still records what WOULD have been reclaimed.
      expect(summary.hardDeleted).toBe(1);
      expect(summary.bytesReclaimed).toBe(1024);
    });

    it('result=deleted, kind=remote → SKIPS removeFile (SD4)', async () => {
      const repository = {
        findSoftDeleteCandidates: jest.fn(),
        markSoftDeleted: jest.fn(),
        hardDeleteBatch: jest.fn(async () => [buildOutcome('deleted')]),
      };
      const resolver = {
        resolveForDelete: jest.fn(async (): Promise<ResolveResult> => ({
          kind: 'remote',
          reason: 'http_scheme',
          url: 'https://cdn/x.png',
        })),
      };
      const uploadProvider = { removeFile: jest.fn() };
      const { service } = buildService({ repository, resolver, uploadProvider });

      await service.runHardDeletePhase(buildOpts());

      expect(uploadProvider.removeFile).not.toHaveBeenCalled();
    });

    it('result=deleted, kind=rejected → Sentry-captures, pathRejected counter increments, NO removeFile', async () => {
      const repository = {
        findSoftDeleteCandidates: jest.fn(),
        markSoftDeleted: jest.fn(),
        hardDeleteBatch: jest.fn(async () => [buildOutcome('deleted')]),
      };
      const resolver = {
        resolveForDelete: jest.fn(async (): Promise<ResolveResult> => ({
          kind: 'rejected',
          reason: 'traversal',
        })),
      };
      const uploadProvider = { removeFile: jest.fn() };
      const { service } = buildService({ repository, resolver, uploadProvider });

      const summary = await service.runHardDeletePhase(buildOpts());

      expect(uploadProvider.removeFile).not.toHaveBeenCalled();
      expect(summary.pathRejected).toBe(1);
      expect(Sentry.captureMessage as jest.Mock).toHaveBeenCalledWith(
        'media-janitor.path-reject',
        expect.objectContaining({
          level: 'error',
          extra: expect.objectContaining({ reason: 'traversal' }),
        })
      );
    });

    it('removeFile ENOENT → treated as success (invariant #5); no unlinkErrors counter bump', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const repository = {
        findSoftDeleteCandidates: jest.fn(),
        markSoftDeleted: jest.fn(),
        hardDeleteBatch: jest.fn(async () => [buildOutcome('deleted')]),
      };
      const resolver = {
        resolveForDelete: jest.fn(async (): Promise<ResolveResult> => ({
          kind: 'local',
          absolutePath: '/abs/missing.png',
        })),
      };
      const uploadProvider = {
        removeFile: jest.fn(async () => {
          throw enoent;
        }),
      };
      const { service } = buildService({ repository, resolver, uploadProvider });

      const summary = await service.runHardDeletePhase(buildOpts());

      expect(summary.unlinkErrors).toBe(0);
      expect(summary.hardDeleted).toBe(1);
    });

    it('removeFile throws PathConfinementError (layer-2 catch) → Sentry-captures, pathRejected++', async () => {
      const repository = {
        findSoftDeleteCandidates: jest.fn(),
        markSoftDeleted: jest.fn(),
        hardDeleteBatch: jest.fn(async () => [buildOutcome('deleted')]),
      };
      const resolver = {
        resolveForDelete: jest.fn(async (): Promise<ResolveResult> => ({
          kind: 'local',
          absolutePath: '/abs/x.png',
        })),
      };
      const uploadProvider = {
        removeFile: jest.fn(async () => {
          throw new PathConfinementError('symlink', '/abs/x.png');
        }),
      };
      const { service } = buildService({ repository, resolver, uploadProvider });

      const summary = await service.runHardDeletePhase(buildOpts());

      expect(summary.pathRejected).toBe(1);
      expect(Sentry.captureMessage as jest.Mock).toHaveBeenCalledWith(
        'media-janitor.path-reject',
        expect.objectContaining({
          extra: expect.objectContaining({
            reason: 'symlink',
            layer: 'local-storage-removeFile',
          }),
        })
      );
    });

    it('removeFile non-ENOENT error → WARN-logged, unlinkErrors++, does NOT rethrow (invariant #10)', async () => {
      const repository = {
        findSoftDeleteCandidates: jest.fn(),
        markSoftDeleted: jest.fn(),
        hardDeleteBatch: jest.fn(async () => [
          buildOutcome('deleted', { mediaId: 'm1' }),
          buildOutcome('deleted', { mediaId: 'm2' }),
        ]),
      };
      const eio = Object.assign(new Error('EIO'), { code: 'EIO' });
      const resolver = {
        resolveForDelete: jest.fn(async (): Promise<ResolveResult> => ({
          kind: 'local',
          absolutePath: '/abs/x.png',
        })),
      };
      let calls = 0;
      const uploadProvider = {
        removeFile: jest.fn(async () => {
          calls += 1;
          if (calls === 1) throw eio;
          // second call succeeds
        }),
      };
      const { service } = buildService({ repository, resolver, uploadProvider });

      const summary = await service.runHardDeletePhase(buildOpts());

      // Counter records the failure but the loop did NOT abort.
      expect(summary.unlinkErrors).toBe(1);
      expect(summary.hardDeleted).toBe(2); // Both row-deletes count regardless
      expect(uploadProvider.removeFile).toHaveBeenCalledTimes(2);
    });

    it.each<HardDeleteRowResult>([
      'resurrected-fk-relinked',
      'resurrected-nonpub-ref',
      'resurrected-no-pub-ref',
    ])('result=%s → resurrected counter increments, NO removeFile', async (result) => {
      const repository = {
        findSoftDeleteCandidates: jest.fn(),
        markSoftDeleted: jest.fn(),
        hardDeleteBatch: jest.fn(async () => [buildOutcome(result)]),
      };
      const resolver = { resolveForDelete: jest.fn() };
      const uploadProvider = { removeFile: jest.fn() };
      const { service } = buildService({ repository, resolver, uploadProvider });

      const summary = await service.runHardDeletePhase(buildOpts());

      expect(summary.resurrected).toBe(1);
      expect(uploadProvider.removeFile).not.toHaveBeenCalled();
      expect(summary.hardDeleted).toBe(0);
    });

    it('result=skipped-race → counted in scanned/candidates, no remove, no resurrect bump', async () => {
      const repository = {
        findSoftDeleteCandidates: jest.fn(),
        markSoftDeleted: jest.fn(),
        hardDeleteBatch: jest.fn(async () => [buildOutcome('skipped-race')]),
      };
      const resolver = { resolveForDelete: jest.fn() };
      const uploadProvider = { removeFile: jest.fn() };
      const { service } = buildService({ repository, resolver, uploadProvider });

      const summary = await service.runHardDeletePhase(buildOpts());

      expect(summary.candidates).toBe(1);
      expect(summary.hardDeleted).toBe(0);
      expect(summary.resurrected).toBe(0);
      expect(uploadProvider.removeFile).not.toHaveBeenCalled();
    });
  });

  describe('error containment across the batch', () => {
    it('per-row exception in handleOutcome does NOT abort the loop (invariant #10)', async () => {
      const repository = {
        findSoftDeleteCandidates: jest.fn(),
        markSoftDeleted: jest.fn(),
        hardDeleteBatch: jest.fn(async () => [
          buildOutcome('deleted', { mediaId: 'a' }),
          buildOutcome('deleted', { mediaId: 'b' }),
          buildOutcome('deleted', { mediaId: 'c' }),
        ]),
      };
      let n = 0;
      const resolver = {
        resolveForDelete: jest.fn(async (): Promise<ResolveResult> => {
          n += 1;
          if (n === 2) throw new Error('resolver blew up');
          return { kind: 'local', absolutePath: '/abs/x.png' };
        }),
      };
      const uploadProvider = { removeFile: jest.fn(async () => undefined) };
      const { service } = buildService({ repository, resolver, uploadProvider });

      const summary = await service.runHardDeletePhase(buildOpts());

      // Resolver got called for all 3 (the 2nd threw); removeFile got called
      // for the 1st and 3rd.
      expect(resolver.resolveForDelete).toHaveBeenCalledTimes(3);
      expect(uploadProvider.removeFile).toHaveBeenCalledTimes(2);
      expect(summary.candidates).toBe(3);
      expect(summary.hardDeleted).toBe(3);
    });
  });
});
