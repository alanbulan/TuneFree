export type MiraFrame = {
  row: number;
  col: number;
  index: number;
  key: string;
};

export type MiraAction = {
  name: string;
  frames: MiraFrame[];
  frameDurations: number[];
};

export type MiraMood = "empty" | "loading" | "playing" | "paused" | "celebrate";

export const MIRA_SPRITESHEET_URL = "/pets/mira/spritesheet.webp";
export const MIRA_FRAME_WIDTH = 192;
export const MIRA_FRAME_HEIGHT = 208;
export const MIRA_SHEET_COLUMNS = 8;
export const MIRA_SHEET_ROWS = 9;

const range = (start: number, end: number): number[] =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index);

const frame = (row: number, col: number): MiraFrame => {
  const index = row * MIRA_SHEET_COLUMNS + col;
  return { row, col, index, key: `${row}:${col}` };
};

const rowFrames = (row: number, usedColumns: number): MiraFrame[] =>
  range(0, usedColumns - 1).map((col) => frame(row, col));

const durations = (count: number, duration: number, finalDuration = duration): number[] =>
  range(0, count - 1).map((index) => (index === count - 1 ? finalDuration : duration));

const makeAction = (
  name: string,
  row: number,
  usedColumns: number,
  frameDurations: number[],
): MiraAction => ({
  name,
  frames: rowFrames(row, usedColumns),
  frameDurations,
});

export const MIRA_ACTIONS = {
  idle: makeAction("idle", 0, 6, [280, 110, 110, 140, 140, 320]),
  running_right: makeAction("running-right", 1, 8, durations(8, 120, 220)),
  running_left: makeAction("running-left", 2, 8, durations(8, 120, 220)),
  waving: makeAction("waving", 3, 4, durations(4, 140, 280)),
  jumping: makeAction("jumping", 4, 5, durations(5, 140, 280)),
  failed: makeAction("failed", 5, 8, durations(8, 140, 240)),
  waiting: makeAction("waiting", 6, 6, durations(6, 150, 260)),
  running: makeAction("running", 7, 6, durations(6, 120, 220)),
  review: makeAction("review", 8, 6, durations(6, 150, 280)),
} as const;

export type MiraActionName = keyof typeof MIRA_ACTIONS;

export const MIRA_ACTION_POOLS: Record<MiraMood, MiraActionName[]> = {
  empty: ["idle", "waiting", "waving", "failed"],
  loading: ["running", "review", "jumping"],
  playing: ["running", "waving", "jumping"],
  paused: ["idle", "waiting", "review"],
  celebrate: ["waving", "jumping"],
};

export const MIRA_ALL_USABLE_FRAMES = Object.values(MIRA_ACTIONS).flatMap((action) => action.frames);

export const validateMiraActionCoverage = () => {
  const expected = new Set<string>();

  Object.values(MIRA_ACTIONS).forEach((action) => {
    action.frames.forEach((item) => expected.add(item.key));
  });

  const used = new Set<string>();
  Object.values(MIRA_ACTIONS).forEach((action) => {
    action.frames.forEach((item) => used.add(item.key));
  });

  const missing = [...expected].filter((key) => !used.has(key));
  const extra = [...used].filter((key) => !expected.has(key));
  const result = {
    totalUsable: expected.size,
    totalUsed: used.size,
    missing,
    extra,
  };

  if (missing.length > 0 || extra.length > 0 || used.size !== expected.size) {
    console.warn("[MiraPet] action coverage mismatch", result);
  } else {
    console.info("[MiraPet] action coverage complete", result);
  }

  return result;
};
