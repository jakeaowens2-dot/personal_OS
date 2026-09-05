import type { TimerMode } from "@/lib/types";

export const timerPalette = {
  work: {
    progress: "#B43244",
    backgroundActive: "#D66B75",
    central: "#F4A7AF",
    backgroundInactive: "#FFF3F4",
    glow: "#FFE1E5",
  },
  break: {
    progress: "#0F6B6D",
    backgroundActive: "#1FA2A8",
    central: "#7EDAD7",
    backgroundInactive: "#F1FBFB",
    glow: "#DDF5F5",
  },
  long_break: {
    progress: "#7448A6",
    backgroundActive: "#BC89DD",
    central: "#E5D9F5",
    backgroundInactive: "#FBF7FE",
    glow: "#EFE7FB",
  },
} as const satisfies Record<
  TimerMode,
  {
    progress: string;
    backgroundActive: string;
    central: string;
    backgroundInactive: string;
    glow: string;
  }
>;

export const rewardPalette = {
  progress: "#1D4F91",
  backgroundActive: "#2D71DB",
  central: "#9FC6F6",
  backgroundInactive: "#F3F8FF",
  glow: "#E3EEFF",
} as const;

// Behavior tracking accents: exercise (positive) reads as periwinkle, penalties as purple.
export const exercisePalette = {
  progress: "#7B8FD8",
} as const;

export const penaltyPalette = {
  progress: "#7C3AED",
  border: "#7C3AED",
} as const;

// Penalty consequence treatment overlaid on earned reward blocks.
export const destroyedRewardPalette = {
  overlay: "rgba(241, 238, 246, 0.72)",
  border: "#7C3AED",
  mark: "#7C3AED",
} as const;
