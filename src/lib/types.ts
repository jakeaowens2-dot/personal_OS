export type TimerMode = "work" | "break" | "long_break";

export type TimerSession = {
  id: string;
  user_id: string;
  mode: TimerMode;
  planned_minutes: number;
  started_at: string | null;
  ended_at: string | null;
  completed: boolean;
  interrupted: boolean;
  notes: string | null;
};

export type WorkBlock = {
  id: string;
  user_id: string;
  timer_session_id: string;
  earned_at: string;
  duration_minutes: number;
  tag: string | null;
  quality_rating: number | null;
};

export type LedgerEventType = "work_earned" | "reward_spent" | "correction" | "bonus";

export type LedgerEvent = {
  id: string;
  user_id: string;
  event_type: LedgerEventType;
  delta_work_blocks: number;
  delta_reward_blocks: number;
  source: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type RewardRule = {
  id: string;
  user_id: string;
  name: string;
  cost_work_blocks: number;
  reward_minutes: number;
  active: boolean;
  created_at?: string;
};

export type RewardRedemption = {
  id: string;
  user_id: string;
  reward_rule_id: string;
  reward_name: string;
  cost_work_blocks: number;
  redeemed_at: string;
  notes: string | null;
};
