# StillAlive

Aplikacja pożytku publicznego (Android) sprawdzająca, czy osoba mieszkająca samotnie jest bezpieczna.
Rozmowa z właścicielem projektu po polsku; kod, komentarze i nazwy po angielsku. Teksty UI: `values/` (EN)
i `values-pl/` (PL) — każdą zmianę tekstu wprowadzaj w obu.

## Architektura

- `android/` — Kotlin, Jetpack Compose, Material 3, minSdk 26, pakiet `app.stillalive`.
- `functions/` — Firebase Cloud Functions (TypeScript, Node 22), region `europe-central2`.
- Firebase: projekt `still-alive-3d962`, Auth (logowanie numerem telefonu), FCM, Firestore
  w **nazwanej bazie `stillalive`** (europe-central2). Baza `(default)` w USA nie jest używana.
  `DATABASE_ID` w `functions/src/telephony.ts` i `AppRepository.kt` muszą być zgodne.
- SMS / połączenia głosowe: **SMSAPI.pl** (`functions/src/telephony.ts`). Twilio zostało porzucone
  (wymagało dowodu osobistego w KYC — nie proponuj dostawców wymagających skanu dokumentu bez uprzedzenia).
- Klient tylko czyta własny dokument (`firestore.rules`); wszystkie zapisy idą przez callable functions.

## Przebieg (specyfikacja właściciela — nie zmieniaj bez pytania)

```
T (codzienne pytanie, np. 21:00)        push
T+R, T+2R, T+3R                          3 przypomnienia co R (30 min–4 godz.), w ciszy nocnej pomijane
3. przypomnienie + E                     SMS do osoby („za E powiadomimy bliskich”)
SMS + E                                  SMS do rodziny (max 2) i kontaktu z pracy (max 1, dostaje numery rodziny)
alarm .. +3 godz.                        push co 30 min, niezależnie od ustawień i ciszy nocnej
potem                                    cisza aż do „Jestem OK”; wtedy SMS „wszystko w porządku” do powiadomionych
```

- E = `escalateAfterMinutes` (5 min–48 godz., co 5 min). Przed alarmem cisza nocna nie wlicza się do E.
- Policja: etap istnieje w backendzie (`notifyPolice`), ale w aplikacji jest ukryta „na razie”.
- Połączenia VMS (SMSAPI) są dodatkiem: konto nie ma jeszcze uprawnienia VMS (błąd 110), SMS zawsze idzie pierwszy.
- SMS-y zaczynają się od „App StillAlive:” i są bez polskich znaków (`normalize`). Wszystkie mieszczą się w 160 znakach
  oprócz SMS-a do rodziny, który celowo zawiera pełny adres z uwagami (2–3 części).

Logika jest czysta i testowana w `functions/src/schedule.ts` (`decide()`); efekty uboczne w `functions/src/index.ts`.

## Komendy

Na tej maszynie systemowa Java to 25 (Gradle 8.11 jej nie obsługuje) i nie ma globalnego Node:

```bash
# Android (JDK 21 w ~/.jdks, SDK w ~/Android/Sdk wskazany w android/local.properties)
cd android && JAVA_HOME=~/.jdks/jdk-21 ./gradlew assembleDebug testDebugUnitTest lintDebug
~/Android/Sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk

# Functions (Node tymczasowo w /tmp/stillalive-node; po restarcie trzeba pobrać ponownie)
cd functions && npm test

# Wdrożenie robi właściciel: firebase deploy --only functions[,firestore]
```

Po zmianach w backendzie zawsze uruchom `npm test`, po zmianach w aplikacji build + lint.
Nie buduj aplikacji, gdy właściciel zapowiada kolejne zmiany. Nie wdrażaj i nie commituj bez prośby.

## Przełączniki do zmiany przed publikacją

- `ALLOW_DUPLICATE_CONTACT_PHONES = true` — w `functions/src/validation.ts` i `Models.kt` (ułatwia testy jednym numerem).
- `NOTIFY_NEW_CONTACTS = false` w `functions/src/index.ts` — SMS „dodano Cię jako kontakt” wyłączony na prośbę właściciela;
  przed publikacją rozważyć ponowne włączenie (zgoda kontaktów, RODO).
- `ENFORCE_APP_CHECK = false` w `functions/src/index.ts` — włączyć po rejestracji aplikacji w App Check
  (Play Integrity + token debug w konsoli Firebase).
- Publikacja w Google Play: targetSdk 36 (wymaga aktualizacji AGP/bibliotek), podpis release, polityka prywatności,
  formularz Data safety, strona usuwania konta.

## Pułapki środowiska (Google Cloud)

- Organizacja bizonek.net ma *Domain Restricted Sharing*: projekt ma wyjątek, ale funkcje typu callable/HTTP
  potrzebują `allUsers` → `roles/run.invoker` nadanego ręcznie (deploy go nie dodaje).
- Konto `1635881419-compute@developer.gserviceaccount.com` ma tylko wąskie role: cloudbuild.builds.builder,
  datastore.user, firebasecloudmessaging.admin, firebaseauth.admin. Nowa usługa = nowa rola do nadania.
- Sesje `gcloud`/`firebase` często wygasają (session control w Workspace) — poproś o `! gcloud auth login`.
- Nadawanie ról IAM i zmiany polityk wykonuje właściciel (komendy podaj do uruchomienia z `!`).

## Testowanie na telefonie

Pixel 6 przez adb. Testy alarmu: ustaw pola w `users/{uid}` w bazie `stillalive` przez Firestore REST
(`pendingSince`, `lastReminderAt`, `remindersSent`, `nudgedAt`, `nextActionAt`) — tylko na koncie właściciela
i po jego zgodzie, bo wysyłane są prawdziwe SMS-y. Logi: `gcloud logging read` dla usług `tick`, `saveprofile` itd.

## Poufne dane

Nie commituj: `android/app/google-services.json`, `android/local.properties`, `functions/.env*`, keystore,
tokenów App Check debug, tokena SMSAPI (jest tylko w Secret Manager jako `SMSAPI_TOKEN`).
