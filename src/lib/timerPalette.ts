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
