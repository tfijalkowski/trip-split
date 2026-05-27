# GitHub Issues — trip-split

> Mirrored from https://github.com/tfijalkowski/trip-split/issues  
> Last synced: 2026-05-26

---

## Milestone: Foundations

*F-01 google-sso + F-02 db-schema-rls — prerequisites dla wszystkich slices*

### #1 [F-01] Podłącz Google OAuth (zastąp signInWithPassword)
**Labels:** `foundation` `must-have`  
**Status:** OPEN  
**URL:** https://github.com/tfijalkowski/trip-split/issues/1

**Outcome:** Google OAuth wylądował; sesje oparte na cookie są poprawnie wystawiane i weryfikowane przez middleware; wszystkie chronione trasy wymagają zalogowanego użytkownika.

| Field | Value |
|---|---|
| Roadmap ID | F-01 |
| Change ID | `google-sso` |
| PRD refs | FR-001, FR-002, Access Control |
| Prerequisites | — |
| Parallel with | F-02 |
| Status | **ready** |

**Risk:** Klient Supabase i middleware są już na miejscu, ale używają `signInWithPassword`. Zmiana metody logowania wymaga dodania trasy callback (`/auth/callback`) i skonfigurowania zmiennych `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Bezpieczne podejście: wdróż OAuth atomicznie — nie zostawiaj obu metod jednocześnie aktywnych.

**Next step:** Run `/10x-plan google-sso` to start detailed planning.

---

### #2 [F-02] Schema DB + polityki RLS + Realtime
**Labels:** `foundation` `must-have`  
**Status:** OPEN  
**URL:** https://github.com/tfijalkowski/trip-split/issues/2

**Outcome:** Migracje dla tabel `profiles`, `groups`, `group_members`, `expenses`, `expense_participants` wylądowały; polityki RLS izolują dane grup; Supabase Realtime włączony na tabelach `expenses` i `expense_participants`.

| Field | Value |
|---|---|
| Roadmap ID | F-02 |
| Change ID | `db-schema-rls` |
| PRD refs | FR-003–FR-010, FR-015, FR-016, Business Logic, NFR |
| Prerequisites | — |
| Parallel with | F-01 |
| Status | **ready** |

**Risk:** RLS jest kluczowy dla guardrail bezpieczeństwa PRD: „uczestnik spoza grupy nie widzi żadnych danych finansowych innej grupy." Błąd w politykach może ujawnić dane innej grupy. Mitygacja: każdą politykę przetestuj jako osobny użytkownik bazy (nie superuser) przed merge'em migracji.

**Unlocks:** S-01, S-02, S-03, S-04

**Next step:** Run `/10x-plan db-schema-rls` to start detailed planning.

---

## Milestone: MVP Core

*S-01 group-join-flow → S-02 expense-balance-live (gwiazda) → S-03 settlement-lock*

### #3 [S-01] Tworzenie grupy, link zaproszenia, dołączenie
**Labels:** `slice` `must-have`  
**Status:** OPEN  
**URL:** https://github.com/tfijalkowski/trip-split/issues/3

**Outcome:** Użytkownik może stworzyć grupę wyjazdową, skopiować link zaproszenia i udostępnić go przez WhatsApp; inny zalogowany użytkownik może dołączyć do grupy klikając link.

| Field | Value |
|---|---|
| Roadmap ID | S-01 |
| Change ID | `group-join-flow` |
| PRD refs | FR-003, FR-004, FR-005 |
| Prerequisites | #1 (F-01 google-sso), #2 (F-02 db-schema-rls) |
| Parallel with | — |
| Status | proposed |

**Risk:** Link zaproszenia to jedyna metoda dołączania. Jeśli strona dołączania nie obsługuje poprawnie stanu „niezalogowany kliknął link" (redirect do logowania + powrót po logowaniu do właściwej grupy), użytkownik ląduje na stronie głównej zamiast w grupie. Mitygacja: obsłuż `redirect_to` jako parametr query w flow logowania.

**Next step:** Run `/10x-plan group-join-flow` after #1 and #2 are done.

---

### #4 [S-02] Dodawanie wydatku z podziałem + salda na żywo ⭐
**Labels:** `slice` `must-have` `north-star`  
**Status:** OPEN  
**URL:** https://github.com/tfijalkowski/trip-split/issues/4

**Outcome:** Użytkownik może dodać wydatek (opis, kwota, opcjonalna data; wybrani uczestnicy; podział równy domyślnie lub własny procentowy/kwotowy) i natychmiast widzieć aktualizację sald wszystkich uczestników grupy bez odświeżania strony; lista wydatków jest paginowana, filtrowalna po osobie, sortowana po dacie.

> ⭐ **Gwiazda przewodnia** — najmniejszy przepływ end-to-end, który udowadnia hipotezę produktu: kalkulacja sald działa poprawnie i aktualizuje się natychmiast.

| Field | Value |
|---|---|
| Roadmap ID | S-02 |
| Change ID | `expense-balance-live` |
| PRD refs | US-01, FR-006, FR-007, FR-008, FR-009, FR-010 |
| Prerequisites | #3 (S-01 group-join-flow) |
| Parallel with | — |
| Status | proposed |

**Risk:** „Saldo na żywo" wymaga Supabase Realtime subscription na tabelach `expenses`/`expense_participants`. Jeśli Realtime nie jest poprawnie skonfigurowany w F-02, subskrypcja nie zadziała bez żadnego błędu — tylko brak aktualizacji. Mitygacja: przetestuj subscription z dwóch osobnych sesji przeglądarki przed zamknięciem slice.

**Unknowns:** Gdzie żyje logika kalkulacji sald — po stronie bazy danych (SQL view/function) czy w kodzie aplikacji?

**Next step:** Run `/10x-plan expense-balance-live` after #3 is done.

---

### #5 [S-03] Zamknięcie i otwarcie rozliczenia
**Labels:** `slice` `must-have`  
**Status:** OPEN  
**URL:** https://github.com/tfijalkowski/trip-split/issues/5

**Outcome:** Twórca grupy może zamknąć rozliczenie — wszyscy uczestnicy widzą wyraźny status „zamknięte" i nie mogą dodawać, edytować ani usuwać wydatków; twórca może ponownie otworzyć rozliczenie, przywracając pełną edytowalność.

| Field | Value |
|---|---|
| Roadmap ID | S-03 |
| Change ID | `settlement-lock` |
| PRD refs | FR-015, FR-016 |
| Prerequisites | #4 (S-02 expense-balance-live) |
| Parallel with | #6 (S-04 expense-edit-delete) |
| Status | proposed |

**Risk:** Status zamknięcia musi być wymuszony po stronie serwera, nie tylko w UI — w przeciwnym razie uczestnik może obejść blokadę przez bezpośrednie wywołanie API. Mitygacja: każdy endpoint CRUD wydatków musi sprawdzać `group.status` przed wykonaniem operacji.

**Next step:** Run `/10x-plan settlement-lock` after #4 is done. Can be worked on in parallel with #6 (S-04).

---

## Milestone: Nice-to-Have

*S-04 expense-edit-delete — secondary success criterion*

### #6 [S-04] Edycja i usuwanie własnego wydatku
**Labels:** `slice` `nice-to-have`  
**Status:** OPEN  
**URL:** https://github.com/tfijalkowski/trip-split/issues/6

**Outcome:** Użytkownik może edytować i usunąć swój własny wydatek; saldo grupy aktualizuje się natychmiast po każdej zmianie (tak samo jak po dodaniu).

| Field | Value |
|---|---|
| Roadmap ID | S-04 |
| Change ID | `expense-edit-delete` |
| PRD refs | FR-011, FR-012 |
| Prerequisites | #4 (S-02 expense-balance-live) |
| Parallel with | S-03 (#5) |
| Status | proposed |

**Risk:** Usunięcie wydatku zmienia saldo wszystkich uczestników. Bez powiadomień (Non-Goals PRD) zmiana jest widoczna tylko w UI. Akceptowalne ograniczenie MVP — odnotowane w PRD FR-012.

**Next step:** Run `/10x-plan expense-edit-delete` after #4 is done. Can be worked on in parallel with #5 (S-03).
