import copy
import json
import unittest

from hermes_history import project_history, runtime_budgets

TURN = "11111111-1111-4111-8111-111111111111"


def packet():
    return {
        "currentApplicationState": {"schemaVersion": 1, "tasks": ["old snapshot" * 1000]},
        "request": {"kind": "message", "text": "Show me all active tasks", "sourceMessageId": TURN},
        "sourceTurnId": TURN,
        "dailyInitialization": {"purpose": "normal", "steering": {"originalText": "Keep my priorities"}},
    }


class HistoryProjectionTests(unittest.TestCase):
    def test_removes_only_obsolete_snapshot_preserving_request_sources_and_flow(self):
        original = packet()
        history = [{"role": "user", "content": json.dumps(original), "_row_id": 42, "_db_persisted": True}]
        before = copy.deepcopy(history)
        projected, metrics = project_history(history)
        restored = json.loads(projected[0]["content"])
        self.assertNotIn("currentApplicationState", restored)
        for key in ("request", "sourceTurnId", "dailyInitialization"):
            self.assertEqual(restored[key], original[key])
        self.assertEqual(projected[0]["_row_id"], 42)
        self.assertTrue(projected[0]["_db_persisted"])
        self.assertEqual(history, before)
        self.assertLess(metrics["history_chars_after"], metrics["history_chars_before"] / 10)

    def test_old_api_sidecar_cannot_reintroduce_snapshot(self):
        raw = json.dumps(packet())
        projected, _ = project_history([{"role": "user", "content": raw, "api_content": raw}])
        self.assertNotIn("api_content", projected[0])

    def test_read_only_context_projection_preserves_tool_pair_and_receipts(self):
        history = [
            {"role": "assistant", "content": "", "tool_calls": [{"id": "call1", "function": {"name": "read_context"}}]},
            {"role": "tool", "tool_name": "read_context", "tool_call_id": "call1", "content": json.dumps({"schemaVersion": 1, "tasks": ["stale"]}), "_db_persisted": True},
            {"role": "tool", "tool_name": "save_daily", "content": '{"saved":true,"revision":7}'},
            {"role": "tool", "tool_name": "propose_task", "content": '{"proposal_id":"keep-me","status":"pending"}'},
            {"role": "tool", "tool_name": "read_history", "content": '{"items":[{"text":"Historical preference"}]}'},
        ]
        before = copy.deepcopy(history)
        projected, _ = project_history(history)
        self.assertEqual(projected[0], before[0])
        self.assertEqual(projected[1]["tool_call_id"], "call1")
        self.assertTrue(projected[1]["_db_persisted"])
        self.assertNotIn("tasks", json.loads(projected[1]["content"]))
        self.assertEqual(projected[2:], before[2:])
        self.assertEqual(history, before)

    def test_conversation_summaries_plain_json_and_multimodal_are_untouched(self):
        values = ["Jake explicitly prefers brief paragraphs", "not JSON", '{"currentApplicationState": {"schemaVersion":1},"request":{"text":"example"}}',
                  [{"type": "image_url", "image_url": {"url": "original-image"}}]]
        history = [{"role": "user", "content": value} for value in values]
        history.append({"role": "assistant", "content": "Preserved native compression summary", "_compressed_summary": True})
        projected, metrics = project_history(history)
        self.assertEqual(projected, history)
        self.assertEqual(metrics["snapshots_projected"], 0)

    def test_projection_is_repeatable_without_dropping_messages(self):
        history = [{"role": "user", "content": json.dumps(packet())}, {"role": "assistant", "content": "Answer"}]
        first, _ = project_history(history)
        second, _ = project_history(first)
        self.assertEqual(first, second)
        self.assertEqual(len(first), len(history))

    def test_budgets_bound_compression_within_the_native_and_host_deadlines(self):
        run, idle, total = runtime_budgets({})
        self.assertLessEqual(idle, total)
        self.assertLess(total, run)
        self.assertLess(run, 180)
        self.assertEqual(runtime_budgets({"budgets": {"run_seconds": 100, "compression_idle_seconds": 10, "compression_total_seconds": 20}}), (100, 10, 20))
        for budgets in ({"compression_total_seconds": 600}, {"compression_idle_seconds": 0}, {"run_seconds": 30}):
            with self.assertRaises(ValueError):
                runtime_budgets({"budgets": budgets})


if __name__ == "__main__":
    unittest.main()
