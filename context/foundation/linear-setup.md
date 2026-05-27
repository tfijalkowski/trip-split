# Linear Setup Summary

> Date: 2026-05-27  
> Workspace: https://linear.app/10x-trip-split

## What was done

### 1. Project created

A new Linear project **10x-trip-split** was created under the existing team `10xDevs-trip-split`.

### 2. Onboarding issues removed

Four default Linear onboarding issues (10X-1 through 10X-4) were cancelled:
- Get familiar with Linear
- Set up your teams
- Connect your tools
- Import your data

### 3. Milestones created

Three milestones were created matching the GitHub milestone structure:

| Milestone | Description |
|---|---|
| **Foundations** | F-01 google-sso + F-02 db-schema-rls — prerequisites dla wszystkich slices |
| **MVP Core** | S-01 group-join-flow → S-02 expense-balance-live → S-03 settlement-lock |
| **Nice-to-Have** | S-04 expense-edit-delete — secondary success criterion |

### 4. Issues mirrored from GitHub

Six issues were created from `context/foundation/tasks-github.md`, each with full description, roadmap metadata, risk notes, and a GitHub link attachment:

| Linear ID | GitHub | Title | Milestone | Priority |
|---|---|---|---|---|
| 10X-5 | #1 | [F-01] Podłącz Google OAuth (zastąp signInWithPassword) | Foundations | High |
| 10X-6 | #2 | [F-02] Schema DB + polityki RLS + Realtime | Foundations | High |
| 10X-7 | #3 | [S-01] Tworzenie grupy, link zaproszenia, dołączenie | MVP Core | High |
| 10X-8 | #4 | [S-02] Dodawanie wydatku z podziałem + salda na żywo ⭐ | MVP Core | Urgent |
| 10X-9 | #5 | [S-03] Zamknięcie i otwarcie rozliczenia | MVP Core | High |
| 10X-10 | #6 | [S-04] Edycja i usuwanie własnego wydatku | Nice-to-Have | Medium |

### Priority mapping

| GitHub label | Linear priority |
|---|---|
| `north-star` | Urgent (1) |
| `must-have` | High (2) |
| `nice-to-have` | Medium (3) |

## Source of truth

GitHub Issues remain the canonical source — `context/foundation/tasks-github.md` is the local mirror. Linear is the planning/tracking layer. Keep all three in sync manually when issue status changes.
