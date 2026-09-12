"""Dedicated Personal OS adapter. Only application tools and profile history are exposed.

The installed Hermes checkout/profile is left alone. JSONL on original stdout is
our private host protocol; runtime diagnostics go to stderr and are never returned
as a chat answer. Credentials never enter the protocol or application database.
"""
import copy
import json
import os
import sys
import threading
import traceback
from pathlib import Path

wire = sys.stdout
sys.stdout = sys.stderr
protocol_lock = threading.Lock()

def emit(value):
    wire.write(json.dumps(value) + "\n")
    wire.flush()

class PlanningWorkerError(RuntimeError):
    pass

def main():
    request = json.loads(sys.stdin.readline())
    install = Path(os.environ["PERSONAL_ASSISTANT_HERMES_INSTALL"])
    profile = Path(os.environ["HERMES_HOME"])
    profile.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(profile, 0o700)
    os.umask(0o077)
    (profile / "workspace").mkdir(exist_ok=True)
    os.chdir(profile / "workspace")
    sys.path.insert(0, str(install))
    config = {
        "model": {"default": request["model"], "provider": "openai-codex", "openai_runtime": "auto"},
        "fallback_providers": [],
        "agent": {"max_turns": 16, "run_budget_seconds": 160, "reasoning_effort": "low"},
        "terminal": {"backend": "local", "cwd": str(profile / "workspace")},
        "memory": {"memory_enabled": False, "user_profile_enabled": False},
        "auxiliary": {"background_review": {"enabled": False}},
        "mcp_servers": {},
        "tools": {"tool_search": {"enabled": "off"}},
        "display": {"interface": "cli"},
    }
    # JSON is a YAML subset; no new Python dependency is needed.
    (profile / "config.yaml").write_text(json.dumps(config))
    (profile / ".env").write_text("# Personal OS profile: ChatGPT login only.\n")
    from hermes_cli.auth import _recover_codex_tokens_from_cli
    from hermes_cli.runtime_provider import resolve_runtime_provider
    if not (profile / "auth.json").exists():
        _recover_codex_tokens_from_cli("personal_os_planning")
    runtime = resolve_runtime_provider(requested="openai-codex", target_model=request["model"])
    if runtime.get("provider") != "openai-codex" or runtime.get("api_mode") != "codex_responses" or not runtime.get("api_key"):
        raise PlanningWorkerError("ChatGPT Codex login is unavailable. Sign in to Codex on this machine.")
    if request.get("check"):
        emit({"type": "done", "connection": {"auth": "chatgpt", "model": request["model"], "runtime": "hermes"}})
        return

    result_dir = profile / "turn-results"
    result_dir.mkdir(exist_ok=True)
    cached = result_dir / (request["turnId"] + ".json")
    if cached.exists():
        emit(json.loads(cached.read_text()))
        return

    from tools.registry import registry
    reviewed = False
    call_index = 0
    def invoke(name, args):
        nonlocal reviewed, call_index
        # Hermes may run tool calls concurrently. Serialize the host exchange so
        # receipt lines cannot be consumed by another handler.
        with protocol_lock:
            call_index += 1
            call_id = str(call_index)
            emit({"type": "tool", "id": call_id, "name": name, "args": args})
            response = json.loads(sys.stdin.readline())
            if response.get("id") != call_id:
                raise PlanningWorkerError("Application tool protocol lost synchronization.")
            result = response["result"]
            if name == "finish_planning" and result.get("reviewed") is True:
                reviewed = True
            elif name.startswith("save_") or name == "propose_task" or result.get("error"):
                reviewed = False
            return json.dumps(result)
    for tool in request["tools"]:
        registry.register(name=tool["name"], toolset="personal_os", schema=tool,
                          handler=lambda args, _name=tool["name"], **kwargs: invoke(_name, args),
                          check_fn=lambda: True)
    from toolsets import create_custom_toolset
    create_custom_toolset("personal_os", "Personal OS planning", tools=[t["name"] for t in request["tools"]])
    from hermes_state import SessionDB
    from run_agent import AIAgent
    db = SessionDB()
    # Stock session_search can follow profile links and auto-search other profiles.
    # Preserve native search, but fence it to this authenticated user's runtime DB.
    from tools.session_search_tool import SESSION_SEARCH_SCHEMA, session_search
    search_schema = copy.deepcopy(SESSION_SEARCH_SCHEMA)
    search_schema["parameters"]["properties"].pop("profile", None)
    search_schema["description"] = "Search this Personal OS assistant's native session history only. Use read_history for canonical application source IDs."
    def native_search(args, **kwargs):
        if "profile" in args:
            return json.dumps({"error": "Other Hermes profiles are not accessible."})
        sid = args.get("session_id")
        if sid and (not isinstance(sid, str) or "/" in sid or not db.get_session(sid)):
            return json.dumps({"error": "Session is not in this Personal OS profile."})
        return session_search(query=args.get("query") or "", session_id=sid,
                              limit=min(int(args.get("limit", 3)), 5),
                              around_message_id=args.get("around_message_id"),
                              window=min(int(args.get("window", 5)), 10),
                              role_filter=args.get("role_filter"), sort=args.get("sort"),
                              detail=args.get("detail", "adaptive"), db=db,
                              current_session_id=request["sessionId"])
    registry.register(name="session_search", toolset="session_search", schema=search_schema,
                      handler=native_search, check_fn=lambda: True, override=True)
    root_session = request["sessionId"]
    session_id = db.get_compression_tip(root_session) or root_session
    agent = AIAgent(
        model=request["model"], provider="openai-codex", requested_provider="openai-codex",
        api_mode="codex_responses", base_url=runtime["base_url"], api_key=runtime["api_key"],
        enabled_toolsets=["personal_os", "session_search"],
        session_id=session_id, session_db=db, platform="personal_os",
        skip_context_files=True, load_soul_identity=False, skip_memory=True,
        skip_background_review=True, quiet_mode=True, verbose_logging=False,
        max_iterations=16, run_budget_seconds=160, reasoning_config={"effort": "low"},
        fallback_model=None,
    )
    allowed = {t["name"] for t in request["tools"]} | {"session_search"}
    if not agent.valid_tool_names.issubset(allowed) or not {t["name"] for t in request["tools"]}.issubset(agent.valid_tool_names):
        raise PlanningWorkerError("Hermes tool availability differs from the application allowlist: " + ", ".join(sorted(agent.valid_tool_names)))
    history = db.get_messages_as_conversation(session_id, repair_alternation=True, include_row_ids=True)
    try:
        result = agent.run_conversation(
            request["prompt"], system_message=request["instructions"],
            conversation_history=history, task_id=request["turnId"],
        )
        if result.get("failed") or result.get("interrupted") or result.get("completed") is not True:
            raise PlanningWorkerError("Hermes did not complete this turn. Saved application receipts remain available; retry the message.")
        answer = result.get("final_response")
        if not isinstance(answer, str) or not answer.strip():
            raise PlanningWorkerError("Hermes returned no final answer.")
        event = {"type": "done", "answer": answer, "reviewed": reviewed,
                 "connection": {"auth": "chatgpt", "model": request["model"], "runtime": "hermes"}}
        temporary = cached.with_suffix(".tmp")
        temporary.write_text(json.dumps(event))
        temporary.replace(cached)
        emit(event)
    finally:
        agent.close()
        db.close()

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Avoid accidentally exposing a provider exception containing request/auth data.
        emit({"type": "error", "error": str(error) if isinstance(error, PlanningWorkerError) else "Hermes could not finish. Verify the local Codex login and runtime compatibility, then retry.", "error_type": type(error).__name__, "location": [f"{Path(f.filename).name}:{f.lineno}" for f in traceback.extract_tb(error.__traceback__)][-4:]})
        sys.exit(1)
