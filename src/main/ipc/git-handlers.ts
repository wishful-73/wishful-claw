import {
  type GitTarget,
  type ScanRepositoriesArgs,
  type GitRepositorySummary,
  type GitRepoSummary,
  type GitStatusDetailedResult,
  DEFAULT_SCAN_DEPTH,
  registerGitMessagePackHandler,
  queryGit,
  nativeGitRequest,
  ok,
  okMutation,
  fail,
  execGit,
} from './git-cache'

export function registerGitHandlers(): void {
  // ── Query operations (cached) ──

  registerGitMessagePackHandler<GitTarget>('git:get-head', async (args) => {
    return await queryGit(args, { operation: 'get-head' })
  })

  registerGitMessagePackHandler<GitTarget & { base: string; head?: string }>(
    'git:get-range-commits',
    async (args) => {
      return await queryGit(args, {
        operation: 'get-range-commits',
        base: args.base,
        head: args.head
      })
    }
  )

  registerGitMessagePackHandler<GitTarget & { base: string; head?: string }>(
    'git:get-changed-files',
    async (args) => {
      return await queryGit(args, {
        operation: 'get-changed-files',
        base: args.base,
        head: args.head
      })
    }
  )

  registerGitMessagePackHandler<GitTarget>('git:get-status', async (args) => {
    return await queryGit(args, { operation: 'get-status' })
  })

  registerGitMessagePackHandler<GitTarget>('git:get-line-summary', async (args) => {
    return await queryGit(args, { operation: 'get-line-summary' })
  })

  // ── Scan ──

  registerGitMessagePackHandler<ScanRepositoriesArgs>('git:scan-repositories', async (args) => {
    const repositories = await nativeGitRequest<GitRepositorySummary[]>(
      'git/scan-repositories',
      args,
      {
        rootPath: args.rootPath,
        maxDepth: args.maxDepth ?? DEFAULT_SCAN_DEPTH,
        excludeDirs: args.excludeDirs ?? []
      },
      90_000
    )
    return ok({ repositories })
  })

  // ── Status ──

  registerGitMessagePackHandler<GitTarget>('git:get-repo-summary', async (args) => {
    const result = await nativeGitRequest<GitStatusDetailedResult>('git/status-detailed', args)
    if (!result.success) return result
    const summary: GitRepoSummary = {
      branch: result.status.branch,
      upstream: result.status.upstream,
      ahead: result.status.ahead,
      behind: result.status.behind
    }
    return ok(summary)
  })

  registerGitMessagePackHandler<GitTarget>('git:get-status-detailed', async (args) => {
    return await nativeGitRequest<GitStatusDetailedResult>('git/status-detailed', args)
  })

  // ── Diff ──

  registerGitMessagePackHandler<GitTarget & { filePath: string; staged?: boolean }>(
    'git:get-file-diff',
    async (args) => {
      return await queryGit(args, {
        operation: 'get-file-diff',
        filePath: args.filePath,
        staged: args.staged
      })
    }
  )

  registerGitMessagePackHandler<GitTarget & { filePath: string; commitHash: string }>(
    'git:get-file-diff-at-commit',
    async (args) => {
      return await queryGit(args, {
        operation: 'get-file-diff-at-commit',
        filePath: args.filePath,
        commitHash: args.commitHash
      })
    }
  )

  registerGitMessagePackHandler<GitTarget & { filePath: string; ref: string }>(
    'git:get-file-content-at-ref',
    async (args) => {
      return await queryGit(args, {
        operation: 'get-file-content-at-ref',
        filePath: args.filePath,
        ref: args.ref
      })
    }
  )

  registerGitMessagePackHandler<GitTarget & { maxPatchChars?: number }>(
    'git:get-staged-diff-bundle',
    async (args) => {
      return await queryGit(args, {
        operation: 'get-staged-diff-bundle',
        maxPatchChars: args.maxPatchChars
      })
    }
  )

  // ── History ──

  registerGitMessagePackHandler<GitTarget & { limit?: number; skip?: number }>(
    'git:get-commit-history',
    async (args) => {
      return await queryGit(args, {
        operation: 'get-commit-history',
        limit: args.limit,
        skip: args.skip
      })
    }
  )

  registerGitMessagePackHandler<GitTarget & { filePath: string; limit?: number; skip?: number }>(
    'git:get-file-history',
    async (args) => {
      return await queryGit(args, {
        operation: 'get-file-history',
        filePath: args.filePath,
        limit: args.limit,
        skip: args.skip
      })
    }
  )

  registerGitMessagePackHandler<GitTarget & { limit?: number }>(
    'git:commit-graph',
    async (args) => {
      return await queryGit(args, {
        operation: 'get-commit-graph',
        limit: args.limit
      })
    }
  )

  // ── Branches ──

  registerGitMessagePackHandler<GitTarget>('git:list-branches', async (args) => {
    return await queryGit(args, { operation: 'list-branches' })
  })

  registerGitMessagePackHandler<GitTarget & { name: string; startPoint?: string }>(
    'git:create-branch',
    async (args) => {
      const result = await execGit(
        ['branch', args.name, ...(args.startPoint ? [args.startPoint] : [])],
        args
      )
      if (!result.success) return fail(result, 'Failed to create branch')
      return okMutation(args, result)
    }
  )

  registerGitMessagePackHandler<GitTarget & { name: string }>(
    'git:checkout-branch',
    async (args) => {
      const result = await execGit(['checkout', args.name], args)
      if (!result.success) return fail(result, 'Failed to checkout branch')
      return okMutation(args, result)
    }
  )

  registerGitMessagePackHandler<GitTarget & { ref: string }>('git:merge-branch', async (args) => {
    const result = await execGit(['merge', '--no-edit', args.ref], args)
    if (!result.success) return fail(result, 'Failed to merge branch')
    return okMutation(args, result)
  })

  registerGitMessagePackHandler<GitTarget & { ref: string }>('git:rebase-branch', async (args) => {
    const result = await execGit(['rebase', args.ref], args)
    if (!result.success) return fail(result, 'Failed to rebase branch')
    return okMutation(args, result)
  })

  registerGitMessagePackHandler<GitTarget & { name: string; force?: boolean }>(
    'git:delete-local-branch',
    async (args) => {
      const result = await execGit(['branch', args.force ? '-D' : '-d', args.name], args)
      if (!result.success) return fail(result, 'Failed to delete local branch')
      return okMutation(args, result)
    }
  )

  registerGitMessagePackHandler<GitTarget & { remote: string; branchName: string }>(
    'git:delete-remote-branch',
    async (args) => {
      const result = await execGit(['push', args.remote, '--delete', args.branchName], args)
      if (!result.success) return fail(result, 'Failed to delete remote branch')
      return okMutation(args, result)
    }
  )

  registerGitMessagePackHandler<GitTarget & { oldName?: string; newName: string }>(
    'git:rename-branch',
    async (args) => {
      const cmd =
        args.oldName !== undefined && args.oldName !== ''
          ? ['branch', '-m', args.oldName, args.newName]
          : ['branch', '-m', args.newName]
      const result = await execGit(cmd, args)
      if (!result.success) return fail(result, 'Failed to rename branch')
      return okMutation(args, result)
    }
  )

  // ── Remote operations ──

  registerGitMessagePackHandler<GitTarget>('git:fetch', async (args) => {
    const result = await execGit(['fetch'], args)
    if (!result.success) return fail(result, 'Failed to fetch repository')
    return okMutation(args, result)
  })

  registerGitMessagePackHandler<GitTarget>('git:pull-rebase', async (args) => {
    const result = await execGit(['pull', '--rebase'], args)
    if (!result.success) return fail(result, 'Failed to pull --rebase')
    return okMutation(args, result)
  })

  registerGitMessagePackHandler<GitTarget>('git:push', async (args) => {
    const result = await execGit(['push'], args)
    if (!result.success) return fail(result, 'Failed to push repository')
    return okMutation(args, result)
  })

  // ── Staging ──

  registerGitMessagePackHandler<GitTarget & { paths: string[] }>(
    'git:stage-files',
    async (args) => {
      if (!args.paths.length) return ok({})
      const result = await execGit(['add', '--', ...args.paths], args)
      if (!result.success) return fail(result, 'Failed to stage files')
      return okMutation(args, result)
    }
  )

  registerGitMessagePackHandler<GitTarget & { paths: string[] }>(
    'git:unstage-files',
    async (args) => {
      if (!args.paths.length) return ok({})
      const result = await execGit(['restore', '--staged', '--', ...args.paths], args)
      if (!result.success) return fail(result, 'Failed to unstage files')
      return okMutation(args, result)
    }
  )

  registerGitMessagePackHandler<GitTarget>('git:stage-all', async (args) => {
    const result = await execGit(['add', '-A'], args)
    if (!result.success) return fail(result, 'Failed to stage all changes')
    return okMutation(args, result)
  })

  registerGitMessagePackHandler<GitTarget>('git:unstage-all', async (args) => {
    const result = await execGit(['reset', 'HEAD'], args)
    if (!result.success) return fail(result, 'Failed to unstage all changes')
    return okMutation(args, result)
  })

  // ── Discard ──

  registerGitMessagePackHandler<
    GitTarget & { paths: string[]; scope: 'worktree' | 'full' | 'untracked' }
  >('git:discard-files', async (args) => {
    if (!args.paths.length) return ok({})
    if (args.scope === 'untracked') {
      const result = await execGit(['clean', '-fd', '--', ...args.paths], args)
      if (!result.success) return fail(result, 'Failed to remove untracked files')
      return okMutation(args, result)
    }
    const restoreArgs =
      args.scope === 'full'
        ? ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...args.paths]
        : ['restore', '--worktree', '--', ...args.paths]
    const result = await execGit(restoreArgs, args)
    if (!result.success) return fail(result, 'Failed to discard changes')
    return okMutation(args, result)
  })

  // ── Commit ──

  registerGitMessagePackHandler<GitTarget & { message: string }>('git:commit', async (args) => {
    const message = args.message.trim()
    if (!message) {
      return { success: false, error: 'Commit message is required', errorType: 'UNKNOWN' }
    }
    const result = await execGit(['commit', '-m', message], args)
    if (!result.success) return fail(result, 'Failed to commit')
    return okMutation(args, result)
  })
}
