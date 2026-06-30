# 1. How to Use This Document

This document categorizes and defines different types of personal data.

For each category below:

1. Treat the **definition** as the test for whether something belongs in this category at all.
2. Use the **sub-concepts** to report findings at the most specific level you can justify, rather than defaulting to the top-level category name. If nothing narrower fits confidently, the top-level category name is an acceptable fallback.
3. Use **cues / keywords** as a starting point for pattern-matching variable names, field names, log statements, and comments - not as a literal checklist. A field named `password` being written to a debug log is a finding; a CSS class named `password-strength-meter` is not. Judge by what the code does with the data, not just whether a keyword string appears.
4. Use the **code examples** to calibrate the kind of pattern that should be flagged, not as an exhaustive list of every form the issue can take.
5. A single line of code can belong to multiple categories - an email address is both *External:Identifying* and *Tracking:Contact*. Report every category that genuinely applies rather than forcing one best-fit label.

# 2. Categories of Personal Data

## 2.1 Internal - `pd:Internal`

Information that originates within the person and generally isn't observable by others unless the person discloses it: what they know, believe, feel, prefer, or use to prove who they are.

| Sub-concept | Class | Covers |
|---|---|---|
| Authenticating | `pd:Authenticating` | Passwords, PINs, security-question answers, recovery secrets |
| Knowledge & Belief | `pd:KnowledgeBelief` | Religious/philosophical beliefs, private thoughts, technical knowledge |
| Preference | `pd:Preference` | Favorites, interests, likes/dislikes, opinions, intentions, privacy preferences |
| Emotion / Mood | `pd:Emotion`, `pd:Mood` | Detected or self-reported emotional state |

**Cues / keywords:** `password`, `passwd`, `pwd`, `pin`, `secret`, `security_question`, `recovery_answer`, `mfa_secret`, `belief`, `interest`, `preference`, `favorite`, `opinion`, `mood`, `sentiment`

**Code examples:**

```python
# Plaintext credential storage - Internal/Authenticating
user.password = request.form["password"]
db.execute("INSERT INTO users (password) VALUES (?)", (user.password,))
```

```ts
// Inferred emotional state persisted without disclosure to the user - Internal/Emotion
await db.users.update(userId, { moodScore: sentimentModel.predict(message) });
```

## 2.2 External - `pd:External`

Information about the person that's observable by others without their active disclosure - physical traits, demographics, identity, health, ethnicity, sexuality, language, and behavior. This is usually where the most obviously sensitive "classic PII" lives.

| Sub-concept | Class | Covers |
|---|---|---|
| Identifying | `pd:Identifying` | Name, username, official IDs (passport, license), biometrics, photos |
| Medical & Health | `pd:MedicalHealth` | Diagnoses, prescriptions, disability status, DNA, blood type, mental health |
| Physical Characteristic | `pd:PhysicalCharacteristic` | Age, gender, height, weight, hair color, tattoos, piercings |
| Demographic | `pd:Demographic` | Geography, income bracket, aggregate physical traits |
| Ethnicity | `pd:Ethnicity` | Race, ethnic/national origin |
| Sexual | `pd:Sexual` | Sexual orientation, preferences, history |
| Behavioural | `pd:Behavioural` | Browsing history, call logs, personality inference, service usage patterns |
| Language / Nationality / Citizenship | `pd:Language`, `pd:Nationality`, `pd:Citizenship` | Spoken languages, accents, dialects, citizenship status |

**Cues / keywords:** `name`, `full_name`, `username`, `ssn`, `social_security`, `passport`, `driver_license`, `dob`, `date_of_birth`, `age`, `gender`, `ethnicity`, `race`, `nationality`, `diagnosis`, `medication`, `disability`, `dna`, `blood_type`, `sexual_orientation`, `biometric`, `fingerprint`, `face_id`, `browsing_history`, `call_log`

**Code examples:**

```python
# Health data logged in plaintext - External/MedicalHealth
logger.info(f"Patient {patient.name} diagnosed with {diagnosis}")
```

```ts
// Biometric template stored without encryption - External/Identifying
await fs.writeFile(`./templates/${userId}.dat`, faceEmbedding);
```

## 2.3 Household - `pd:Household`

Information about the home environment and shared household-level activity, as distinct from data tied to one individual.

| Sub-concept | Class | Covers |
|---|---| --- |
| Household Composition | `pd:HouseholdComposition` | Number/identity of household members, relationships within the home |
| Shared Devices & Accounts | `pd:SharedDevices`, `pd:SharedAccounts` | Smart-home devices, IoT sensors, shared logins tied to a residence |
| Household Resource Usage | `pd:ResourceUsage` | Utility consumption, subscriptions billed at the household/address level |

**Cues / keywords:** `household_id`, `family_account`, `shared_account`, `home_device`, `smart_home`, `iot_device`, `residents`, `household_size`, `utility_usage`

**Code example:**

```python
# Occupancy pattern for an entire household, not one consenting individual - Household
thermostat_log.write({"household_id": h_id, "occupancy_pattern": pattern, "timestamp": now})
```

## 2.4 Social - `pd:Social`

Information about the person's relationships, affiliations, and life in relation to others: family, friendships, professional life, public reputation, communications, and criminal history.

| Sub-concept | Class | Covers |
|---|---|---|
| Family | `pd:Family` | Marriage, divorce, offspring, parents, siblings, relationship status |
| Professional | `pd:Professional` | Job title, salary, employment history, education, performance evaluations |
| Public Life | `pd:PublicLife` | Marital status, political affiliation, religion, social status, reputation |
| Communication | `pd:Communication` | Email content, chat/social-media messages, voicemail |
| Criminal | `pd:Criminal` | Convictions, charges, pardons |
| Social Network | `pd:SocialNetwork` | Friends, connections, group memberships |

**Cues / keywords:** `spouse`, `marital_status`, `employer`, `job_title`, `salary`, `employment_history`, `education`, `religion`, `political_affiliation`, `email_body`, `message_content`, `chat_log`, `voicemail`, `criminal_record`, `conviction`, `friend_list`, `contacts`, `group_membership`

**Code example:**

```ts
// Full message content forwarded to a third-party analytics endpoint - Social/Communication
analytics.track("message_sent", { userId, body: message.text });
```

## 2.5 Financial - `pd:Financial`

Information about the person's monetary status, transactions, accounts, and asset ownership.

| Sub-concept | Class | Covers |
|---|---|---|
| Financial Account | `pd:FinancialAccount` | Bank accounts, payment/credit card numbers, account identifiers |
| Transactional | `pd:Transactional` | Purchases, income, credit score, loans, tax records, transactions |
| Ownership | `pd:Ownership` | Cars, houses, and other owned/rented possessions |
| Financial Status / Insurance | `pd:FinancialStatus`, `pd:Insurance` | General financial standing, insurance policies |

**Cues / keywords:** `credit_card`, `card_number`, `cvv`, `bank_account`, `routing_number`, `iban`, `account_number`, `income`, `credit_score`, `loan`, `tax_id`, `transaction_id`, `purchase_history`, `insurance_policy`

**Code example:**

```python
# Raw card number persisted instead of a tokenized reference - Financial/FinancialAccount
order.card_number = form["card_number"]
db.save(order)
```

## 2.6 Tracking - `pd:Tracking`

Information that can be used to locate, contact, or persistently identify a person or their device across sessions and contexts.

| Sub-concept | Class | Covers |
|---|---|---|
| Contact | `pd:Contact` | Email address, physical address, telephone number |
| Location | `pd:Location` | GPS coordinates, home/work location, travel history |
| Device-based | `pd:DeviceBased` | IP address, MAC address, browser fingerprint, device software |
| Identifier | `pd:Identifier`, `pd:DigitalFingerprint` | Cookie IDs, advertising IDs, persistent device/user identifiers |

**Cues / keywords:** `email`, `phone`, `address`, `zip`, `postal_code`, `gps`, `latitude`, `longitude`, `location`, `geo`, `ip_address`, `mac_address`, `device_id`, `fingerprint`, `cookie_id`, `advertising_id`, `user_agent`, `tracking_id`

**Code example:**

```ts
// Raw IP retained alongside a user ID with no anonymization or retention limit - Tracking/DeviceBased
db.requests.insert({ userId, ip: req.headers["x-forwarded-for"], timestamp: Date.now() });
```

## 2.7 Historical - `pd:Historical`

Information about events in a person's life - whether directly experienced or just shaped by them - that reveal background or context about the individual over time.

| Sub-concept | Class | Covers |
|---|---|---|
| Life History | `pd:LifeHistory` | Personal milestones and historically significant events tied to the individual |

**Cues / keywords:** `life_event`, `biography`, `timeline`, `milestone`, `past_event` - be careful: generic terms like `event_log` or `history` usually refer to application telemetry, not personal history; only flag when the content is clearly about the person's life, not system activity.

**Code example:**

```python
# Free-text personal history field attached to a permanent profile record - Historical/LifeHistory
profile.biography = request.form["life_story"]
```