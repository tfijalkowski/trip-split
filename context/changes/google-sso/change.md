---
change_id: google-sso
title: Podłącz Google OAuth (zastąp signInWithPassword)
status: implementing
created: 2026-05-28
updated: 2026-06-01
archived_at: null
---

## Notes

Roadmap F-01. Zastąp obecny `signInWithPassword` logowaniem przez Google OAuth (Supabase provider). Wymaga dodania trasy `/auth/callback`, ustawienia zmiennych `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` i konfiguracji Supabase. Wdróż atomicznie — nie zostawiaj obu metod aktywnych jednocześnie. Unlocks S-01 → S-02 → S-03.
