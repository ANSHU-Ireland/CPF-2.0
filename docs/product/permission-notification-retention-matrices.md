# Permission Matrix (v0.1)

Legend: ✅ allowed · 🔒 allowed with condition · ❌ denied. All checks are
server-side; deny-by-default. Candidate access is token-scoped to own sessions.

| Capability | platform_admin | org_admin | hiring_manager | reviewer | support_agent | candidate |
|---|---|---|---|---|---|---|
| Manage employers, subscriptions, flags | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Publish framework template versions | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Configure org users/roles | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Configure retention policy | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Create job profiles / invitations | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| View candidate PII | ❌ | ✅ | 🔒 own jobs | 🔒 assigned, pseudonymised where feasible | 🔒 JIT, audited | 🔒 self |
| View raw evidence (prompts, edits) | ❌ | ❌ | ❌ | ✅ assigned | 🔒 JIT for support case | 🔒 own via access request |
| View integrity signals | ❌ | ❌ | ❌ per default | ✅ assigned, context tab | 🔒 | 🔒 own |
| Score / create ledger claims / finalise | ❌ | ❌ | ❌ | ✅ assigned + calibrated | ❌ | ❌ |
| View evidence profile report | ❌ | ✅ | ✅ own jobs 🔒 after responsible-use ack | ✅ own reviews | 🔒 | 🔒 own summary + explanation |
| Export org data | ❌ | ✅ audited | ❌ | ❌ | ❌ | ❌ |
| Handle data-rights requests | 🔒 platform-level | ✅ | ❌ | ❌ | 🔒 triage only | ✅ raise own |
| Place/release legal hold | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Read audit log | ✅ platform scope | ✅ org scope | ❌ | ❌ | 🔒 case scope | ❌ |
| Kill-switch AI features | ✅ | ✅ org scope | ❌ | ❌ | ❌ | ❌ |

Rules:
- No role ever gets "set candidate outcome" — the capability does not exist.
- `platform_admin` never reads tenant candidate evidence except under a
  documented support/legal process with org consent (break-glass, dual-logged).
- Reviewer assignment requires valid calibration status (CPF-33) and no
  conflict-of-interest declaration.

# Notification Matrix (v0.1)

| Event | Candidate | Hiring manager | Reviewer | Org admin |
|---|---|---|---|---|
| Invitation sent / reminder / expiry warning | ✉️ | — | — | — |
| Invitation expired | ✉️ reissue route | ✉️ | — | — |
| Session submitted | ✉️ receipt | ✉️ | ✉️ assignment | — |
| Technical failure during session | ✉️ recovery link | — | — | ✉️ if unresolved |
| Adjudication required | — | — | ✉️ both reviewers + lead | — |
| Review finalised → report ready | ✉️ status (not content) | ✉️ | — | — |
| Challenge / explanation request | ✉️ receipt + timeline | ✉️ | ✉️ if re-review | ✉️ |
| DSR received / due in 5 days / overdue | ✉️ receipt | — | — | ✉️ / escalating |
| Retention deletion 30 days ahead | — | — | — | ✉️ |

# Data Retention Matrix (defaults; org-configurable; DPIA-reviewed before pilot)

| Data category | Default retention | Clock starts | Deletion mode | Legal hold aware |
|---|---|---|---|---|
| Workspace evidence events | 180 days | Session terminal state | Anonymise→delete | Yes |
| Integrity signal events | 90 days | Session terminal state | Hard delete | Yes |
| Evidence profile + ledger claims | 365 days | Report issued | Anonymise→delete | Yes |
| Candidate identity record | 365 days after last activity | Last activity | Anonymise | Yes |
| Disclosure records | Life of evidence + 3 years | Acknowledgement | Retain (accountability) | Yes |
| Audit log | 730 days | Entry | Retain per policy | Yes |
| DSR case records | 3 years | Resolution | Retain | Yes |
