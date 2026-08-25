"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmailAuthPanel, type EmailAuthPanelState } from "@/components/auth/EmailAuthPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TaskPriorityLabel } from "@/components/ui/TaskPriorityLabel";
import {
  addTaskToDailyFocus,
  archiveTask,
  completeDailyFocusItem,
  completeTask,
  createTask,
  dropDailyFocusItem,
  fetchDailyFocusItems,
  fetchImmediateChildTasks,
  fetchTaskRevisions,
  fetchTasks,
  fetchTasksByIds,
  moveDailyFocusItem,
  removeTaskFromDailyFocus,
  restoreTask,
  TASK_STATUS_LABEL,
  updateTask,
} from "@/lib/tasks";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AUTH_REQUIRED_MESSAGE, ensureWorkspaceUser } from "@/lib/workspace";
import type { DailyFocusItemWithTask, Task, TaskPriority, TaskRevision, TaskStatus } from "@/lib/types";

type PageState =
  | { kind: "connecting"; message: string }
  | { kind: "auth_required"; message: string }
  | { kind: "ready"; message: string }
  | { kind: "saving"; message: string }
  | { kind: "error"; message: string };

type TaskEditorState = {
  agentPayloadText: string;
  area: string;
  changeReason: string;
  description: string;
  dueAtLocal: string;
  humanSummary: string;
  priority: TaskPriority;
  status: TaskStatus;
  title: string;
};

type NewTaskState = {
  area: string;
  humanSummary: string;
  priority: TaskPriority;
  title: string;
};

const INITIAL_NEW_TASK_STATE: NewTaskState = {
  area: "",
  humanSummary: "",
  priority: "medium",
  title: "",
};

function toDateTimeLocalValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return offsetDate.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

function createEditorState(task: Task): TaskEditorState {
  return {
    agentPayloadText: JSON.stringify(task.agent_payload_json ?? {}, null, 2),
    area: task.area ?? "",
    changeReason: "",
    description: task.description ?? "",
    dueAtLocal: toDateTimeLocalValue(task.due_at),
    humanSummary: task.human_summary ?? "",
    priority: task.priority,
    status: task.status,
    title: task.title,
  };
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getStatusTone(status: TaskStatus) {
  return status === "archived" || status === "completed" ? "neutral" : "accent";
}

function TaskField({
  label,
  children,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function inputClassName() {
  return "h-11 w-full rounded-2xl border border-slate-300/80 bg-white/80 px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400";
}

function textareaClassName() {
  return "min-h-28 w-full rounded-2xl border border-slate-300/80 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400";
}

export default function TaskSettingsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskRevisions, setTaskRevisions] = useState<TaskRevision[]>([]);
  const [dailyFocusItems, setDailyFocusItems] = useState<DailyFocusItemWithTask[]>([]);
  const [dailyFocusNotice, setDailyFocusNotice] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<TaskEditorState | null>(null);
  const [pageState, setPageState] = useState<PageState>({
    kind: "connecting",
    message: "Connecting task vault...",
  });
  const [authPanelState, setAuthPanelState] = useState<EmailAuthPanelState>({
    kind: "idle",
    message: null,
  });
  const [workspaceUserId, setWorkspaceUserId] = useState<string | null>(null);
  const [workspaceUserEmail, setWorkspaceUserEmail] = useState<string | null>(null);
  const [signInEmail, setSignInEmail] = useState("");
  const [showArchived, setShowArchived] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newTaskState, setNewTaskState] = useState(INITIAL_NEW_TASK_STATE);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );
  const selectedTaskInDailyFocus = useMemo(
    () => dailyFocusItems.find((item) => item.task_id === selectedTaskId) ?? null,
    [dailyFocusItems, selectedTaskId],
  );
  const [parentTask, setParentTask] = useState<Task | null>(null);
  const [childTasks, setChildTasks] = useState<Task[]>([]);

  const handleSelectTask = useCallback(async (task: Task, userId: string | null) => {
    setSelectedTaskId(task.id);
    setEditorState(createEditorState(task));

    if (!userId) {
      setTaskRevisions([]);
      return;
    }

    const revisions = await fetchTaskRevisions(supabase!, task.id, userId);
    setTaskRevisions(revisions);

    if (task.parent_task_id) {
      const parents = await fetchTasksByIds(supabase!, userId, [task.parent_task_id]);
      setParentTask(parents[0] ?? null);
    } else {
      setParentTask(null);
    }

    const children = await fetchImmediateChildTasks(supabase!, userId, task.id);
    setChildTasks(children);
  }, [supabase]);

  const loadTasksForUser = useCallback(async (userId: string, preferredTaskId?: string | null) => {
    if (!supabase) {
      return;
    }

    const taskRows = await fetchTasks(supabase, userId, { includeArchived: showArchived });
    setTasks(taskRows);

    const nextSelectedTaskId =
      preferredTaskId && taskRows.some((task) => task.id === preferredTaskId)
        ? preferredTaskId
        : taskRows[0]?.id ?? null;

    const nextSelectedTask = taskRows.find((task) => task.id === nextSelectedTaskId) ?? null;

    if (!nextSelectedTask) {
      setSelectedTaskId(null);
      setEditorState(null);
      setTaskRevisions([]);
      return;
    }

    await handleSelectTask(nextSelectedTask, userId);
  }, [handleSelectTask, showArchived, supabase]);

  const loadDailyFocusForUser = useCallback(async (userId: string) => {
    if (!supabase) {
      return;
    }

    const items = await fetchDailyFocusItems(supabase, userId);
    setDailyFocusItems(items);
    setDailyFocusNotice(null);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    async function connectTaskVault() {
      if (!supabase) {
        setPageState({
          kind: "error",
          message: "Supabase env vars are missing for this deployment. Add the public Supabase URL and publishable key.",
        });
        return;
      }

      try {
        const user = await ensureWorkspaceUser(supabase);

        if (cancelled) {
          return;
        }

        setWorkspaceUserId(user.id);
        setWorkspaceUserEmail(user.email ?? null);
        setAuthPanelState({
          kind: "idle",
          message: null,
        });
        await loadTasksForUser(user.id);
        try {
          await loadDailyFocusForUser(user.id);
        } catch (error) {
          if (!cancelled) {
            setDailyFocusItems([]);
            setDailyFocusNotice(error instanceof Error ? error.message : "Could not load daily focus items.");
          }
        }

        if (cancelled) {
          return;
        }

        setPageState({
          kind: "ready",
          message: "Task vault ready",
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Could not load the task vault.";
        const needsAuth = message === AUTH_REQUIRED_MESSAGE;

        setWorkspaceUserId(null);
        setWorkspaceUserEmail(null);
        setTasks([]);
        setTaskRevisions([]);
        setDailyFocusItems([]);
        setSelectedTaskId(null);
        setEditorState(null);

        setPageState({
          kind: needsAuth ? "auth_required" : "error",
          message,
        });
      }
    }

    void connectTaskVault();

    return () => {
      cancelled = true;
    };
  }, [loadDailyFocusForUser, loadTasksForUser, supabase]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;

      if (!user) {
        setWorkspaceUserId(null);
        setWorkspaceUserEmail(null);
        setTasks([]);
        setTaskRevisions([]);
        setDailyFocusItems([]);
        setSelectedTaskId(null);
        setEditorState(null);
        setDailyFocusNotice(null);
        setPageState({
          kind: "auth_required",
          message: AUTH_REQUIRED_MESSAGE,
        });
        return;
      }

      setWorkspaceUserId(user.id);
      setWorkspaceUserEmail(user.email ?? null);
      setAuthPanelState({
        kind: "idle",
        message: null,
      });
      setPageState({
        kind: "connecting",
        message: "Loading task vault...",
      });

      void (async () => {
        try {
          await loadTasksForUser(user.id);
          try {
            await loadDailyFocusForUser(user.id);
          } catch (error) {
            setDailyFocusItems([]);
            setDailyFocusNotice(error instanceof Error ? error.message : "Could not load daily focus items.");
          }

          setPageState({
            kind: "ready",
            message: "Task vault ready",
          });
        } catch (error) {
          setPageState({
            kind: "error",
            message: error instanceof Error ? error.message : "Could not load the task vault.",
          });
        }
      })();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [loadDailyFocusForUser, loadTasksForUser, supabase]);

  async function reloadTaskData(preferredTaskId?: string | null) {
    if (!workspaceUserId) {
      return;
    }

    await loadTasksForUser(workspaceUserId, preferredTaskId);
    try {
      await loadDailyFocusForUser(workspaceUserId);
    } catch (error) {
      setDailyFocusItems([]);
      setDailyFocusNotice(error instanceof Error ? error.message : "Could not load daily focus items.");
    }
  }

  async function handleCreateTask() {
    if (!supabase || !workspaceUserId) {
      return;
    }

    if (!newTaskState.title.trim()) {
      setPageState({
        kind: "error",
        message: "New tasks need a title.",
      });
      return;
    }

    setPageState({
      kind: "saving",
      message: "Creating task...",
    });

    try {
      const createdTask = await createTask(supabase, {
        actor: {
          label: "Task vault",
          type: "human",
        },
        area: newTaskState.area,
        humanSummary: newTaskState.humanSummary,
        priority: newTaskState.priority,
        title: newTaskState.title,
        userId: workspaceUserId,
      });

      setIsCreateDialogOpen(false);
      setNewTaskState(INITIAL_NEW_TASK_STATE);
      await reloadTaskData(createdTask.id);
      setPageState({
        kind: "ready",
        message: "Task created",
      });
    } catch (error) {
      setPageState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not create the task.",
      });
    }
  }

  async function handleSaveTask() {
    if (!supabase || !workspaceUserId || !selectedTask || !editorState) {
      return;
    }

    let parsedPayload: Record<string, unknown>;

    try {
      const parsed = JSON.parse(editorState.agentPayloadText);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Agent payload must be a JSON object.");
      }

      parsedPayload = parsed as Record<string, unknown>;
    } catch (error) {
      setPageState({
        kind: "error",
        message: error instanceof Error ? error.message : "Agent payload must be valid JSON.",
      });
      return;
    }

    setPageState({
      kind: "saving",
      message: "Saving task...",
    });

    try {
      const updatedTask = await updateTask(supabase, selectedTask, {
        actor: {
          label: "Task vault",
          type: "human",
        },
        area: editorState.area,
        description: editorState.description,
        dueAt: fromDateTimeLocalValue(editorState.dueAtLocal),
        humanSummary: editorState.humanSummary,
        priority: editorState.priority,
        reason: editorState.changeReason || "Task edited in task vault",
        status: editorState.status,
        taskId: selectedTask.id,
        title: editorState.title,
        userId: workspaceUserId,
        agentPayload: parsedPayload,
      });

      await reloadTaskData(updatedTask.id);
      setPageState({
        kind: "ready",
        message: "Task saved",
      });
    } catch (error) {
      setPageState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the task.",
      });
    }
  }

  async function handleCompleteTask() {
    if (!supabase || !workspaceUserId || !selectedTask) {
      return;
    }

    setPageState({
      kind: "saving",
      message: "Completing task...",
    });

    try {
      const updatedTask = await completeTask(
        supabase,
        selectedTask,
        { label: "Task vault", type: "human" },
        workspaceUserId,
      );
      await reloadTaskData(updatedTask.id);
      setPageState({
        kind: "ready",
        message: "Task completed",
      });
    } catch (error) {
      setPageState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not complete the task.",
      });
    }
  }

  async function handleArchiveTask() {
    if (!supabase || !workspaceUserId || !selectedTask) {
      return;
    }

    setPageState({
      kind: "saving",
      message: "Archiving task...",
    });

    try {
      const updatedTask = await archiveTask(
        supabase,
        selectedTask,
        { label: "Task vault", type: "human" },
        workspaceUserId,
      );
      await reloadTaskData(updatedTask.id);
      setPageState({
        kind: "ready",
        message: "Task archived",
      });
    } catch (error) {
      setPageState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not archive the task.",
      });
    }
  }

  async function handleRestoreTask() {
    if (!supabase || !workspaceUserId || !selectedTask) {
      return;
    }

    setPageState({
      kind: "saving",
      message: "Restoring task...",
    });

    try {
      const updatedTask = await restoreTask(
        supabase,
        selectedTask,
        { label: "Task vault", type: "human" },
        workspaceUserId,
      );
      await reloadTaskData(updatedTask.id);
      setPageState({
        kind: "ready",
        message: "Task restored",
      });
    } catch (error) {
      setPageState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not restore the task.",
      });
    }
  }

  async function handleAddTaskToToday() {
    if (!supabase || !workspaceUserId || !selectedTask) {
      return;
    }

    setPageState({
      kind: "saving",
      message: "Adding task to today...",
    });

    try {
      const items = await addTaskToDailyFocus(supabase, workspaceUserId, selectedTask.id);
      setDailyFocusItems(items);
      setPageState({
        kind: "ready",
        message: "Task added to today",
      });
    } catch (error) {
      setPageState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not add the task to today.",
      });
    }
  }

  async function handleRemoveTaskFromToday(itemId: string) {
    if (!supabase || !workspaceUserId) {
      return;
    }

    setPageState({
      kind: "saving",
      message: "Removing task from today...",
    });

    try {
      await removeTaskFromDailyFocus(supabase, itemId);
      await loadDailyFocusForUser(workspaceUserId);
      setPageState({
        kind: "ready",
        message: "Task removed from today",
      });
    } catch (error) {
      setPageState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not remove the task from today.",
      });
    }
  }

  async function handleMoveDailyFocusItem(itemId: string, direction: "up" | "down") {
    if (!supabase || !workspaceUserId) {
      return;
    }

    setPageState({
      kind: "saving",
      message: "Reordering today...",
    });

    try {
      const items = await moveDailyFocusItem(supabase, workspaceUserId, itemId, direction);
      setDailyFocusItems(items);
      setPageState({
        kind: "ready",
        message: "Today list updated",
      });
    } catch (error) {
      setPageState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not reorder the today list.",
      });
    }
  }

  async function handleCompleteFromToday(item: DailyFocusItemWithTask) {
    if (!supabase || !workspaceUserId) {
      return;
    }

    setPageState({
      kind: "saving",
      message: "Completing task...",
    });

    try {
      await completeTask(supabase, item.task, { label: "Daily focus", type: "human" }, workspaceUserId);
      await completeDailyFocusItem(supabase, item.id);
      await reloadTaskData(item.task.id);
      setPageState({
        kind: "ready",
        message: "Task completed",
      });
    } catch (error) {
      setPageState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not complete the task from today.",
      });
    }
  }

  async function handleArchiveFromToday(item: DailyFocusItemWithTask) {
    if (!supabase || !workspaceUserId) {
      return;
    }

    setPageState({
      kind: "saving",
      message: "Archiving task...",
    });

    try {
      await archiveTask(supabase, item.task, { label: "Daily focus", type: "human" }, workspaceUserId);
      await dropDailyFocusItem(supabase, item.id);
      await reloadTaskData(item.task.id);
      setPageState({
        kind: "ready",
        message: "Task archived",
      });
    } catch (error) {
      setPageState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not archive the task from today.",
      });
    }
  }

  async function handleMagicLinkSignIn() {
    if (!supabase) {
      setAuthPanelState({
        kind: "error",
        message: "Supabase env vars are missing for this deployment.",
      });
      return;
    }

    const trimmedEmail = signInEmail.trim();

    if (!trimmedEmail) {
      setAuthPanelState({
        kind: "error",
        message: "Enter your email address to receive a sign-in link.",
      });
      return;
    }

    setAuthPanelState({
      kind: "sending",
      message: "Sending sign-in link...",
    });

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      setAuthPanelState({
        kind: "error",
        message: error.message || "Could not send the sign-in link.",
      });
      return;
    }

    setAuthPanelState({
      kind: "sent",
      message: `Check ${trimmedEmail} for your sign-in link.`,
    });
  }

  async function handleSignOut() {
    if (!supabase) {
      return;
    }

    setPageState({
      kind: "connecting",
      message: "Signing out...",
    });

    const { error } = await supabase.auth.signOut();

    if (error) {
      setPageState({
        kind: "error",
        message: error.message || "Could not sign out.",
      });
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fff8ef_0%,#f6f0e7_38%,#f2ebdf_100%)] px-6 py-10 sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Badge tone={pageState.kind === "error" ? "neutral" : "accent"}>{pageState.message}</Badge>
              <button
                className="text-sm text-slate-500 underline-offset-4 transition hover:text-slate-900 hover:underline"
                onClick={() => setShowArchived((current) => !current)}
                type="button"
              >
                {showArchived ? "Hide archived" : "Show archived"}
              </button>
            </div>
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Task settings</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Task vault</h1>
          </div>

          <div className="flex flex-col items-start gap-3 sm:items-end">
            {workspaceUserEmail ? (
              <p className="text-sm text-slate-500">
                Logged in as: <span className="font-medium text-slate-900">{workspaceUserEmail}</span>
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <Button onClick={() => setIsCreateDialogOpen(true)} disabled={!workspaceUserId} size="sm">
                New task
              </Button>
              <Link
                className="text-sm text-slate-600 underline-offset-4 transition hover:text-slate-900 hover:underline"
                href="/"
              >
                Back home
              </Link>
              {workspaceUserId ? (
                <button
                  className="text-sm text-slate-600 underline-offset-4 transition hover:text-slate-900 hover:underline"
                  onClick={() => void handleSignOut()}
                  type="button"
                >
                  Sign out
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {pageState.kind === "error" ? <p className="text-sm text-rose-700">{pageState.message}</p> : null}

        {!workspaceUserId ? (
          <EmailAuthPanel
            email={signInEmail}
            onEmailChange={setSignInEmail}
            onSubmit={() => void handleMagicLinkSignIn()}
            state={authPanelState}
            title="Sign in to open the task vault"
          />
        ) : (
        <section className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)_23rem]">
          <section className="rounded-[0.8rem] border border-slate-300/70 bg-[#f6f4ee]/92 p-5 shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
            <div className="flex items-end justify-between gap-3 border-b border-slate-200/80 pb-4">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">Canonical tasks</h2>
                <p className="text-sm text-slate-500">{tasks.length} task{tasks.length === 1 ? "" : "s"}</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {tasks.length === 0 ? (
                <p className="text-sm text-slate-500">No tasks yet. Create the first canonical task to start the vault.</p>
              ) : (
                tasks.map((task) => (
                  <button
                    key={task.id}
                    className={`w-full rounded-[0.8rem] border px-4 py-3 text-left transition ${
                      selectedTaskId === task.id
                        ? "border-[var(--accent)] bg-white shadow-[0_10px_25px_rgba(15,118,110,0.12)]"
                        : "border-slate-200/80 bg-white/70 hover:border-slate-300"
                    }`}
                    onClick={() => {
                      void handleSelectTask(task, workspaceUserId);
                    }}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-950">{task.title}</p>
                        <TaskPriorityLabel area={task.area} priority={task.priority} />
                      </div>
                      <Badge tone={getStatusTone(task.status)}>{TASK_STATUS_LABEL[task.status]}</Badge>
                    </div>
                    {task.human_summary ? (
                      <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{task.human_summary}</p>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[0.8rem] border border-slate-300/70 bg-[#f6f4ee]/92 p-6 shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
            <div className="border-b border-slate-200/80 pb-4">
              <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                {selectedTask ? selectedTask.title : "Select a task"}
              </h2>
            </div>
            <div className="mt-5">
              {!selectedTask || !editorState ? (
                <p className="text-sm text-slate-500">Choose a task on the left to edit it.</p>
              ) : (
                <div className="space-y-5">
                  {parentTask ? (
                    <div className="rounded-[0.8rem] border border-slate-200/80 bg-white/70 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Parent task</p>
                      <p className="mt-1 text-sm font-medium text-slate-950">{parentTask.title}</p>
                    </div>
                  ) : null}
                  {childTasks.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        Subtasks ({childTasks.length})
                      </p>
                      <div className="space-y-1">
                        {childTasks.map((child) => (
                          <button
                            key={child.id}
                            className="flex w-full items-center justify-between rounded-[0.6rem] px-2 py-1.5 text-left transition hover:bg-slate-100"
                            onClick={() => void handleSelectTask(child, workspaceUserId)}
                            type="button"
                          >
                            <span className="truncate text-sm text-slate-700">{child.title}</span>
                            <span className="shrink-0 text-xs text-[var(--accent)]">View</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-4 md:grid-cols-2">
                    <TaskField label="Title">
                      <input
                        className={inputClassName()}
                        onChange={(event) => setEditorState((current) => current ? { ...current, title: event.target.value } : current)}
                        value={editorState.title}
                      />
                    </TaskField>
                    <TaskField label="Area">
                      <input
                        className={inputClassName()}
                        onChange={(event) => setEditorState((current) => current ? { ...current, area: event.target.value } : current)}
                        placeholder="Operations, Product, Admin..."
                        value={editorState.area}
                      />
                    </TaskField>
                    <TaskField label="Priority">
                      <select
                        className={inputClassName()}
                        onChange={(event) =>
                          setEditorState((current) => current ? { ...current, priority: event.target.value as TaskPriority } : current)}
                        value={editorState.priority}
                      >
                        <option value="critical">Critical</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </TaskField>
                    <TaskField label="Status">
                      <select
                        className={inputClassName()}
                        onChange={(event) =>
                          setEditorState((current) => current ? { ...current, status: event.target.value as TaskStatus } : current)}
                        value={editorState.status}
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In progress</option>
                        <option value="blocked">Blocked</option>
                        <option value="completed">Completed</option>
                        <option value="archived">Archived</option>
                      </select>
                    </TaskField>
                    <TaskField label="Due at">
                      <input
                        className={inputClassName()}
                        onChange={(event) => setEditorState((current) => current ? { ...current, dueAtLocal: event.target.value } : current)}
                        type="datetime-local"
                        value={editorState.dueAtLocal}
                      />
                    </TaskField>
                    <TaskField label="Change reason">
                      <input
                        className={inputClassName()}
                        onChange={(event) => setEditorState((current) => current ? { ...current, changeReason: event.target.value } : current)}
                        placeholder="Why is this task changing?"
                        value={editorState.changeReason}
                      />
                    </TaskField>
                  </div>

                  <TaskField label="Human summary">
                    <textarea
                      className={textareaClassName()}
                      onChange={(event) =>
                        setEditorState((current) => current ? { ...current, humanSummary: event.target.value } : current)}
                      placeholder="Short troubleshooting-friendly summary"
                      value={editorState.humanSummary}
                    />
                  </TaskField>

                  <TaskField label="Description">
                    <textarea
                      className={textareaClassName()}
                      onChange={(event) =>
                        setEditorState((current) => current ? { ...current, description: event.target.value } : current)}
                      placeholder="Longer notes for humans"
                      value={editorState.description}
                    />
                  </TaskField>

                  <TaskField label="Agent payload JSON">
                    <textarea
                      className={`${textareaClassName()} min-h-80 font-mono text-xs leading-6`}
                      onChange={(event) =>
                        setEditorState((current) =>
                          current ? { ...current, agentPayloadText: event.target.value } : current
                        )}
                      value={editorState.agentPayloadText}
                    />
                  </TaskField>

                  <div className="flex flex-wrap gap-3">
                    <Button onClick={handleSaveTask} size="sm">
                      Save task
                    </Button>
                    {selectedTask.status !== "completed" && selectedTask.status !== "archived" ? (
                      selectedTaskInDailyFocus ? (
                        <Button onClick={() => void handleRemoveTaskFromToday(selectedTaskInDailyFocus.id)} size="sm" variant="secondary">
                          Remove from today
                        </Button>
                      ) : (
                        <Button onClick={handleAddTaskToToday} size="sm" variant="secondary">
                          Add to today
                        </Button>
                      )
                    ) : null}
                    {selectedTask.status !== "completed" && selectedTask.status !== "archived" ? (
                      <Button onClick={handleCompleteTask} size="sm" variant="secondary">
                        Complete
                      </Button>
                    ) : null}
                    {selectedTask.status !== "archived" ? (
                      <Button onClick={handleArchiveTask} size="sm" variant="secondary">
                        Archive
                      </Button>
                    ) : (
                      <Button onClick={handleRestoreTask} size="sm" variant="secondary">
                        Restore
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-3 border-t border-slate-200/80 pt-5 text-sm text-slate-600 sm:grid-cols-2">
                    <p>Created: {formatTimestamp(selectedTask.created_at)}</p>
                    <p>Updated: {formatTimestamp(selectedTask.updated_at)}</p>
                    <p>Source: {selectedTask.source}</p>
                    <p>Schema version: {selectedTask.schema_version}</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <div className="space-y-6">
            <section className="rounded-[0.8rem] border border-slate-300/70 bg-[#f6f4ee]/92 p-5 shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
              <div className="border-b border-slate-200/80 pb-4">
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">Today&apos;s focus</h2>
              </div>
              <div className="mt-4 space-y-3">
                {dailyFocusNotice ? (
                  <p className="text-sm text-rose-700">{dailyFocusNotice}</p>
                ) : dailyFocusItems.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No tasks are on today&apos;s list yet. Add one from the selected task to keep the home page focused.
                  </p>
                ) : (
                  dailyFocusItems.map((item, index) => (
                    <div key={item.id} className="rounded-2xl border border-slate-200/80 bg-white/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-slate-950">{item.task.title}</p>
                          <TaskPriorityLabel area={item.task.area} priority={item.task.priority} />
                        </div>
                        <Badge tone="accent">{index + 1}</Badge>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          disabled={index === 0}
                          onClick={() => void handleMoveDailyFocusItem(item.id, "up")}
                          size="inline"
                          variant="text"
                        >
                          Up
                        </Button>
                        <Button
                          disabled={index === dailyFocusItems.length - 1}
                          onClick={() => void handleMoveDailyFocusItem(item.id, "down")}
                          size="inline"
                          variant="text"
                        >
                          Down
                        </Button>
                        <Button onClick={() => void handleCompleteFromToday(item)} size="inline" variant="text">
                          Done
                        </Button>
                        <Button onClick={() => void handleArchiveFromToday(item)} size="inline" variant="text">
                          Archive
                        </Button>
                        <Button onClick={() => void handleRemoveTaskFromToday(item.id)} size="inline" variant="text">
                          Later
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-[0.8rem] border border-slate-300/70 bg-[#f6f4ee]/92 p-5 shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
              <div className="border-b border-slate-200/80 pb-4">
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">Revisions</h2>
              </div>
              <div className="mt-4 space-y-4">
                {taskRevisions.length === 0 ? (
                  <p className="text-sm text-slate-500">Select a task to inspect its revision history.</p>
                ) : (
                  taskRevisions.map((revision) => (
                    <div key={revision.id} className="rounded-[0.8rem] border border-slate-200/80 bg-white/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-slate-950">{revision.action_type}</p>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                            {revision.actor_type}
                            {revision.actor_label ? ` · ${revision.actor_label}` : ""}
                          </p>
                        </div>
                        <span className="text-xs text-slate-500">{formatTimestamp(revision.created_at)}</span>
                      </div>
                      {revision.change_reason ? (
                        <p className="mt-3 text-sm leading-6 text-slate-600">{revision.change_reason}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </section>
        )}
      </div>

      <Dialog
        onClose={() => setIsCreateDialogOpen(false)}
        open={isCreateDialogOpen}
        title="Create canonical task"
      >
        <div className="space-y-4">
          <TaskField label="Title">
            <input
              className={inputClassName()}
              onChange={(event) => setNewTaskState((current) => ({ ...current, title: event.target.value }))}
              value={newTaskState.title}
            />
          </TaskField>
          <TaskField label="Area">
            <input
              className={inputClassName()}
              onChange={(event) => setNewTaskState((current) => ({ ...current, area: event.target.value }))}
              placeholder="Operations, Product, Admin..."
              value={newTaskState.area}
            />
          </TaskField>
          <TaskField label="Priority">
            <select
              className={inputClassName()}
              onChange={(event) => setNewTaskState((current) => ({ ...current, priority: event.target.value as TaskPriority }))}
              value={newTaskState.priority}
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </TaskField>
          <TaskField label="Human summary">
            <textarea
              className={textareaClassName()}
              onChange={(event) => setNewTaskState((current) => ({ ...current, humanSummary: event.target.value }))}
              placeholder="What is this task about?"
              value={newTaskState.humanSummary}
            />
          </TaskField>
          <Button className="w-full" onClick={handleCreateTask} variant="secondary">
            Create task
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
