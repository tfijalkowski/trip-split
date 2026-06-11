---

## project: TripSplit
version: 1
status: draft
created: 2026-05-26
updated: 2026-06-11
prd_version: 4
main_goal: speed
top_blocker: capacity

# Roadmap: TripSplit

> Derived from `context/foundation/prd-v3.md` (v3) + `context/foundation/prd-v4.md` (v4) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Manualne rozliczanie wydatków po wyjeździe wakacyjnym to Excel + WhatsApp — czasochłonne i podatne na błędy, szczególnie gdy ktoś był krócej lub nie uczestniczył w konkretnych wydatkach. TripSplit zastępuje ten flow aplikacją webową, w której każdy uczestnik dodaje wydatki z elastycznym podziałem, a salda aktualizują się na żywo bez odświeżania strony. Projekt jest jednocześnie realnym produktem i narzędziem edukacyjnym — celem jest nauka budowania aplikacji na rzeczywistym problemie.

## North star

**S-02: Dodaj wydatek → salda na żywo** — najwcześniejszy możliwy moment, w którym działające saldo grupy pojawia się na ekranie po dodaniu wydatku bez odświeżania, bez ręcznego liczenia; udowadnia hipotezę produktu — rdzeń TripSplita działa — i jest bezpośrednim dowodem primary success criterion PRD.

> Gwiazda przewodnia to tutaj: najmniejszy przepływ end-to-end, który możesz pokazać znajomym i powiedzieć „to działa". Hipoteza produktu (założenie, które musi być prawdą, żeby aplikacja miała sens): kalkulacja sald jest matematycznie poprawna i aktualizuje się natychmiast dla wszystkich uczestników grupy. Jeśli S-02 działa, rdzeń jest udowodniony; wszystko inne to już szczegóły.

## At a glance


| ID   | Change ID            | Outcome (użytkownik może …)                                      | Prerequisites | PRD refs                                                                                            | Status   |
| ---- | -------------------- | ---------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------- | -------- |
| F-01 | google-sso           | (fundacja) Google OAuth działa; sesje oparte na cookie           | —             | FR-001, FR-002, Access Control                                                                      | done     |
| F-02 | db-schema-rls        | (fundacja) Schema + RLS wylądowały; Realtime włączony            | —             | FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-015, FR-016, Business Logic, NFR | done     |
| S-01 | group-join-flow      | stworzyć grupę, skopiować link zaproszenia i dołączyć przez link | F-01, F-02    | FR-003, FR-004, FR-005                                                                              | done     |
| S-02 | expense-balance-live | dodać wydatek z podziałem i widzieć salda na żywo                | S-01          | US-01, FR-006, FR-007, FR-008, FR-009, FR-010                                                       | done     |
| S-03 | settlement-lock             | zamknąć i otworzyć rozliczenie (twórca grupy)                    | S-02          | FR-015, FR-016                                                                                      | proposed |
| S-04 | expense-edit-delete         | edytować i usunąć swój własny wydatek                            | S-02          | FR-011, FR-012                                                                                      | proposed |
| S-05 | user-profile-display-name   | zmienić swoją nazwę wyświetlaną i widzieć ją w całej aplikacji   | F-01, F-02    | US-02, FR-017, FR-018                                                                               | blocked  |


## Streams

Tabela nawigacyjna — grupuje pozycje dzielące wspólny łańcuch zależności. Kanoniczna kolejność nadal żyje w grafie zależności poniżej; ta tabela to proponowany porządek czytania przez dwa niezależne tory pracy.


| Stream | Temat                              | Łańcuch                           | Uwaga                                                       |
| ------ | ---------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| A      | Uwierzytelnienie → Główny przepływ | `F-01` → `S-01` → `S-02` → `S-03` | Główna ścieżka must-have; F-02 (Stream B) dołącza przy S-01 |
| B      | Schemat danych                     | `F-02`                            | Równoległy z F-01; dołącza do Streamu A przy S-01           |
| C      | Zarządzanie wydatkami              | `S-03` → `S-04`                   | Nice-to-have; sekwencyjnie po S-03 (kolizje plików w GroupExpensesIsland + [id].astro) |
| D      | Profil użytkownika                 | `S-05`                            | Niezależny od S-03/S-04; rusza gdy Open Question o limit znaków (OQ-2) zostanie zamknięte |


## Baseline

Stan kodu źródłowego na dzień 2026-05-26 (auto-skan + potwierdzenie użytkownika).
Fundacje poniżej zakładają, że wymienione elementy są obecne i NIE scaffoldują ich od zera.

- **Frontend:** present — Astro 6.3.1 + React 19, shadcn/ui (Radix + Tailwind), routing plikowy w `src/pages/`, stan przez React hooks
- **Backend / API:** partial — middleware (`src/middleware.ts`) + 3 endpointy auth (`src/pages/api/auth/`); brak endpointów dla grup i wydatków
- **Data:** partial — Supabase JS SDK + `supabase/config.toml`; brak migracji, brak `seed.sql`, brak polityk RLS
- **Auth:** partial — klient Supabase (`src/lib/supabase.ts`) + middleware chroni `/dashboard`; aktualnie `signInWithPassword`, nie Google OAuth wymagane przez PRD
- **Deploy / infra:** present — `wrangler.jsonc` (Cloudflare Workers) + `.github/workflows/ci.yml`
- **Observability:** absent — brak logowania, brak error trackingu, brak metryk

## Foundations

### F-01: Google SSO

- **Outcome:** (fundacja) Google OAuth wylądował; sesje oparte na cookie są poprawnie wystawiane i weryfikowane przez middleware; wszystkie chronione trasy wymagają zalogowanego użytkownika.
- **Change ID:** `google-sso`
- **PRD refs:** FR-001, FR-002, Access Control
- **Unlocks:** S-01 (i transytywnie S-02, S-03, S-04) — żaden slice nie może działać bez zalogowanego użytkownika
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Klient Supabase i middleware są już na miejscu, ale używają `signInWithPassword`. Zmiana metody logowania wymaga dodania trasy callback (`/auth/callback`) i skonfigurowania zmiennych `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Bezpieczne podejście: wdróż OAuth atomicznie — nie zostawiaj obu metod jednocześnie aktywnych.
- **Status:** done

### F-02: Schemat bazy danych + RLS + Realtime

- **Outcome:** (fundacja) Migracje dla tabel `profiles`, `groups`, `group_members`, `expenses`, `expense_participants` wylądowały; polityki RLS izolują dane grup; Supabase Realtime włączony na tabelach `expenses` i `expense_participants`.
- **Change ID:** `db-schema-rls`
- **PRD refs:** FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-015, FR-016, Business Logic, NFR (izolacja danych grup)
- **Unlocks:** S-01, S-02, S-03, S-04 — każdy slice wymaga tabel i polityk dostępu; Realtime jest niezbędny dla wymagania „saldo aktualizuje się natychmiast" z Business Logic
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** RLS jest kluczowy dla guardrail bezpieczeństwa PRD: „uczestnik spoza grupy nie widzi żadnych danych finansowych innej grupy." Błąd w politykach może ujawnić dane innej grupy. Mitygacja: każdą politykę przetestuj jako osobny użytkownik bazy (nie superuser) przed merge'em migracji.
- **Status:** done

## Slices

### S-01: Tworzenie grupy, link zaproszenia i dołączenie

- **Outcome:** użytkownik może stworzyć grupę wyjazdową, skopiować link zaproszenia i udostępnić go przez WhatsApp; inny zalogowany użytkownik może dołączyć do grupy klikając link.
- **Change ID:** `group-join-flow`
- **PRD refs:** FR-003, FR-004, FR-005
- **Prerequisites:** F-01, F-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Link zaproszenia to jedyna metoda dołączania. Jeśli strona dołączania nie obsługuje poprawnie stanu „niezalogowany kliknął link" (redirect do logowania + powrót po logowaniu do właściwej grupy), użytkownik ląduje na stronie głównej zamiast w grupie. Mitygacja: obsłuż `redirect_to` jako parametr query w flow logowania.
- **Status:** done

### S-02: Dodawanie wydatku z podziałem + salda na żywo

- **Outcome:** użytkownik może dodać wydatek (opis, kwota, opcjonalna data; wybrani uczestnicy; podział równy domyślnie lub własny procentowy/kwotowy) i natychmiast widzieć aktualizację sald wszystkich uczestników grupy bez odświeżania strony; lista wydatków jest paginowana, filtrowalna po osobie, sortowana po dacie.
- **Change ID:** `expense-balance-live`
- **PRD refs:** US-01, FR-006, FR-007, FR-008, FR-009, FR-010
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Gdzie żyje logika kalkulacji sald — po stronie bazy danych (SQL view lub function) czy w kodzie aplikacji? Obie opcje są wykonalne; SQL view jest prostsze do testowania, kod aplikacji łatwiejsze do debugowania. — Owner: TBD. Block: nie.
- **Risk:** „Saldo na żywo" wymaga Supabase Realtime subscription na tabelach `expenses`/`expense_participants`. Jeśli Realtime nie jest poprawnie skonfigurowany w F-02 (publikacja tabel), subskrypcja nie zadziała i nie będzie żadnego błędu — tylko brak aktualizacji. Mitygacja: przetestuj subscription z dwóch osobnych sesji przeglądarki przed zamknięciem slice.
- **Status:** done

### S-03: Zamknięcie i otwarcie rozliczenia

- **Outcome:** twórca grupy może zamknąć rozliczenie — wszyscy uczestnicy widzą wyraźny status „zamknięte" i nie mogą dodawać, edytować ani usuwać wydatków; twórca może ponownie otworzyć rozliczenie, przywracając pełną edytowalność.
- **Change ID:** `settlement-lock`
- **PRD refs:** FR-015, FR-016
- **Prerequisites:** S-02
- **Parallel with:** — (previously S-04; changed to sequential — both touch GroupExpensesIsland.tsx and [id].astro)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Status zamknięcia musi być wymuszony po stronie serwera, nie tylko w UI — w przeciwnym razie uczestnik może obejść blokadę przez bezpośrednie wywołanie API. Mitygacja: każdy endpoint CRUD wydatków musi sprawdzać `group.status` przed wykonaniem operacji.
- **Status:** proposed

### S-04: Edycja i usuwanie wydatku

- **Outcome:** użytkownik może edytować i usunąć swój własny wydatek; saldo grupy aktualizuje się natychmiast po każdej zmianie (tak samo jak po dodaniu).
- **Change ID:** `expense-edit-delete`
- **PRD refs:** FR-011, FR-012
- **Prerequisites:** S-02
- **Parallel with:** — (previously S-03; changed to sequential — merge conflicts in shared files; S-03 ships first)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Usunięcie wydatku zmienia saldo wszystkich uczestników. Bez powiadomień (Non-Goals PRD) zmiana jest widoczna tylko w UI. Akceptowalne ograniczenie MVP — odnotowane w PRD FR-012.
- **Status:** proposed

### S-05: Profil użytkownika — zmiana nazwy wyświetlanej

- **Outcome:** zalogowany użytkownik może otworzyć stronę profilu, zobaczyć swój adres email (tylko do odczytu) i aktualną nazwę wyświetlaną (pre-wypełnioną w polu edycji), zmienić nazwę (niepusta, niezłożona wyłącznie z białych znaków) i otrzymać inline potwierdzenie po zapisaniu; zaktualizowana nazwa pojawia się jako jego identyfikator we wszystkich grupach przy następnym załadowaniu strony (lista wydatków, panel sald, lista członków).
- **Change ID:** `user-profile-display-name`
- **PRD refs:** US-02, FR-017, FR-018
- **Prerequisites:** F-01, F-02
- **Parallel with:** S-03, S-04
- **Blockers:** —
- **Unknowns:**
  - Jaki jest maksymalny limit znaków dla nazwy wyświetlanej? Sugerowany domyślny: 50 znaków. — Owner: użytkownik. Block: tak (reguła walidacji FR-018 nie jest kompletna bez tej liczby).
  - Gdzie dokładnie pojawia się wpis nawigacyjny do strony profilu (np. link na dashboardzie vs. globalny element UI dostępny z każdej strony)? — Owner: użytkownik. Block: nie (implementacja może ruszyć z rozsądnym domyślnym).
- **Risk:** Propagacja nazwy jest automatycznie retroaktywna — widoki grup ładują nazwy z tabeli `profiles` przy każdym żądaniu serwera, więc żadne backfill nie jest potrzebne. Brak real-time propagacji do otwartych zakładek innych uczestników jest celowy (PRD §Non-Goals); nowa nazwa widoczna dopiero przy następnym ładowaniu strony — akceptowalne ograniczenie MVP.
- **Status:** blocked

## Backlog Handoff


| Roadmap ID | Change ID            | Sugerowany tytuł zadania                                | Gotowe do `/10x-plan` | Uwagi                           |
| ---------- | -------------------- | ------------------------------------------------------- | --------------------- | ------------------------------- |
| F-01       | google-sso           | [F-01] Podłącz Google OAuth (zastąp signInWithPassword) | —                     | ✅ Done                          |
| F-02       | db-schema-rls        | [F-02] Schema DB + polityki RLS + Realtime              | —                     | ✅ Done                          |
| S-01       | group-join-flow      | [S-01] Tworzenie grupy, link zaproszenia, dołączenie    | —                     | ✅ Done — d548edc                |
| S-02       | expense-balance-live | [S-02] Dodawanie wydatku z podziałem + salda na żywo ⭐  | —                     | ✅ Done — 2f26ae0                |
| S-03       | settlement-lock      | [S-03] Zamknięcie i otwarcie rozliczenia                | tak                   | Must-have; przed S-04           |
| S-04       | expense-edit-delete         | [S-04] Edycja i usuwanie własnego wydatku                         | tak   | Nice-to-have; po S-03                                              |
| S-05       | user-profile-display-name   | [S-05] Strona profilu — zmiana nazwy wyświetlanej                 | nie   | Blocked — rozwiąż OQ-2 (limit znaków; Owner: użytkownik)          |


## Open Roadmap Questions

1. **Granularna kontrola dostępu do grupy** — jeden link zaproszenia obsługuje całą grupę; nie ma możliwości usunięcia konkretnego uczestnika bez usunięcia grupy. Owner: użytkownik. Block: nie (ograniczenie odnotowane w PRD FR-004; delegacja → v2). Dotyczy: roadmap-wide.
2. **Maksymalna długość nazwy wyświetlanej** — reguła walidacji FR-018 wymaga tej liczby przed implementacją; sugerowany domyślny: 50 znaków. Owner: użytkownik. Block: S-05 (tak — reguła walidacji niekompletna bez tej decyzji).
3. **Lokalizacja wpisu nawigacyjnego do strony profilu** — czy link do profilu pojawia się tylko na dashboardzie, czy jako globalny element UI dostępny z każdej strony? Owner: użytkownik. Block: nie (implementacja może ruszyć z rozsądnym domyślnym; wymagane potwierdzenie przed finalizacją UI). Dotyczy: S-05.

## Parked

- **Wielowalutowość** — Why parked: PRD §Non-Goals; wszystkie kwoty w PLN; przeliczanie walut przez użytkownika przed wprowadzeniem.
- **Powiadomienia email/push** — Why parked: PRD §Non-Goals; zmiany salda widoczne w UI, bez aktywnych notyfikacji.
- **Zaproszenia emailowe** — Why parked: PRD §Non-Goals; dołączanie wyłącznie przez link (→ v2).
- **Eksport PDF/CSV** — Why parked: PRD §Non-Goals; wyniki rozliczenia dostępne tylko w aplikacji.
- **Tryb offline** — Why parked: PRD §Non-Goals; aplikacja wymaga połączenia z internetem.
- **Delegowanie uprawnienia zamknięcia rozliczenia** — Why parked: PRD §Non-Goals; twórca grupy jest jedynym właścicielem tej operacji (→ v2).
- **FR-013: Import z XLS/CSV Revolut** — Why parked: PRD priority nice-to-have; ryzyko maintenance (format Revolut zmienia się); poza zakresem MVP.
- **FR-014: Import ze zrzutu ekranu Revolut** — Why parked: PRD priority nice-to-have; wymaga OCR/AI (dodatkowa zależność i koszt); poza zakresem MVP.
- **Observability** — Why parked: warstwa absent w baseline; PRD nie wymaga metryk/alertów dla MVP tej skali; dodaj gdy pojawi się konkretna potrzeba diagnostyczna.

## Done

(Puste przy pierwszej generacji. `/10x-archive` doda tu wpis gdy change o pasującym `Change ID` zostanie zarchiwizowany.)