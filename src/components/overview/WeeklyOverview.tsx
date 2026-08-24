import { MiniBlocks } from "@/components/overview/MiniBlocks";
import { REWARD_BLOCK_MINUTES, WORK_BLOCK_WORK_MINUTES } from "@/lib/economy";
import { exercisePalette, penaltyPalette, rewardPalette, timerPalette } from "@/lib/timerPalette";

type WeeklyOverviewProps = {
  workMinutes: number;
  rewardWorkMinutes: number;
  exerciseMinutes: number;
  penaltyMinutes: number;
};

function formatHoursLabel(totalMinutes: number) {
  const absolute = Math.ceil(Math.abs(totalMinutes));
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  const prefix = totalMinutes < 0 ? "-" : "";

  if (hours === 0) {
    return `${prefix}${minutes}m`;
  }

  return `${prefix}${hours}h ${minutes}m`;
}

export function WeeklyOverview({
  workMinutes,
  rewardWorkMinutes,
  exerciseMinutes,
  penaltyMinutes,
}: WeeklyOverviewProps) {
  const rewardTotalMinutes = rewardWorkMinutes + exerciseMinutes;
  const rewardNetMinutes = rewardTotalMinutes - penaltyMinutes;
  const destroyedMinutes = Math.min(penaltyMinutes, rewardTotalMinutes);

  return (
    <div className="grid gap-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-slate-500">Work</p>
          <p className="text-sm font-medium text-slate-900">{formatHoursLabel(workMinutes)}</p>
        </div>
        <MiniBlocks
          color={timerPalette.work.progress}
          minutes={workMinutes}
          minutesPerBlock={WORK_BLOCK_WORK_MINUTES}
        />
      </div>

      <div className="space-y-2 border-t border-slate-200/80 pt-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-slate-500">Reward</p>
          <p className="text-sm font-medium text-slate-900">
            <span>total: {formatHoursLabel(rewardTotalMinutes)}</span>
            <span className="mx-2 text-slate-300">·</span>
            <span>net: {formatHoursLabel(rewardNetMinutes)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MiniBlocks
            color={rewardPalette.progress}
            minutes={rewardWorkMinutes}
            minutesPerBlock={REWARD_BLOCK_MINUTES}
          />
          <MiniBlocks
            color={exercisePalette.progress}
            minutes={exerciseMinutes}
            minutesPerBlock={REWARD_BLOCK_MINUTES}
          />
          {destroyedMinutes > 0 ? (
            <MiniBlocks
              color={rewardPalette.progress}
              minutes={destroyedMinutes}
              minutesPerBlock={REWARD_BLOCK_MINUTES}
              variant="destroyed"
            />
          ) : null}
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-200/80 pt-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-slate-500">Penalty</p>
          <p className="text-sm font-medium text-slate-900">{formatHoursLabel(penaltyMinutes)}</p>
        </div>
        <MiniBlocks
          color={penaltyPalette.progress}
          minutes={penaltyMinutes}
          minutesPerBlock={REWARD_BLOCK_MINUTES}
        />
      </div>
    </div>
  );
}
