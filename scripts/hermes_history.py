"""Non-destructive model replay projection. No filesystem or database writes."""
import copy
import json
from uuid import UUID


def _json_object(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else None
    except (ValueError, TypeError):
        return None


def _application_packet(value):
    state = value.get("currentApplicationState")
    request = value.get("request")
    if not isinstance(state, dict) or state.get("schemaVersion") != 1:
        return False
    if not (isinstance(request, dict) and isinstance(request.get("text"), str)):
        return False
    try:
        UUID(value.get("sourceTurnId", ""))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def project_history(history):
    """Keep every message/identity, replacing only known historical snapshots.

    _row_id and _db_persisted MUST survive: Hermes uses these to avoid appending
    restored messages again. Never rewrite the source objects or durable rows.
    """
    projected = copy.deepcopy(history)
    replaced = 0
    for message in projected:
        packet = _json_object(message.get("content"))
        if not packet:
            continue
        if message.get("role") == "user" and _application_packet(packet):
            packet.pop("currentApplicationState")
            packet["historicalWorkspaceSnapshot"] = (
                "Omitted from model replay only; the original packet remains in native history. "
                "Use the current application state or read_context for current tasks and memory."
            )
        elif (message.get("role") == "tool" and message.get("tool_name") == "read_context"
              and packet.get("schemaVersion") == 1):
            packet = {
                "schemaVersion": 1, "date": packet.get("date"), "turnId": packet.get("turnId"),
                "historicalWorkspaceSnapshot": "Historical read-only snapshot omitted from replay; full result retained in native history. Refresh with read_context.",
            }
        else:
            continue
        message["content"] = json.dumps(packet, ensure_ascii=False, separators=(",", ":"))
        # Hermes replays this sidecar instead of content when present. Keeping
        # it here would silently reintroduce the obsolete full snapshot.
        message.pop("api_content", None)
        replaced += 1
    size = lambda messages: sum(len(str(m.get("api_content") or m.get("content") or "")) for m in messages)
    return projected, {
        "history_messages": len(history), "snapshots_projected": replaced,
        "history_chars_before": size(history), "history_chars_after": size(projected),
    }


def runtime_budgets(request):
    budgets = request.get("budgets", {})
    run = int(budgets.get("run_seconds", 160))
    idle = int(budgets.get("compression_idle_seconds", 30))
    ceiling = int(budgets.get("compression_total_seconds", 60))
    if not 0 < idle <= ceiling < run:
        raise ValueError("Compression budgets must fit inside the turn budget.")
    return run, idle, ceiling
