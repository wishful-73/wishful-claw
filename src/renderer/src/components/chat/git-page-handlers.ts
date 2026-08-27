import { useCallback } from 'react'
import { toast } from 'sonner'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import { normalizeLanguageCode } from '@renderer/lib/i18n-language'
import { generateCommitMessageFromStagedDiff } from '@renderer/lib/git/generate-commit-message'
import {
  useGitStore,
  type GitBranchItem,
  type GitCommitHistoryItem,
} from '@renderer/stores/git-store'
import { type ScmFileRow, parseRemoteBranchName } from './GitPage/utils'
import type { TFunction } from 'i18next'

interface GitPageHandlersOptions {
  selectedRepoPath: string | null
  newBranchName: string
  commitMessage: string
  branchNameDialog: { mode: 'createFrom'; startPoint: string } | { mode: 'rename'; oldName: string | null; displayName: string } | null
  branchNameInput: string
  selectedRow: ScmFileRow | null
  stagedRows: ScmFileRow[]
  details: ReturnType<typeof useGitStore.getState>['repoDetailsByPath'][string] | null
  setNewBranchName: (v: string) => void
  setCommitMessage: (v: string) => void
  setCommitting: (v: boolean) => void
  setAiCommitLoading: (v: boolean) => void
  setBranchNameDialog: (v: { mode: 'createFrom'; startPoint: string } | { mode: 'rename'; oldName: string | null; displayName: string } | null) => void
  setBranchNameInput: (v: string) => void
  setHistoryPick: (v: { path: string; hash: string } | null) => void
  setHistoryPatchLoading: (v: boolean) => void
  t: TFunction
  i18n: { language: string }
}

export function useGitPageHandlers(opts: GitPageHandlersOptions) {
  const {
    selectedRepoPath,
    newBranchName,
    commitMessage,
    branchNameDialog,
    branchNameInput,
    selectedRow,
    stagedRows,
    details,
    setNewBranchName,
    setCommitMessage,
    setCommitting,
    setAiCommitLoading,
    setBranchNameDialog,
    setBranchNameInput,
    setHistoryPick,
    setHistoryPatchLoading,
    t,
    i18n
  } = opts

  const store = useGitStore()

  const handlePullRebase = async (): Promise<void> => {
    if (!selectedRepoPath) return
    const result = await store.pullRebase(selectedRepoPath)
    if (!result.success) toast.error(result.error)
  }

  const handleSync = async (): Promise<void> => {
    if (!selectedRepoPath) return
    const result = await store.syncRepository(selectedRepoPath)
    if (!result.success) toast.error(result.error)
    else toast.success(t('syncDone'))
  }

  const handleFetch = async (): Promise<void> => {
    if (!selectedRepoPath) return
    const result = await store.fetchRepository(selectedRepoPath)
    if (!result.success) toast.error(result.error)
    else toast.success(t('fetchDone'))
  }

  const handlePush = async (): Promise<void> => {
    if (!selectedRepoPath) return
    const result = await store.pushRepository(selectedRepoPath)
    if (!result.success) toast.error(result.error)
    else toast.success(t('pushDone'))
  }

  const handleCreateBranch = async (repoPath: string): Promise<void> => {
    if (!newBranchName.trim()) return
    const result = await store.createBranch(repoPath, newBranchName.trim())
    if (!result.success) {
      toast.error(result.error)
      return
    }
    setNewBranchName('')
    toast.success(t('branchCreated'))
  }

  const runMergeInto = async (ref: string): Promise<void> => {
    if (!selectedRepoPath) return
    const result = await store.mergeBranch(selectedRepoPath, ref)
    if (!result.success) toast.error(result.error)
    else toast.success(t('branchMergeDone'))
  }

  const runRebaseOnto = async (ref: string): Promise<void> => {
    if (!selectedRepoPath) return
    const result = await store.rebaseBranch(selectedRepoPath, ref)
    if (!result.success) toast.error(result.error)
    else toast.success(t('branchRebaseDone'))
  }

  const runDeleteLocal = async (name: string, force: boolean): Promise<void> => {
    if (!selectedRepoPath) return
    const title = force
      ? t('branchDeleteLocalForceConfirm', { name })
      : t('branchDeleteLocalConfirm', { name })
    const ok = await confirm({
      title,
      variant: 'destructive',
      confirmLabel: t('branchDeleteConfirmAction')
    })
    if (!ok) return
    const result = await store.deleteLocalBranch(selectedRepoPath, name, force)
    if (!result.success) toast.error(result.error)
    else toast.success(force ? t('branchDeleteLocalForceDone') : t('branchDeleteLocalDone'))
  }

  const runDeleteRemote = async (branch: GitBranchItem): Promise<void> => {
    if (!selectedRepoPath) return
    const parsed = parseRemoteBranchName(branch.name)
    if (!parsed) {
      toast.error(t('branchDeleteRemoteInvalid'))
      return
    }
    const ok = await confirm({
      title: t('branchDeleteRemoteConfirm', { name: branch.name }),
      variant: 'destructive',
      confirmLabel: t('branchDeleteConfirmAction')
    })
    if (!ok) return
    const result = await store.deleteRemoteBranch(selectedRepoPath, parsed.remote, parsed.branchName)
    if (!result.success) toast.error(result.error)
    else toast.success(t('branchDeleteRemoteDone'))
  }

  const handleBranchDialogConfirm = async (): Promise<void> => {
    const name = branchNameInput.trim()
    if (!name || !selectedRepoPath || !branchNameDialog) return
    if (branchNameDialog.mode === 'createFrom') {
      const result = await store.createBranch(selectedRepoPath, name, branchNameDialog.startPoint)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(t('branchCreated'))
    } else {
      const result = await store.renameBranch(
        selectedRepoPath,
        name,
        branchNameDialog.oldName ?? undefined
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(t('branchRenameDone'))
    }
    setBranchNameDialog(null)
    setBranchNameInput('')
  }

  const handleCommit = async (): Promise<void> => {
    if (!selectedRepoPath || !commitMessage.trim()) return
    setCommitting(true)
    try {
      const result = await store.commit(selectedRepoPath, commitMessage.trim())
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setCommitMessage('')
      toast.success(t('commitDone'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCommitting(false)
    }
  }

  const handleAiCommitMessage = useCallback(async (): Promise<void> => {
    if (!selectedRepoPath || stagedRows.length === 0) {
      toast.error(t('aiCommitNeedStaged'))
      return
    }
    setAiCommitLoading(true)
    const bundle = await store.getStagedDiffBundle(selectedRepoPath)
    if (!bundle.success) {
      setAiCommitLoading(false)
      toast.error(bundle.error)
      return
    }
    if (bundle.empty) {
      setAiCommitLoading(false)
      toast.error(t('aiCommitEmptyStaged'))
      return
    }
    const lang = normalizeLanguageCode(i18n.language)
    const status = details?.status
    const msg = await generateCommitMessageFromStagedDiff(
      bundle.stat,
      bundle.patch,
      lang,
      status?.branch,
      undefined,
      selectedRepoPath
    )
    setAiCommitLoading(false)
    if (!msg) {
      toast.error(t('aiCommitFailed'))
      return
    }
    setCommitMessage(msg)
  }, [store, i18n.language, selectedRepoPath, stagedRows.length, details?.status, t, setAiCommitLoading, setCommitMessage])

  const handleHistoryCommitClick = async (commit: GitCommitHistoryItem): Promise<void> => {
    if (!selectedRepoPath || !selectedRow || selectedRow.section === 'untracked') return
    const cacheKey = `${commit.hash}:${selectedRow.path}`
    const cacheHit = details?.historyFileDiffByKey[cacheKey] !== undefined
    if (cacheHit) {
      setHistoryPick({ path: selectedRow.path, hash: commit.hash })
      return
    }
    setHistoryPatchLoading(true)
    setHistoryPick({ path: selectedRow.path, hash: commit.hash })
    const result = await store.loadHistoryFileDiff(selectedRepoPath, selectedRow.path, commit.hash)
    setHistoryPatchLoading(false)
    if (!result.success) setHistoryPick(null)
  }

  const confirmDiscard = async (row: ScmFileRow): Promise<void> => {
    const ok = await confirm({
      title: t('discardConfirmTitle'),
      description: t('discardConfirmDesc', { path: row.path }),
      confirmLabel: t('discardConfirmAction'),
      variant: 'destructive'
    })
    if (!ok) return
    if (!selectedRepoPath) return
    const scope =
      row.section === 'untracked' ? 'untracked' : row.section === 'staged' ? 'full' : 'worktree'
    const result = await store.discardFiles(selectedRepoPath, [row.path], scope)
    if (!result.success) toast.error(result.error)
  }

  return {
    handlePullRebase,
    handleSync,
    handleFetch,
    handlePush,
    handleCreateBranch,
    runMergeInto,
    runRebaseOnto,
    runDeleteLocal,
    runDeleteRemote,
    handleBranchDialogConfirm,
    handleCommit,
    handleAiCommitMessage,
    handleHistoryCommitClick,
    confirmDiscard
  }
}
