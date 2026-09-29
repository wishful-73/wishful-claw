/**
 * Where a tool's generated output lands when it carries no explicit
 * `targetPath` (iter-36 S-153).
 *
 * Historically that was a fixed `~/wishful-claw/image`, which no session
 * sandbox covered — so an agent could take a screenshot, be handed the path,
 * and then be refused when it tried to read the file back.
 *
 * Kept free of Electron imports on purpose: the path rules are pure and are
 * covered by `tests/generated-image-dir`, which runs in plain node. Callers in
 * the main process pass `resolveDataDir()` in.
 */

import { join } from 'path'
import { WISHFUL_CLAW_DATA_DIR_NAME } from '../../shared/data-dir'

export const GENERATED_IMAGES_SUBDIR = 'image'

/**
 * Session facts that decide the default directory. Mirrors
 * `MemoryPathResolver.ResolveRoot`, so tool output follows the same three-way
 * split as memory — and, crucially, lands inside the session sandbox:
 *
 *   local project  → `{workingFolder}/.wishful-claw/image`
 *   SSH project    → `{dataRoot}/projects/{projectId}/image`
 *   global / other → `{dataRoot}/image`
 *
 * The data root is always mounted into the sandbox and a project's working
 * folder is the sandbox root itself, so a produced file stays readable by the
 * agent that produced it.
 */
export interface GeneratedImageScope {
  scope?: 'global' | 'project'
  workingFolder?: string | null
  projectId?: string | null
  sshConnectionId?: string | null
}

/**
 * Resolve the default output directory for generated images.
 *
 * `dataRoot` is passed in rather than read from Electron so this stays a pure
 * function. A project session that is missing the facts its branch needs
 * (SSH without a `projectId`, local without a `workingFolder`) falls through to
 * the data root — the one place guaranteed to be inside every sandbox.
 */
export function resolveGeneratedImagesDir(
  input: GeneratedImageScope = {},
  dataRoot: string
): string {
  if (input.scope === 'project') {
    const sshConnectionId = input.sshConnectionId?.trim()
    const workingFolder = input.workingFolder?.trim()

    if (sshConnectionId) {
      const projectId = input.projectId?.trim()
      if (projectId) {
        return join(dataRoot, 'projects', projectId, GENERATED_IMAGES_SUBDIR)
      }
    } else if (workingFolder) {
      return join(workingFolder, WISHFUL_CLAW_DATA_DIR_NAME, GENERATED_IMAGES_SUBDIR)
    }
  }

  return join(dataRoot, GENERATED_IMAGES_SUBDIR)
}
