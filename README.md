# StillAlive

Aplikacja pożytku publicznego dla osób mieszkających samotnie. Codziennie pyta użytkownika, czy wszystko
w porządku. Jeśli nie odpowie — przypomina, dzwoni, a w końcu powiadamia bliskich, prace (o ile ustawione) i policję (w przyszlosci).

## Jak to działa

Użytkownik ustawia:

- **godzinę codziennego pytania** (np. 21:00);
- **co ile przypominać**, gdy nie odpowie: 30 min, 1, 2, 3 lub 4 godz.;
- **odstęp E** między kolejnymi SMS-ami (do siebie, do rodziny, do pracy): w godzinach i minutach, od 5 min do 48 godz., co 5 min;
- **ciszę nocną**: bez przypomnień, a ten czas nie wlicza się do odstępów. Po alarmie nie obowiązuje.

```
21:00              codzienne pytanie (push)
23:00, 1:00, 3:00  3 przypomnienia co R (tu 2 godz.); w ciszy nocnej pomijane, wznawiane po jej końcu
3:15               SMS do osoby: „Za 15 min powiadomimy bliskich” (3. przypomnienie + E)
3:30               SMS do rodziny z adresem i uwagami (SMS do osoby + E)
3:45               SMS do kontaktu z pracy, z imionami i numerami rodziny (SMS do rodziny + E)
3:30–6:30          push co 30 min przez 3 godz. (także w nocy), potem cisza aż do potwierdzenia
potwierdzenie      SMS „wszystko w porządku” do wszystkich powiadomionych
```

Kontakty: do 2 rodzinnych i 1 z pracy. Każdy nowy numer dostaje SMS informacyjny, więc dziennie
można dodać najwyżej 4 nowe numery (limit liczony per numer użytkownika).
Wszystkie SMS-y zaczynają się od „App StillAlive:”.

Powiadamianie policji jest w backendzie (osobny etap po rodzinie), ale na razie aplikacja nie pozwala
dodać komisariatu.

Potwierdzić można: przyciskiem w aplikacji, przyciskiem w powiadomieniu (bez otwierania aplikacji)
albo klawiszem 1 podczas połączenia telefonicznego (gdy działa VMS).

## Architektura

```
android/      Aplikacja (Kotlin, Jetpack Compose, Material 3), minSdk 26
functions/    Backend: Firebase Cloud Functions (TypeScript, Node 22), region europe-central2 (Warszawa)
firestore.rules
```

| Element | Technologia |
|---|---|
| Logowanie | Firebase Auth — numer telefonu + kod SMS (mamy zweryfikowany numer, na który dzwonimy) |
| Dane | Firestore: `users/{uid}`, historia w `users/{uid}/events` |
| Harmonogram | Cloud Scheduler → funkcja `tick` co 5 minut |
| Push | Firebase Cloud Messaging (wiadomości data-only, wysoki priorytet) |
| Połączenia i SMS | [SMSAPI.pl](https://www.smsapi.pl/) (SMS + wiadomości głosowe VMS z lektorem) |

Kluczowe pliki:

- `functions/src/schedule.ts` — maszyna stanów (czysta logika, bez Firebase, pokryta testami).
- `functions/src/index.ts` — funkcje: `tick`, `confirm`, `saveProfile`, `registerFcmToken`,
  `deleteAccount`, `smsapiCallback` (raporty połączeń, w tym wciśnięty klawisz).
- `android/.../push/` — powiadomienie z przyciskiem i potwierdzanie w tle przez WorkManager.

Klient **nie zapisuje** nic bezpośrednio do Firestore — reguły pozwalają tylko czytać własny dokument,
a wszystkie zapisy idą przez Cloud Functions z walidacją.

Każdy użytkownik ma pole `nextActionAt`; `tick` pobiera tylko dokumenty, których czas minął,
i „zajmuje” je w transakcji, więc nakładające się wywołania nie wykonają akcji dwa razy.

## Uruchomienie

### 1. Projekt Firebase

1. Utwórz projekt w [konsoli Firebase](https://console.firebase.google.com/) i przełącz go na plan
   **Blaze** (wymagany dla Cloud Functions, Scheduler i wychodzących połączeń do SMSAPI).
2. **Authentication → Sign-in method → Phone** — włącz.
3. **Firestore** — utwórz bazę w regionie `europe-central2`.
4. **Project settings → Add app → Android**, pakiet `app.stillalive`. Dodaj odciski **SHA-1 i SHA-256**
   swojego klucza (debug: `cd android && ./gradlew signingReport`) — bez nich logowanie SMS nie działa.
   Pobierz `google-services.json` do `android/app/`.
5. Wpisz ID projektu w `.firebaserc`.

### 2. SMSAPI

1. Załóż konto na [smsapi.pl](https://www.smsapi.pl/) i doładuj punkty.
2. **Ustawienia API → Tokeny API (OAuth)** — utwórz token z uprawnieniami **SMS** i **VMS**.
3. Opcjonalnie zarejestruj nazwę nadawcy (np. `StillAlive`) w zakładce *Pola nadawcy*.
   Bez niej SMS-y wychodzą z domyślnego nadawcy konta.

### 3. Wdrożenie backendu

```bash
npm install -g firebase-tools
firebase login
cd functions && npm install && npm test && cd ..

firebase functions:secrets:set SMSAPI_TOKEN
firebase deploy --only functions,firestore   # zapyta o SMSAPI_SENDER i SMSAPI_TEST_MODE
```

### 4. Aplikacja

Otwórz katalog `android/` w Android Studio i uruchom, albo z linii poleceń. Do tego potrzebujesz
**JDK 17 lub 21** (Gradle 8.11 nie działa na Javie 25) i Android SDK wskazanego w `android/local.properties`
(`sdk.dir=...`, plik nie trafia do gita):

```bash
cd android && ./gradlew assembleDebug
```

Do testów bez wysyłania SMS dodaj w konsoli Firebase testowy numer telefonu
(Authentication → Sign-in method → Phone → *Phone numbers for testing*).

### Testy i lokalny emulator

```bash
cd functions && npm test           # testy maszyny stanów
npm run serve                      # emulatory Auth/Firestore/Functions
```

## Ważne uwagi

- **Policja.** Nie istnieje API do zgłoszeń na 112, a automatyczne połączenia na numery alarmowe są
  niedozwolone. Kontakt typu „Komisariat” to zwykły numer (np. dyżurny lokalnej jednostki), który
  dostaje komunikat głosowy z imieniem, adresem i numerem użytkownika. Zanim uruchomisz to publicznie,
  warto porozmawiać z policją o oczekiwanej formie takich zgłoszeń.
- **RODO.** Przetwarzamy numer telefonu, adres i dane kontaktów bliskich. Potrzebna jest polityka
  prywatności, zgoda użytkownika i poinformowanie kontaktów — backend wysyła każdemu nowemu kontaktowi
  SMS z informacją, że został dodany. Usunięcie konta (`deleteAccount`) kasuje wszystkie dane.
- **Koszty.** Firebase przy małej skali mieści się prawie w darmowym limicie; główny koszt to SMSAPI
  (połączenia i SMS) i SMS-y logowania Firebase Auth.
- **Niezawodność.** Aplikacja nie polega na alarmach w telefonie — cały harmonogram jest po stronie
  serwera, więc działa nawet przy wyłączonym lub rozładowanym telefonie (wtedy właśnie eskaluje).

## Pomysły na kolejne wersje

- Wykrywanie aktywności telefonu (odblokowanie, ruch) jako automatyczne potwierdzenie.
- Tryb urlopowy / wstrzymanie na określony czas.
- Aplikacja dla rodziny z podglądem statusu.
- iOS.
