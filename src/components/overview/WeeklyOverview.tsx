import { MiniBlocks } from "@/components/overview/MiniBlocks";
import {
  REWARD_BLOCK_MINUTES,
  WORK_BLOCK_WORK_MINUTES,
  type WeeklyEconomyDay,
} from "@/lib/economy";
import { exercisePalette, penaltyPalette, rewardPalette, timerPalette } from "@/lib/timerPalette";

type WeeklyOverviewProps = {
  days: WeeklyEconomyDay[];
};

function formatTimeLabel(totalMinutes: number) {
  const roundedMinutes = Math.round(Math.abs(totalMinutes));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  const prefix = totalMinutes < 0 && roundedMinutes > 0 ? "-" : "";

  if (hours === 0) {
    return `${prefix}${minutes}m`;
  }

  return minutes === 0 ? `${prefix}${hours}h` : `${prefix}${hours}h ${minutes}m`;
}

function CategoryRow({
  children,
  label,
  totalMinutes,
  withRule = false,
}: {
  children: React.ReactNode;
  label: string;
  totalMinutes: number;
  withRule?: boolean;
}) {
  return (
    <section className={withRule ? "border-t border-slate-200/80 pt-5" : undefined}>
      <div className="grid grid-cols-[4.5rem_repeat(7,minmax(3.5rem,1fr))] gap-x-4">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-xs font-medium text-slate-700">{formatTimeLabel(totalMinutes)}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

function DayBlocks({ children, minutes }: { children: React.ReactNode; minutes: number }) {
  return (
    <div className="flex min-h-14 flex-col items-start justify-between gap-2">
      <div className="min-h-8">{children}</div>
      <p className="text-[11px] tabular-nums text-slate-400">{formatTimeLabel(minutes)}</p>
    </div>
  );
}

export function WeeklyOverview({ days }: WeeklyOverviewProps) {
  const totals = days.reduce(
    (result, day) => ({
      exercise: result.exercise + day.exerciseMinutes,
      penalty: result.penalty + day.penaltyMinutes,
      rewardWork: result.rewardWork + day.rewardWorkMinutes,
      work: result.work + day.workMinutes,
    }),
    { exercise: 0, penalty: 0, rewardWork: 0, work: 0 },
  );

  return (
    <div className="overflow-x-auto pb-1">
      <div className="min-w-[42rem] space-y-5">
        <div className="grid grid-cols-[4.5rem_repeat(7,minmax(3.5rem,1fr))] gap-x-4">
          <span />
          {days.map((day) => (
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-400" key={day.date}>
              {day.dayLabel}
            </p>
          ))}
        </div>

        <CategoryRow label="Work" totalMinutes={totals.work}>
          {days.map((day) => (
            <DayBlocks key={day.date} minutes={day.workMinutes}>
              <MiniBlocks
                color={timerPalette.work.progress}
                layout="two-column"
                minutes={day.workMinutes}
                minutesPerBlock={WORK_BLOCK_WORK_MINUTES}
              />
            </DayBlocks>
          ))}
        </CategoryRow>

        <CategoryRow label="Reward" totalMinutes={totals.rewardWork + totals.exercise} withRule>
          {days.map((day) => {
            const destroyedWorkMinutes = Math.min(day.penaltyMinutes, day.rewardWorkMinutes);
            const destroyedExerciseMinutes = Math.min(
              Math.max(0, day.penaltyMinutes - destroyedWorkMinutes),
              day.exerciseMinutes,
            );
            const rewardTotal = day.rewardWorkMinutes + day.exerciseMinutes;

            return (
              <DayBlocks key={day.date} minutes={rewardTotal}>
                <div className="inline-grid grid-cols-2 gap-[2px]">
                  <MiniBlocks
                    color={rewardPalette.progress}
                    destroyedMinutes={destroyedWorkMinutes}
                    layout="contents"
                    minutes={day.rewardWorkMinutes}
                    minutesPerBlock={REWARD_BLOCK_MINUTES}
                  />
                  <MiniBlocks
                    color={exercisePalette.progress}
                    destroyedMinutes={destroyedExerciseMinutes}
                    layout="contents"
                    minutes={day.exerciseMinutes}
                    minutesPerBlock={REWARD_BLOCK_MINUTES}
                  />
                </div>
              </DayBlocks>
            );
          })}
        </CategoryRow>

        <CategoryRow label="Penalty" totalMinutes={totals.penalty} withRule>
          {days.map((day) => (
            <DayBlocks key={day.date} minutes={day.penaltyMinutes}>
              <MiniBlocks
                color={penaltyPalette.progress}
                layout="two-column"
                minutes={day.penaltyMinutes}
                minutesPerBlock={REWARD_BLOCK_MINUTES}
              />
            </DayBlocks>
          ))}
        </CategoryRow>
      </div>
    </div>
  );
}
