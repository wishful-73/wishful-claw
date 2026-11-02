// 更新说明回填断言（S-234）：下载中回填不得重置进度、重复写入为 no-op。
// 拆分自 program.ts（S-252，2026-10-28），断言本体逐字平移。
import assert from 'node:assert/strict'
import {
  check,
  NEXT_VERSION,
  createHarness,
  reachAvailable,
  startDownload
} from '../harness'

// ---------------------------------------------------------------- release notes back-fill (S-234)
//
// The notes have two sources and only the asynchronous one ever has content, because the manifest
// stopped carrying `releaseNotes` in 0.2.39. These checks pin down that the late copy reaches the
// snapshot — re-opening the dialog reads the snapshot, so an event-only result disappears there.

check('back-filled release notes reach the snapshot', () => {
  const coordinator = createHarness().coordinator
  assert.equal(coordinator.beginCheck(), true)
  assert.equal(
    coordinator.applyAvailable({ newVersion: NEXT_VERSION, releaseNotes: '' }),
    true,
    'an offer without inline notes is still an offer'
  )
  assert.equal(coordinator.snapshot().releaseNotes, '', 'the offer alone carries no notes')

  assert.equal(coordinator.applyReleaseNotes(NEXT_VERSION, '## 1.0.3'), true)
  assert.equal(
    coordinator.snapshot().releaseNotes,
    '## 1.0.3',
    'the website copy must be readable from the snapshot'
  )
})

check('an empty back-fill never clears the notes it already has', () => {
  const coordinator = createHarness().coordinator
  reachAvailable(coordinator)

  assert.equal(coordinator.applyReleaseNotes(NEXT_VERSION, ''), false, 'a failed fetch is not an erasure')
  assert.equal(coordinator.snapshot().releaseNotes, '## Notes', 'existing notes survive')
})

check('back-fill refuses notes for a different version', () => {
  const coordinator = createHarness().coordinator
  reachAvailable(coordinator)

  assert.equal(coordinator.applyReleaseNotes('9.9.9', '## stale'), false)
  assert.equal(
    coordinator.snapshot().releaseNotes,
    '## Notes',
    'a slow fetch must not land under a newer offer'
  )
})

check('back-fill leaves the phase and the progress alone', () => {
  const coordinator = createHarness().coordinator
  reachAvailable(coordinator)
  const operationId = startDownload(coordinator)
  coordinator.applyProgress(operationId, { percent: 42 })

  const before = coordinator.snapshot()
  assert.equal(coordinator.applyReleaseNotes(NEXT_VERSION, '## arrived'), true)
  const after = coordinator.snapshot()

  assert.equal(after.releaseNotes, '## arrived')
  assert.equal(after.phase, 'downloading', 'the phase must not move')
  assert.equal(after.percent, before.percent, 'the progress must not be reset')
  assert.equal(after.operationId, before.operationId)
  assert.equal(
    coordinator.applyReleaseNotes(NEXT_VERSION, '## arrived'),
    false,
    'writing the same body twice is a no-op'
  )
})

// -------------------------------------------------- a re-check keeps the notes it already has (S-298)
//
// The manifest has carried no `releaseNotes` since 0.2.39, so `update-available` arrives with '' on
// every ordinary check. Writing that unconditionally wiped the fetched copy, and the only way back
// was one best-effort fetch — so a single timeout left the dialog empty for the rest of the cycle,
// which is exactly what "re-open the dialog and the notes are gone" looked like.

check('a repeat check of the same offer keeps the fetched notes', () => {
  const coordinator = createHarness().coordinator
  assert.equal(coordinator.beginCheck(), true)
  assert.equal(coordinator.applyAvailable({ newVersion: NEXT_VERSION, releaseNotes: '' }), true)
  assert.equal(coordinator.applyReleaseNotes(NEXT_VERSION, '## 1.0.6'), true)

  assert.equal(coordinator.beginCheck(), true, 'a periodic re-check is accepted')
  assert.equal(
    coordinator.applyAvailable({ newVersion: NEXT_VERSION, releaseNotes: '' }),
    true,
    'the same offer is still an offer'
  )
  assert.equal(
    coordinator.snapshot().releaseNotes,
    '## 1.0.6',
    'the same version carries the same notes — an empty re-check must not erase them'
  )
})

check('a new offer never inherits the previous release notes', () => {
  const coordinator = createHarness().coordinator
  reachAvailable(coordinator)
  assert.equal(coordinator.applyReleaseNotes(NEXT_VERSION, '## 0.2.26'), true)

  assert.equal(coordinator.beginCheck(), true)
  assert.equal(
    coordinator.applyAvailable({ newVersion: '0.2.27', releaseNotes: '' }),
    true,
    'a newer version is a new offer'
  )
  assert.equal(
    coordinator.snapshot().releaseNotes,
    '',
    "the previous release's notes must not appear under a new version"
  )
})

check('inline notes still win over whatever was there', () => {
  const coordinator = createHarness().coordinator
  reachAvailable(coordinator)

  assert.equal(coordinator.beginCheck(), true)
  assert.equal(
    coordinator.applyAvailable({ newVersion: NEXT_VERSION, releaseNotes: '## inline' }),
    true
  )
  assert.equal(coordinator.snapshot().releaseNotes, '## inline')
})
