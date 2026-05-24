---
project: "TripSplit"
version: 3
status: draft
created: 2026-05-24
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Manualne rozliczanie wydatków po wyjeździe wakacyjnym ze znajomymi jest czasochłonne i podatne na błędy. Uczestnicy wymieniają paragony i kwoty przez WhatsApp, zbierają dane w Excelu, a potem ręcznie liczą kto komu ile jest winien — szczególnie gdy ktoś był krócej lub nie uczestniczył w konkretnych wydatkach.

Istniejące narzędzia (Splitwise i podobne) są zbyt złożone dla okazjonalnych użytkowników — wymagają założenia kont przez wszystkich uczestników i oferują więcej funkcji niż potrzeba. Projekt ma też wymiar edukacyjny — celem jest nauka budowania aplikacji na rzeczywistym problemie.

## User & Persona

**Persona główna: uczestnik wyjazdu wakacyjnego**

Rola: dowolny uczestnik grupowego wyjazdu (3–10 osób), który płaci za wspólne wydatki (zakupy, jedzenie, atrakcje turystyczne, przejazdy) lub jest beneficjentem takich płatności.

Moment: podczas wyjazdu (gdy ktoś płaci za grupę) i po powrocie (gdy trzeba się rozliczyć).

Kontekst: każda osoba w grupie może płacić za wydatki grupy. Podział jest zazwyczaj równy, ale czasem ktoś był krócej i to trzeba uwzględnić. Dziś: Excel + WhatsApp.

## Success Criteria

### Primary
- Kompletny przepływ działa end-to-end: użytkownik tworzy konto → tworzy grupę → udostępnia link → inni dołączają → każdy dodaje wydatki z elastycznym podziałem → każdy widzi rozliczenie (kto komu ile winien).

### Secondary
- Możliwość edycji i usunięcia własnego wydatku po dodaniu.

### Guardrails
- Obliczenia rozliczenia są matematycznie poprawne — błąd w kwocie niszczy zaufanie do aplikacji.
- Uczestnik widzi i modyfikuje tylko grupy, do których należy.
- Wydatki są trwale zapisane — każdy uczestnik widzi je po powrocie do aplikacji i z każdego urządzenia.

## User Stories

### US-01: Uczestnik dodaje wydatek grupowy

- **Given** zalogowany użytkownik należący do grupy wyjazdowej
- **When** dodaje wydatek z kwotą, opisem i wybranymi uczestnikami
- **Then** wydatek pojawia się na liście grupy, a rozliczenie (kto komu ile winien) aktualizuje się automatycznie

#### Acceptance Criteria
- Domyślny podział jest równy dla wszystkich wybranych uczestników
- Użytkownik może zmienić podział na własny (procentowy lub kwotowy)
- Wydatek jest widoczny dla wszystkich członków grupy natychmiast po zapisaniu

## Functional Requirements

### Rejestracja i logowanie
- FR-001: Użytkownik może założyć konto przez Google SSO (jedyna metoda uwierzytelnienia). Priority: must-have
  > Socrates: Kontrargument rozważony: "Google SSO wyklucza osoby bez konta Google." Rozwiązanie: zaakceptowany trade-off — upraszcza MVP, eliminuje zarządzanie hasłami i reset hasła.
- FR-002: Użytkownik może zalogować się przez Google SSO. Priority: must-have
  > Socrates: Kontrargument rozważony: "Wygasanie sesji wymaga obsługi refresh token." Rozwiązanie: standardowy pattern OAuth — brak kontrargumentu, stoi jak jest.

### Grupy
- FR-003: Użytkownik może stworzyć grupę wyjazdową. Priority: must-have
  > Socrates: Kontrargument rozważony: "Jeden użytkownik w wielu grupach komplikuje UI." Rozwiązanie: brak kontrargumentu — wiele grup to naturalne użycie (kolejne wyjazdy).
- FR-004: Użytkownik może wygenerować link zaproszenia do grupy. Priority: must-have
  > Socrates: Kontrargument przyjęty: "Jeden link na grupę — nie można cofnąć dostępu konkretnej osobie bez usunięcia grupy." Odnotowane jako ograniczenie MVP — granularna kontrola dostępu do v2.
- FR-005: Użytkownik może dołączyć do grupy przez link zaproszenia. Priority: must-have
  > Socrates: Kontrargument rozważony: "Brak limitu uczestników / dwuetapowość (link + Google SSO)." Rozwiązanie: brak kontrargumentu — dołączanie przez link konieczne przy braku zaproszeń emailowych.

### Wydatki
- FR-006: Użytkownik może dodać wydatek (opis, kwota; data opcjonalna — domyślnie dziś). Priority: must-have
  > Socrates: Kontrargument przyjęty: "Data opcjonalna (domyślnie dziś) upraszcza formularz." FR zaktualizowany — pole daty jest opcjonalne.
- FR-007: Użytkownik może określić których uczestników dotyczy dany wydatek. Priority: must-have
  > Socrates: Kontrargument rozważony: "Jeśli domyślnie dotyczy wszystkich, czy podzbiór jest potrzebny?" Rozwiązanie: brak kontrargumentu — podzbiór uczestników kluczowy dla scenariusza "ktoś był krócej".
- FR-008: Użytkownik może ustawić podział równy (domyślnie) lub własny procentowy/kwotowy. Priority: must-have
  > Socrates: Kontrargument rozważony: "Własny podział to złożony UI — może tylko równy + wykluczenie osoby?" Rozwiązanie: brak kontrargumentu — elastyczny podział niezbędny dla różnych udziałów.

### Rozliczenie
- FR-009: Użytkownik może zobaczyć paginowaną listę wydatków grupy, filtrowaną po osobie, sortowaną domyślnie po dacie. Priority: must-have
  > Socrates: Kontrargument przyjęty: "Bez sortowania/filtrowania długa lista staje się bezużyteczna." FR rozszerzony — paginacja + filtrowanie po osobie + sortowanie po dacie.
- FR-010: Użytkownik może zobaczyć salda rozliczenia — ile każdy uczestnik ma do oddania lub do otrzymania (netto). Priority: must-have
  > Socrates: Kontrargument przyjęty: "Salda (kto ma +/-) wystarczą na MVP — minimalizacja transferów to wyższa złożoność algorytmu." FR zaktualizowany — widok sald, nie optymalizacja transferów.

### Zarządzanie wydatkami
- FR-011: Użytkownik może edytować swój wydatek po dodaniu. Priority: nice-to-have
  > Socrates: Kontrargument rozważony: "Edycja cudzego wydatku może prowadzić do sporów." Rozwiązanie: brak kontrargumentu — edycja ograniczona do własnych wydatków.
- FR-012: Użytkownik może usunąć swój wydatek. Priority: nice-to-have
  > Socrates: Kontrargument przyjęty: "Usunięcie zmienia saldo wszystkich — inni powinni wiedzieć." Ograniczenie MVP: brak systemu powiadomień oznacza że zmiana salda jest widoczna w rozliczeniu, ale bez aktywnej notyfikacji. Powiadomienia → v2.

### Import wydatków
- FR-013: Użytkownik może zaimportować wydatki z pliku XLS/CSV eksportowanego z Revolut. Priority: nice-to-have
  > Socrates: Kontrargument rozważony: "format XLS Revolut zmienia się bez ostrzeżenia; import z XLS to edge case dla grup 3–10 osób." Rozwiązanie: brak kontrargumentu — FR stoi jako nice-to-have; maintenance ryzyka akceptowalne przy niskim priorytecie implementacyjnym.
- FR-014: Użytkownik może zaimportować wydatki ze zrzutu ekranu historii transakcji z Revolut. Priority: nice-to-have
  > Socrates: Kontrargument rozważony: "parsing wymaga OCR/AI (dodatkowa zależność i koszt); różne wersje Revolut mają różny układ — edge case'ów za dużo." Rozwiązanie: brak kontrargumentu — FR stoi jako nice-to-have; decyzja o integracji OCR/AI do podjęcia na etapie implementacji.

### Zamknięcie rozliczenia
- FR-015: Twórca grupy może zamknąć rozliczenie — od tego momentu żaden uczestnik (w tym twórca) nie może dodawać, edytować ani usuwać wydatków. Priority: must-have
  > Socrates: Kontrargument przyjęty: "Status zamknięcia musi być widoczny dla wszystkich uczestników — bez jasnego sygnału UI uczestnicy nie wiedzą, dlaczego nie mogą edytować wydatku." Kryterium akceptacji: zamknięty status jest wyraźnie widoczny dla wszystkich członków grupy.
- FR-016: Twórca grupy może otworzyć zamknięte rozliczenie, przywracając pełną edytowalność wydatków. Priority: must-have
  > Socrates: Kontrargument rozważony: "Delegowanie uprawnienia zamknięcia innym uczestnikom przydatne gdy twórca jest niedostępny." Rozwiązanie: brak kontrargumentu dla MVP — delegacja uprawnień → v2; twórca grupy jest jedynym właścicielem tej operacji.

## Non-Functional Requirements

- Dane grupy — wydatki i salda — są dostępne wyłącznie dla zalogowanych członków tej grupy; uczestnik spoza grupy nie widzi żadnych danych finansowych innej grupy.
- Aplikacja jest użyteczna w przeglądarce mobilnej (smartfon) — uczestnicy wprowadzają wydatki w terenie podczas wyjazdu.
- Aplikacja pozostaje dostępna przez cały czas trwania wyjazdu; niedostępność serwisu podczas wyjazdu uniemożliwia wprowadzanie wydatków na bieżąco.

## Business Logic

Aplikacja oblicza dla każdego uczestnika saldo wydatków grupowych z uwzględnieniem nierównego podziału (np. czas pobytu, udział w konkretnych atrakcjach).

**Wejście reguły**: dla każdego wydatku — kwota i kto zapłacił; lista uczestników tego wydatku i ich udziały (równe domyślnie, lub własne wagi procentowe/kwotowe); przynależność użytkowników do grupy.

**Wyjście reguły**: saldo netto na osobę — kwota do otrzymania (+) lub do oddania (−) względem sumy wszystkich wydatków grupy. Widok sald, nie lista sugerowanych transferów (minimalizacja transferów poza scope MVP).

**Moment spotkania z wynikiem**: na żywo — saldo każdego uczestnika aktualizuje się natychmiast po dodaniu, edycji lub usunięciu wydatku, bez odświeżania strony ani akcji użytkownika.

## Access Control

Logowanie: wyłącznie Google SSO. Każdy uczestnik ma konto Google.

Model uprawnień: w większości płaski — wszyscy uczestnicy mogą dodawać wydatki i przeglądać rozliczenie. Twórca grupy ma jedno dodatkowe uprawnienie: zamknięcie i otwarcie rozliczenia (FR-015, FR-016).

Uczestnik spoza grupy nie ma dostępu do żadnych danych tej grupy.

## Non-Goals

- Brak obsługi wielu walut — wszystkie kwoty w PLN; wydatki w EUR/USD użytkownik przelicza samodzielnie przed wprowadzeniem.
- Brak powiadomień email/push — zmiany salda są widoczne w aplikacji, ale aplikacja nie informuje aktywnie uczestników.
- Brak zaproszeń emailowych — dołączanie do grupy wyłącznie przez link (zaproszenia emailowe → v2).
- Brak eksportu do PDF/CSV — wyniki rozliczenia dostępne tylko w aplikacji.
- Brak trybu offline — aplikacja wymaga połączenia z internetem.
- Brak delegowania uprawnienia zamknięcia rozliczenia do innych uczestników — twórca grupy jest jedynym właścicielem tej operacji; delegacja → v2.

## Open Questions

1. **Granularna kontrola dostępu do grupy** — jeden link zaproszenia obsługuje całą grupę; nie ma możliwości usunięcia konkretnego uczestnika bez usunięcia grupy. Decyzja: odkładane do v2. Właściciel: użytkownik. Blokuje: nie (ograniczenie odnotowane w Socrates FR-004).
