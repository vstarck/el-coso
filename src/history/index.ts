// Public surface of the history layer. See `types.ts` for the data shapes
// and `history.ts` for the free functions.
export {
  createHistory,
  historyTick,
  historyAdvance,
  historyReset,
  historyStateAt,
  historyAnnotate,
  historyBranchFrom,
  historySetActiveBranch,
  historyTruncate,
  historyDescendantsForkedPast,
  historyActiveBranch,
  historyListBranches,
  historyLineageCommits,
  historyEditConfig,
} from "./history";
export { levelSeed } from "./level-seed";
export { tapeShare, tapeRestore, tapeSetPath, tapeDiff, tapeApply, type TapeOp, type TapePatch } from "./config-tape";
export type {
  Branch,
  BranchId,
  Commit,
  History,
  HistoryAdapter,
  InputEntry,
  Keyframe,
  ReadonlyState,
  ResolverMode,
  TickedState,
} from "./types";
