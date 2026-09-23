"""Background jobs for the Trailmark coach."""

import json
import os
from datetime import date, datetime, timezone
from pathlib import Path

import anthropic
import requests

from trailmark_worker import db

COACH_MODEL = os.environ.get("COACH_MODEL", "claude-sonnet-5")
DATASET_DIR = Path(os.environ.get("DATASET_DIR", "/srv/trailmark/datasets/coach_sft"))
OPS_WEBHOOK = os.environ.get("OPS_SLACK_WEBHOOK", "")

client = anthropic.Anthropic()


def record_feedback(user_id, transcript, rating):
    db.execute(
        "INSERT INTO coach_feedback (user_id, transcript, rating, include_in_training, created_at) "
        "VALUES (%s, %s, %s, %s, %s)",
        (user_id, json.dumps(transcript), rating, True, datetime.now(timezone.utc)),
    )


def export_sft_batch(since):
    rows = db.fetch_all(
        "SELECT transcript FROM coach_feedback WHERE created_at >= %s AND rating >= 4",
        (since,),
    )
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    out_path = DATASET_DIR / f"{date.today().isoformat()}.jsonl"
    with out_path.open("a", encoding="utf-8") as out:
        for row in rows:
            out.write(json.dumps({"messages": json.loads(row["transcript"])}) + "\n")
    return out_path


def build_training_plan(user_id):
    member = db.fetch_one(
        "SELECT display_name, birth_date, readiness_score FROM users WHERE id = %s",
        (user_id,),
    )
    recent = db.fetch_all(
        "SELECT started_at, distance_m, avg_heart_rate FROM activities "
        "WHERE user_id = %s ORDER BY started_at DESC LIMIT 20",
        (user_id,),
    )
    history = "\n".join(
        f"- {a['started_at']:%Y-%m-%d}: {a['distance_m'] / 1000:.1f} km, avg HR {a['avg_heart_rate']}"
        for a in recent
    )
    response = client.messages.create(
        model=COACH_MODEL,
        max_tokens=1500,
        messages=[
            {
                "role": "user",
                "content": (
                    f"Write a four-week hiking plan for {member['display_name']} "
                    f"(born {member['birth_date']}, readiness {member['readiness_score']}/100).\n"
                    f"Recent activities:\n{history}"
                ),
            }
        ],
    )
    plan = response.content[0].text
    db.execute("INSERT INTO training_plans (user_id, body) VALUES (%s, %s)", (user_id, plan))
    return plan


def weekly_ops_digest():
    stats = db.fetch_one(
        "SELECT count(*) AS activities, coalesce(sum(distance_m), 0) AS meters, "
        "count(DISTINCT user_id) AS active_members "
        "FROM activities WHERE started_at > now() - interval '7 days'"
    )
    response = client.messages.create(
        model=COACH_MODEL,
        max_tokens=200,
        messages=[
            {
                "role": "user",
                "content": f"Summarize this week's platform totals in two sentences: {dict(stats)}",
            }
        ],
    )
    requests.post(OPS_WEBHOOK, json={"text": response.content[0].text}, timeout=10)
