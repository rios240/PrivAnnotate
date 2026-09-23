"""Signup screening."""

import os

import joblib

from trailmark_worker import db, mailer, review_queue

MODEL_PATH = os.environ.get("SIGNUP_MODEL_PATH", "/srv/trailmark/models/signup_gbm.joblib")
LOCK_THRESHOLD = 0.85
REVIEW_THRESHOLD = 0.5

_model = joblib.load(MODEL_PATH)


def screen_signup(user_id):
    s = db.fetch_one(
        "SELECT ip_country, card_country, email_domain_age_days, signups_from_device_24h, "
        "minutes_to_first_payment FROM signup_signals WHERE user_id = %s",
        (user_id,),
    )
    features = [
        [
            int(s["ip_country"] != s["card_country"]),
            s["email_domain_age_days"],
            s["signups_from_device_24h"],
            s["minutes_to_first_payment"],
        ]
    ]
    score = float(_model.predict_proba(features)[0][1])

    if score >= LOCK_THRESHOLD:
        db.execute(
            "UPDATE users SET status = 'locked', locked_reason = 'signup_risk' WHERE id = %s",
            (user_id,),
        )
        mailer.send_template(user_id, "account_locked")
    elif score >= REVIEW_THRESHOLD:
        review_queue.enqueue("signup", user_id=user_id, score=score)
    return score


def pending_screenings(limit=200):
    return db.fetch_all(
        "SELECT user_id FROM signup_signals WHERE screened_at IS NULL ORDER BY created_at LIMIT %s",
        (limit,),
    )


if __name__ == "__main__":
    for row in pending_screenings():
        screen_signup(row["user_id"])
        db.execute("UPDATE signup_signals SET screened_at = now() WHERE user_id = %s", (row["user_id"],))
