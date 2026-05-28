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

export type TaskStatus = "open" | "in_progress" | "blocked" | "completed" | "archived";

export type TaskPriority = "low" | "medium" | "high" | "critical";

export type TaskActorType = "human" | "agent" | "system";

export type TaskAgentPayload = {
  acceptance_criteria?: string[];
  background?: string;
  constraints?: string[];
  decision_log?: string[];
  dependencies?: string[];
  objective?: string;
  open_questions?: string[];
  related_entities?: string[];
  tags?: string[];
};

export type Task = {
  id: string;
  user_id: string;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  area: string | null;
  due_at: string | null;
  source: string;
  completed_at: string | null;
  archived_at: string | null;
  last_seen_at: string | null;
  human_summary: string | null;
  agent_payload_json: TaskAgentPayload;
  schema_version: number;
  updated_by_actor_type: TaskActorType;
  updated_by_actor_label: string | null;
  last_change_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskRevisionActionType =
  | "created"
  | "updated"
  | "completed"
  | "reopened"
  | "archived"
  | "restored";

export type TaskRevision = {
  id: string;
  task_id: string;
  user_id: string;
  action_type: TaskRevisionActionType;
  actor_type: TaskActorType;
  actor_label: string | null;
  change_reason: string | null;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown>;
  created_at: string;
};

export type DailyFocusStatus = "planned" | "active" | "done" | "deferred";

export type DailyFocusList = {
  id: string;
  user_id: string;
  date: string;
  created_at: string;
  updated_at: string;
};

export type DailyFocusItem = {
  id: string;
  daily_focus_list_id: string;
  task_id: string;
  position: number;
  focus_status: DailyFocusStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type DailyFocusItemWithTask = DailyFocusItem & {
  task: Task;
};

export type WorkBlockAttribution = {
  id: string;
  user_id: string;
  work_block_id: string;
  task_id: string;
  attribution_label: string;
  share_ratio: number;
  attributed_minutes: number;
  created_at: string;
};
