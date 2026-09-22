/**
 * Privacy Practice Detection Rules.
 *
 * One rule per privacy-practice category, adapted from the OPP-115 taxonomy
 * (Wilson et al., 2016); the per-rule structure (description, reasoning
 * guidance, elicitation questions, worked examples) follows the LINDDUN GO card
 * format (DistriNet, KU Leuven). Rules FP-01 through DS-06 cover the first six
 * OPP-115 categories; DNT-07 is OPP-115's ninth category reformulated for code;
 * AI-08 is a custom category with no OPP-115 equivalent (OPP-115 predates
 * widespread LLM/ML integration).
 *
 * Rule text is transcribed from the framework document and is the single
 * source of truth for prompt content - `src/analysis/prompts.tsx` renders these
 * fields directly. Each rule is sent to the model on its own, in its own request.
 */

export const CATEGORY_NAMES = [
    'FIRST_PARTY_COLLECTION_USE',
    'THIRD_PARTY_SHARING_COLLECTION',
    'USER_CHOICE_CONTROL',
    'USER_ACCESS_EDIT_DELETION',
    'DATA_RETENTION',
    'DATA_SECURITY',
    'DO_NOT_TRACK',
    'AI_USAGE',
] as const;

export type CategoryName = (typeof CATEGORY_NAMES)[number];

export function isCategoryName(value: unknown): value is CategoryName {
    return typeof value === 'string' && (CATEGORY_NAMES as readonly string[]).includes(value);
}

/**
 * A worked exemplar. Negative examples matter as much as positive ones - they
 * are what sharpen the detection boundary, so every rule carries at least one.
 */
export interface RuleExample {
    kind: 'positive' | 'negative';
    label: string;
    language: string;
    code: string;
    reasoning: string[];
    conclusion: string;
}

export interface PrivacyRule {
    /** Rule identifier, e.g. 'FP-01'. */
    id: string;
    /** Enum value the model must emit in the "category" field. */
    category: CategoryName;
    /** Human-readable category name, e.g. 'First Party Collection/Use'. */
    displayName: string;
    baseDescription: string;
    /** The "Look for..." reasoning guidance paragraph. */
    chainOfThought: string;
    elicitationQuestions: string[];
    examples: RuleExample[];
    /**
     * Other rule IDs this one legitimately co-occurs with. A single span often
     * matches more than one category; the framework asks for all applicable
     * flags rather than a forced single label.
     */
    crossReferences?: string[];
}

export const PRIVACY_RULES: PrivacyRule[] = [
    {
        id: 'FP-01',
        category: 'FIRST_PARTY_COLLECTION_USE',
        displayName: 'First Party Collection/Use',
        baseDescription:
            'How the application, system, or program logic itself collects, generates, ' +
            'infers, or utilizes user information as part of its own functionality.',
        chainOfThought:
            'When examining a code span, first determine whether it reads, receives, ' +
            'senses, or derives information that describes or is linked to an identifiable ' +
            'user. This includes information pulled directly from a request, form, or input; ' +
            'information read from a device or sensor (camera, GPS, microphone, ' +
            'accelerometer); and information the application computes or infers from other ' +
            'data (a derived score, a behavioral profile, a recommendation feature) which is ' +
            'then stored or acted upon. A bare variable declaration or type definition is not ' +
            'collection - an operation must actually retrieve or derive the data.',
        elicitationQuestions: [
            'Does this code read data supplied by or describing a specific user (form field, request body, query param, uploaded file, session)?',
            'Does this code access a device/sensor capability yielding user or environmental data (location, camera, mic, biometric, clipboard)?',
            'Does this code compute, infer, or derive a new value about a user from existing data, and then persist or act on it?',
            "Is this happening inside the application's own logic, rather than through a call to an external service (which belongs to TP-02 instead)?",
        ],
        examples: [
            {
                kind: 'positive',
                label: 'Positive match',
                language: 'python',
                code: [
                    '@app.route("/checkin", methods=["POST"])',
                    'def checkin():',
                    '    lat = request.json["lat"]',
                    '    lon = request.json["lon"]',
                    '    db.checkins.insert_one({',
                    '        "user_id": current_user.id, "lat": lat, "lon": lon,',
                    '        "ts": datetime.utcnow()',
                    '    })',
                    '    return jsonify(status="ok")',
                ].join('\n'),
                reasoning: [
                    '`request.json["lat"/"lon"]` reads location data describing the user.',
                    'This is a direct device/location data point, not a call to a third party.',
                    "The value is persisted into the application's own database.",
                ],
                conclusion: '`FIRST_PARTY_COLLECTION_USE`, confidence: high, entity: n/a.',
            },
            {
                kind: 'negative',
                label: 'Negative (non-match)',
                language: 'python',
                code: 'MAX_UPLOAD_SIZE_MB = 25',
                reasoning: [
                    'No read of user-supplied or user-linked data occurs.',
                    'No sensor/device access, and no derived value about a user.',
                ],
                conclusion: 'No match - a static configuration constant, not a collection/use operation.',
            },
        ],
        crossReferences: ['TP-02'],
    },
    {
        id: 'TP-02',
        category: 'THIRD_PARTY_SHARING_COLLECTION',
        displayName: 'Third Party Sharing/Collection',
        baseDescription:
            'How the application transmits, exposes, or otherwise makes user information ' +
            'available to external entities, libraries, SDKs, APIs, or services outside the ' +
            "first-party system's direct control.",
        chainOfThought:
            'Look for any point where data describing or linked to a user leaves the boundary ' +
            'of the first-party application: an outbound HTTP/API call to an external domain, ' +
            'initialization or invocation of a third-party SDK (analytics, advertising, crash ' +
            'reporting, chat support), a webhook payload, an OAuth/identity-provider exchange, ' +
            'or a call into an imported library where user data is passed as an argument. ' +
            "Distinguish a genuinely external destination (a different company's domain or " +
            'SDK) from an internal microservice the same organization controls - the former is ' +
            'third-party, the latter is typically still first-party. If the destination ' +
            "can't be determined from the available code, still flag it, but lower the " +
            'confidence.',
        elicitationQuestions: [
            "Does this code send, post, or transmit user-linked data to a URL, domain, or endpoint outside the application's own first-party backend?",
            'Does this code call a method on an imported third-party SDK/library (analytics, ads, monitoring, auth provider, payment processor), passing user data as an argument?',
            'Is user data included in a webhook, callback payload, or emitted event destined for an external system?',
            'Can the receiving party be identified as first-party (same org) or third-party (separate vendor)?',
        ],
        examples: [
            {
                kind: 'positive',
                label: 'Positive match',
                language: 'javascript',
                code: [
                    'function onPurchaseComplete(order) {',
                    '  db.orders.save(order);',
                    '  mixpanel.track("purchase", {',
                    '    userId: order.userId,',
                    '    email: order.customerEmail,',
                    '    total: order.total',
                    '  });',
                    '}',
                ].join('\n'),
                reasoning: [
                    '`mixpanel.track(...)` calls into an imported third-party analytics SDK.',
                    'The call passes `userId` and `customerEmail` - both user-linked fields.',
                    'Mixpanel is an external vendor, not part of the first-party backend.',
                ],
                conclusion: '`THIRD_PARTY_SHARING_COLLECTION`, confidence: high, entity: third_party.',
            },
            {
                kind: 'negative',
                label: 'Negative (non-match)',
                language: 'javascript',
                code: 'await internalOrdersService.save(order);',
                reasoning: [
                    "The call target is the application's own internal service module.",
                    'Nothing indicates an external vendor, domain, or SDK.',
                ],
                conclusion:
                    'No match for third-party sharing - internal first-party data handling. ' +
                    '(If `order` contains newly-read user data, this span may still qualify ' +
                    'separately under FP-01.)',
            },
        ],
        crossReferences: ['FP-01'],
    },
    {
        id: 'UC-03',
        category: 'USER_CHOICE_CONTROL',
        displayName: 'User Choice/Control',
        baseDescription:
            'How the application implements mechanisms that let users configure, consent to, ' +
            'opt in/out of, or otherwise control the collection, use, or sharing of their ' +
            'information.',
        chainOfThought:
            "Look for code that reads or checks a user's preference, consent, or permission " +
            'state before performing a data operation, or that provides an interface/endpoint ' +
            'for the user to set such a state. This includes consent flags read from a database ' +
            'or session, conditional branches gated on a preference, device-level ' +
            'permission-request handling, and settings/preference update endpoints. A data ' +
            'operation that runs unconditionally, with no check against a user-settable flag, ' +
            'does not qualify - the gating logic itself must be present, not just nearby ' +
            'PII-handling code.',
        elicitationQuestions: [
            'Is there a boolean/enum flag representing user consent, preference, or opt-in/opt-out status being read and branched on before a data operation proceeds?',
            'Is there an endpoint, form handler, or function whose purpose is to let the user set or change such a flag?',
            'Is there a device-level permission request/check gating subsequent data collection?',
            "If a data operation is present, does its execution actually depend on the user's choice, or does it run regardless of any preference?",
        ],
        examples: [
            {
                kind: 'positive',
                label: 'Positive match',
                language: 'python',
                code: [
                    'def send_marketing_email(user):',
                    '    if user.marketing_opt_in:',
                    '        email_service.send(user.email, template="promo")',
                ].join('\n'),
                reasoning: [
                    '`user.marketing_opt_in` is a user-settable preference flag.',
                    'The data operation (`email_service.send`) is conditionally gated on that flag via the `if` check.',
                    'This is exactly the pattern of choice/control gating a data-related action.',
                ],
                conclusion:
                    '`USER_CHOICE_CONTROL`, confidence: high. (This span may also qualify under ' +
                    'TP-02 if `email_service` is an external provider - multi-category matches ' +
                    'are expected and should both be emitted.)',
            },
            {
                kind: 'negative',
                label: 'Negative (non-match)',
                language: 'python',
                code: [
                    'def send_receipt_email(user, order):',
                    '    email_service.send(user.email, template="receipt", data=order)',
                ].join('\n'),
                reasoning: [
                    'No conditional check against any preference/consent flag - the email always sends.',
                    'No settings or permission endpoint is present in this span.',
                ],
                conclusion:
                    'No match for User Choice/Control - unconditional data use, not a control ' +
                    'mechanism. (Transactional messages are often legitimately unconditional; ' +
                    'that is a policy judgment for the downstream comparison stage, not this ' +
                    'detector.)',
            },
        ],
        crossReferences: ['TP-02'],
    },
    {
        id: 'UA-04',
        category: 'USER_ACCESS_EDIT_DELETION',
        displayName: 'User Access, Edit, & Deletion',
        baseDescription:
            'How the application implements functionality that lets users view, retrieve, ' +
            'correct, export, or delete their own stored information.',
        chainOfThought:
            'Look for code paths whose purpose is to let a user act on their own stored ' +
            "record: read endpoints returning a user's own profile or data, update endpoints " +
            "modifying a user's own record, delete operations scoped to the requesting user's " +
            'own identifier, and bulk-export or "download my data" handlers. The key ' +
            "discriminator is scope - the operation must be scoped to the requesting user's " +
            'own identifier, not an administrative or unscoped operation touching arbitrary ' +
            "users' records. An admin panel that lets staff act on any user's data is a " +
            'different concern (see DS-06), not this category.',
        elicitationQuestions: [
            "Does this code implement a read, update, or delete operation whose target record is scoped to the currently authenticated/requesting user's own identifier?",
            'Is there a data-export or "download my data" handler assembling a user\'s own records into an exportable format?',
            "Is the operation self-service (initiated by the user, about their own data) rather than administrative (staff acting on another user's data)?",
        ],
        examples: [
            {
                kind: 'positive',
                label: 'Positive match',
                language: 'python',
                code: [
                    '@app.route("/account", methods=["DELETE"])',
                    '@login_required',
                    'def delete_account():',
                    '    db.users.delete_one({"_id": current_user.id})',
                    '    db.orders.delete_many({"user_id": current_user.id})',
                    '    return jsonify(status="deleted")',
                ].join('\n'),
                reasoning: [
                    '`@login_required` scopes the action to the authenticated user.',
                    "Both delete operations filter by `current_user.id` - the requester's own identifier.",
                    'This is a self-service account/data deletion path.',
                ],
                conclusion: '`USER_ACCESS_EDIT_DELETION`, confidence: high.',
            },
            {
                kind: 'negative',
                label: 'Negative (non-match)',
                language: 'python',
                code: [
                    '@app.route("/admin/users/<user_id>", methods=["DELETE"])',
                    '@admin_required',
                    'def admin_delete_user(user_id):',
                    '    db.users.delete_one({"_id": user_id})',
                ].join('\n'),
                reasoning: [
                    "Guarded by `@admin_required`, not scoped to the requester's own account.",
                    "`user_id` is an arbitrary path parameter - staff can target any user's record.",
                ],
                conclusion:
                    'No match for User Access/Edit/Deletion in the self-service sense - this is ' +
                    'an administrative operation, better evaluated under DS-06 (is access ' +
                    'control adequate here?) than this category.',
            },
        ],
        crossReferences: ['DS-06'],
    },
    {
        id: 'DR-05',
        category: 'DATA_RETENTION',
        displayName: 'Data Retention',
        baseDescription:
            'How the application determines, enforces, or manages how long user information ' +
            'persists before it is purged, archived, or expired.',
        chainOfThought:
            'Look for code that establishes or enforces a time bound on stored user data: TTL ' +
            'fields on a database record or cache entry, scheduled/cron jobs whose purpose is ' +
            'to delete or archive aged records, session/cache expiry configuration, and ' +
            'log-rotation settings that bound how long logs (potentially containing user data) ' +
            'are kept. The *absence* of a retention mechanism is not itself something to ' +
            'annotate - only flag code that positively implements one.',
        elicitationQuestions: [
            'Does this code set an expiry/TTL value on a stored record, cache entry, or session?',
            'Is there a scheduled job, cron task, or periodic function whose purpose is to delete, purge, or archive records older than some threshold?',
            'Does log, cache, or session configuration specify a rotation or expiry duration?',
        ],
        examples: [
            {
                kind: 'positive',
                label: 'Positive match',
                language: 'python',
                code: [
                    '@scheduler.scheduled_job("cron", hour=3)',
                    'def purge_old_sessions():',
                    '    cutoff = datetime.utcnow() - timedelta(days=30)',
                    '    db.sessions.delete_many({"last_active": {"$lt": cutoff}})',
                ].join('\n'),
                reasoning: [
                    'This is a scheduled job that runs periodically (`@scheduler.scheduled_job`).',
                    'It computes a 30-day cutoff and deletes session records older than it.',
                    'This directly implements a retention/expiry policy for stored user session data.',
                ],
                conclusion: '`DATA_RETENTION`, confidence: high.',
            },
            {
                kind: 'negative',
                label: 'Negative (non-match)',
                language: 'python',
                code: [
                    'db.sessions.insert_one({',
                    '    "user_id": user.id, "token": token, "last_active": datetime.utcnow()',
                    '})',
                ].join('\n'),
                reasoning: [
                    'This writes a session record but sets no TTL/expiry field.',
                    'It is not part of any scheduled cleanup visible in this span.',
                ],
                conclusion:
                    'No match for Data Retention - this is a plain first-party storage ' +
                    'operation (flag under FP-01 instead). Retention only applies once an ' +
                    'actual expiry mechanism exists somewhere in the codebase.',
            },
        ],
        crossReferences: ['FP-01'],
    },
    {
        id: 'DS-06',
        category: 'DATA_SECURITY',
        displayName: 'Data Security',
        baseDescription:
            'How the application implements technical safeguards protecting stored or ' +
            'transmitted user information from unauthorized access, disclosure, or ' +
            'modification.',
        chainOfThought:
            'Look for code that positively implements a protective control around user data: ' +
            'encryption or hashing calls applied to sensitive fields before storage or ' +
            'transmission, authorization/access-control checks guarding a data-access path, ' +
            'input validation/sanitization applied before persisting user-supplied data, and ' +
            'secure-transport configuration (TLS/HTTPS enforcement). As with retention, only ' +
            'flag code that implements a safeguard - the mere presence of sensitive data being ' +
            'read or stored elsewhere is not itself a security annotation; that belongs to ' +
            'FP-01 or TP-02 instead.',
        elicitationQuestions: [
            'Does this code call an encryption, hashing, or signing function on user data before storing or sending it?',
            "Does this code check the requester's authorization/role/ownership before allowing access to a data-bearing operation?",
            'Does this code validate, sanitize, or escape user-supplied input before it is persisted or used in a query/command?',
            'Does this code configure or enforce a secure transport mechanism (TLS, HTTPS-only cookies, secure headers) for a data-carrying connection?',
        ],
        examples: [
            {
                kind: 'positive',
                label: 'Positive match',
                language: 'python',
                code: [
                    'def set_password(user, raw_password):',
                    '    hashed = bcrypt.hashpw(raw_password.encode(), bcrypt.gensalt())',
                    '    db.users.update_one({"_id": user.id}, {"$set": {"password_hash": hashed}})',
                ].join('\n'),
                reasoning: [
                    '`bcrypt.hashpw` is a cryptographic hashing call applied to the raw password before storage.',
                    'Only the hash, not the plaintext, is persisted.',
                    'This is a direct technical safeguard over sensitive user data.',
                ],
                conclusion: '`DATA_SECURITY`, confidence: high.',
            },
            {
                kind: 'negative',
                label: 'Negative (non-match)',
                language: 'python',
                code: [
                    'def set_password(user, raw_password):',
                    '    db.users.update_one({"_id": user.id}, {"$set": {"password": raw_password}})',
                ].join('\n'),
                reasoning: [
                    'The raw password is stored directly - no hashing, encryption, or other safeguard is applied.',
                    'No authorization check, sanitization, or transport control appears in this span either.',
                ],
                conclusion:
                    'No match for Data Security - no protective mechanism is implemented. (This ' +
                    'span would instead be flagged under FP-01 for storing the password; a ' +
                    'downstream comparison against a policy that promises "passwords are ' +
                    'securely hashed" would surface a real inconsistency here - but that ' +
                    'judgment belongs to the comparison stage, not this rule.)',
            },
        ],
        crossReferences: ['UA-04'],
    },
    {
        id: 'DNT-07',
        category: 'DO_NOT_TRACK',
        displayName: 'Do Not Track',
        baseDescription:
            'How the application detects browser- or device-level tracking-preference signals ' +
            '- such as the DNT header, Global Privacy Control (GPC), or platform-level App ' +
            'Tracking Transparency (ATT) status - and conditions its tracking, analytics, or ' +
            'advertising behavior on those signals.',
        chainOfThought:
            'When examining a code span, first look for a read of a tracking-preference ' +
            'signal: the `DNT` HTTP header, the `navigator.doNotTrack` / `window.doNotTrack` ' +
            'JS property, the `Sec-GPC` header, or a platform tracking-authorization API (iOS ' +
            '`ATTrackingManager`, Android advertising ID consent checks). Reading the signal is ' +
            'only half the pattern - check whether it is actually used to gate subsequent ' +
            'behavior, such as skipping the initialization of an analytics/ad SDK or ' +
            'withholding a tracking identifier. A signal that is read into a variable but ' +
            'never referenced again (dead read) does not count as honoring it; the read must ' +
            'change what happens next.',
        elicitationQuestions: [
            'Does this code read a DNT header, `navigator.doNotTrack`, a `Sec-GPC` header, or a platform tracking-authorization status?',
            "Does the code branch on that signal's value?",
            'Is a tracking-related operation (analytics init, ad SDK load, tracking cookie/identifier set) actually gated behind that branch?',
            "If the signal is read but the branch doesn't affect any tracking-related call, is this a dead read rather than genuine honoring?",
        ],
        examples: [
            {
                kind: 'positive',
                label: 'Positive match',
                language: 'javascript',
                code: [
                    'function initAnalytics() {',
                    '  const dnt = navigator.doNotTrack === "1" || window.doNotTrack === "1";',
                    '  if (!dnt) {',
                    "    ga('create', 'UA-XXXXX-Y', 'auto');",
                    "    ga('send', 'pageview');",
                    '  }',
                    '}',
                ].join('\n'),
                reasoning: [
                    'Reads `navigator.doNotTrack` / `window.doNotTrack`, the standard DNT signal properties.',
                    'Branches on `!dnt`.',
                    'The analytics tracker initialization (`ga(...)`) is gated behind that branch - the signal is genuinely honored.',
                ],
                conclusion: '`DO_NOT_TRACK`, confidence: high.',
            },
            {
                kind: 'negative',
                label: 'Negative (non-match)',
                language: 'javascript',
                code: [
                    'function initAnalytics() {',
                    '  const dnt = navigator.doNotTrack === "1";',
                    '  console.log("DNT signal:", dnt);',
                    "  ga('create', 'UA-XXXXX-Y', 'auto');",
                    "  ga('send', 'pageview');",
                    '}',
                ].join('\n'),
                reasoning: [
                    'The DNT signal is read into `dnt`.',
                    '`dnt` is only logged - it never gates the `ga(...)` calls below, which fire unconditionally.',
                ],
                conclusion:
                    'No match for Do Not Track - the signal is read but not enforced. This ' +
                    'asymmetry (read-but-ignored) is itself useful evidence for the downstream ' +
                    'comparison stage: a policy claiming "we honor DNT signals" would be ' +
                    'contradicted by this exact pattern.',
            },
        ],
        crossReferences: ['UC-03', 'TP-02'],
    },
    {
        id: 'AI-08',
        category: 'AI_USAGE',
        displayName: 'AI/ML Usage & Automated Decision-Making (custom category - not part of OPP-115)',
        baseDescription:
            'How the application processes user information using AI/ML models - including ' +
            "sending user data to a model or AI API for inference, using a model's output to " +
            'make or influence a decision about a user, or incorporating user data into a ' +
            'dataset used to train or fine-tune a model.',
        chainOfThought:
            'When examining a code span, first identify whether it invokes any model-related ' +
            'operation: a call to a local ML inference function, a call to an LLM/AI API ' +
            '(OpenAI, Anthropic, a hosted classifier, a recommendation or risk-scoring model), ' +
            'or code that appends a record to a training/fine-tuning dataset. Then classify ' +
            'which of three sub-patterns applies, since they carry different implications: ' +
            '(a) Inference use - user data is sent to a model for a one-off prediction, ' +
            'classification, or generation. ' +
            "(b) Automated decision-making - a model's output directly drives an outcome " +
            'affecting the user (approval/denial, content moderation, ranking, ' +
            'personalization) with no human review visible in this span. ' +
            '(c) Training/fine-tuning use - user data is written into a dataset that will ' +
            'update model weights. This differs from ordinary storage (FP-01) because model ' +
            'weights generally cannot be selectively "unlearned" - deleting the source record ' +
            "later (UA-04) may not actually remove the user's influence on the trained model. " +
            'A model call operating only on anonymized or aggregate data, with no per-user ' +
            'linkage and no individual decision made, is weaker evidence and should be flagged ' +
            'at low confidence or not at all.',
        elicitationQuestions: [
            'Does this code send user-linked data as input to an ML model or AI API - first-party or external?',
            "Does this code use a model's output to make, filter, or influence a decision about a specific user without a visible human-review step?",
            'Does this code write user data into a training or fine-tuning dataset?',
            'If the call goes to an external AI provider, does this span also warrant a TP-02 flag for the data leaving the first-party boundary?',
            'Is the input actually user-linked, or is it anonymized/aggregate data with no individual decision downstream?',
        ],
        examples: [
            {
                kind: 'positive',
                label: 'Positive match (inference + automated decision-making)',
                language: 'python',
                code: [
                    'def moderate_comment(user_id, comment_text):',
                    '    response = openai_client.chat.completions.create(',
                    '        model="gpt-x",',
                    '        messages=[{"role": "user", "content": f"Is this toxic? {comment_text}"}]',
                    '    )',
                    '    verdict = response.choices[0].message.content',
                    '    if "toxic" in verdict.lower():',
                    '        db.comments.update_one(',
                    '            {"user_id": user_id, "text": comment_text},',
                    '            {"$set": {"status": "blocked"}}',
                    '        )',
                ].join('\n'),
                reasoning: [
                    '`openai_client.chat.completions.create` sends user-generated content, implicitly linked to `user_id`, to an external LLM API for inference.',
                    "The model's output (`verdict`) directly drives an automated action (`status: blocked`) with no human review shown in this span.",
                    'This is simultaneously AI/ML processing of user data and automated decision-making affecting the user.',
                ],
                conclusion:
                    '`AI_USAGE`, confidence: high, entity: third_party (external LLM provider). ' +
                    'Also cross-flag `THIRD_PARTY_SHARING_COLLECTION` (TP-02), since the comment ' +
                    'text leaves the first-party boundary.',
            },
            {
                kind: 'positive',
                label: 'Positive match (training/fine-tuning use)',
                language: 'python',
                code: [
                    'def collect_training_sample(user_id, chat_transcript, feedback_rating):',
                    '    db.training_data.insert_one({',
                    '        "user_id": user_id,',
                    '        "transcript": chat_transcript,',
                    '        "rating": feedback_rating,',
                    '        "used_for_finetuning": True',
                    '    })',
                ].join('\n'),
                reasoning: [
                    "The function persists a user's chat transcript into a `training_data` collection.",
                    'The `used_for_finetuning` flag and collection name indicate this record is intended for a model fine-tuning pipeline.',
                    'Because model weights are difficult to selectively unlearn, this creates a retention/deletion complication distinct from ordinary storage.',
                ],
                conclusion:
                    '`AI_USAGE`, confidence: high, sub-pattern: training/fine-tuning use. ' +
                    "Cross-reference DR-05 and UA-04 - if the org's policy promises data " +
                    'deletion on request, a developer should verify whether "deletion" here ' +
                    'actually reaches data already baked into a fine-tuned model.',
            },
            {
                kind: 'negative',
                label: 'Negative (non-match)',
                language: 'python',
                code: [
                    'def generate_weekly_report():',
                    '    stats = db.orders.aggregate([',
                    '        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}',
                    '    ])',
                    '    summary = openai_client.chat.completions.create(',
                    '        model="gpt-x",',
                    '        messages=[{"role": "user", "content": f"Summarize this aggregate sales data: {stats}"}]',
                    '    )',
                    '    return summary',
                ].join('\n'),
                reasoning: [
                    'The AI call processes only an aggregated total with no individual user identifier present in the input.',
                    'No output from the model is used to make a decision about any specific user.',
                ],
                conclusion:
                    'No match (or low-confidence note only) - AI processing of non-personal ' +
                    'aggregate data, not user-linked AI processing. Would warrant a flag only ' +
                    'if the aggregation group were small enough to risk re-identification.',
            },
        ],
        crossReferences: ['TP-02', 'DR-05', 'UA-04'],
    },
];

/** Maps a rule ID (e.g. 'TP-02') to its category enum name. */
export const CATEGORY_BY_RULE_ID: ReadonlyMap<string, CategoryName> = new Map(
    PRIVACY_RULES.map(rule => [rule.id, rule.category])
);

export function getRule(category: CategoryName): PrivacyRule {
    const rule = PRIVACY_RULES.find(c => c.category === category);
    if (!rule) {
        throw new Error(`priv-audit: no detection rule defined for category "${category}"`);
    }
    return rule;
}
