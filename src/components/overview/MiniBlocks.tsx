import { decomposeMinutes } from "@/lib/economy";
import { destroyedRewardPalette } from "@/lib/timerPalette";

type MiniBlocksProps = {
  minutes: number;
  minutesPerBlock: number;
  color: string;
  destroyedMinutes?: number;
  lightColor?: string;
  layout?: "contents" | "inline" | "two-column";
  variant?: "solid" | "outline";
  maxBlocks?: number;
  fillMinutes?: number;
};

// Renders 1-hour blocks with partial support. A partial block uses a light fill for
// the full block area and a dark fill proportional to block progress.
export function MiniBlocks({
  minutes,
  minutesPerBlock,
  color,
  destroyedMinutes = 0,
  lightColor,
  layout = "inline",
  variant = "solid",
  maxBlocks = 18,
  fillMinutes = 0,
}: MiniBlocksProps) {
  // --- Debt ("outline") variant -------------------------------------------------
  // The overdraw is an empty glass: a fixed-size dashed frame that fills up with
  // solid reward as it is repaid, instead of shrinking. Blocks are filled left to
  // right; a block that reaches 100% disappears (the debt it represented is paid),
  // and any surplus reward is rendered as regular solid blocks by the caller once
  // the debt clears.
  if (variant === "outline") {
    const frameTotal = Math.max(0, minutes);
    const fillTotal = Math.max(0, Math.min(fillMinutes, frameTotal));

    if (frameTotal === 0) {
      return null;
    }

    const totalBlocks = Math.ceil(frameTotal / minutesPerBlock);
    const blocks: Array<{ frameRatio: number; fillRatio: number }> = [];

    for (let i = 0; i < totalBlocks; i++) {
      const blockStart = i * minutesPerBlock;
      const blockSize = Math.min(minutesPerBlock, frameTotal - blockStart);
      const frameRatio = blockSize / minutesPerBlock;
      const fillInBlock = Math.max(0, Math.min(fillTotal - blockStart, blockSize));
      const fillRatio = fillInBlock / blockSize;

      if (fillRatio >= 1) {
        // Fully repaid -> this debt block disappears.
        continue;
      }

      blocks.push({ frameRatio, fillRatio });
    }

    const rendered = blocks.slice(0, maxBlocks);
    const overflow = blocks.length - rendered.length;

    return (
      <span className="inline-flex flex-wrap items-center gap-[2px]">
        {rendered.map(({ frameRatio, fillRatio }, index) => {
          const groupBoundary = index > 0 && index % 3 === 0;
          const spacing = groupBoundary ? "ml-[9px]" : "";

          return (
            <span
              key={index}
              className={`relative inline-block overflow-hidden rounded-[2px] ${spacing}`}
              style={{ width: 15 * frameRatio, height: 15 }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0"
                style={{ border: `1px dashed ${color}`, borderRadius: "2px" }}
              />
              {fillRatio > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0"
                  style={{ backgroundColor: color, width: `${fillRatio * 100}%` }}
                />
              ) : null}
            </span>
          );
        })}
        {overflow > 0 ? <span className="text-xs text-slate-500">+{overflow}</span> : null}
      </span>
    );
  }

  // --- Solid blocks -------------------------------------------------------------
  const { fullBlocks, partialRatio } = decomposeMinutes(minutes, minutesPerBlock);
  const hasPartial = partialRatio > 0;
  const totalBlocks = fullBlocks + (hasPartial ? 1 : 0);

  if (totalBlocks === 0) {
    return null;
  }

  const rendered: Array<{ kind: "full" | "partial"; destroyed: boolean }> = [];
  for (let i = 0; i < fullBlocks && rendered.length < maxBlocks; i++) {
    rendered.push({
      kind: "full",
      destroyed: destroyedMinutes > i * minutesPerBlock,
    });
  }
  if (hasPartial && rendered.length < maxBlocks) {
    rendered.push({
      kind: "partial",
      destroyed: destroyedMinutes > fullBlocks * minutesPerBlock,
    });
  }
  const overflow = totalBlocks - rendered.length;

  const light = lightColor ?? `${color}40`;

  return (
    <span
      className={
        layout === "contents"
          ? "contents"
          : layout === "two-column"
          ? "inline-grid grid-cols-2 gap-[2px]"
          : "inline-flex flex-wrap items-center gap-[2px]"
      }
    >
      {rendered.map(({ kind, destroyed }, index) => {
        const groupBoundary = layout === "inline" && index > 0 && index % 3 === 0;
        const spacing = groupBoundary ? "ml-[9px]" : "";
        const base = "relative inline-flex h-[15px] w-[15px] overflow-hidden rounded-[2px]";

        return (
          <span
            key={index}
            className={`${base} ${spacing}`}
            style={{ backgroundColor: kind === "full" ? color : light }}
          >
            {kind === "partial" ? (
              <span
                className="absolute inset-y-0 left-0"
                style={{ backgroundColor: color, width: `${partialRatio * 100}%` }}
              />
            ) : null}
            {destroyed ? (
              <span
                aria-label="Reward wiped out by penalty"
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  backgroundColor: destroyedRewardPalette.overlay,
                  boxShadow: `inset 0 0 0 1px ${destroyedRewardPalette.border}`,
                }}
              >
                <span
                  aria-hidden="true"
                  className="text-[10px] font-bold leading-none"
                  style={{ color: destroyedRewardPalette.mark }}
                >
                  ✕
                </span>
              </span>
            ) : null}
          </span>
        );
      })}
      {overflow > 0 ? <span className="text-xs text-slate-500">+{overflow}</span> : null}
    </span>
  );
}
