export type Lang = "pl" | "en";

const MESSAGES = {
  pl: {
    callPrompt:
      "Dzień dobry {name}. Tu aplikacja StillAlive. Nie potwierdziłeś, że wszystko u Ciebie w porządku. " +
      "Jeśli wszystko jest dobrze, naciśnij jeden albo otwórz aplikację StillAlive.",
    callRepeat: "Powtarzam.",
    nudgeSms:
      "{prefix} Nie odpowiadasz na powiadomienia. Otwórz aplikację i naciśnij Jestem OK. Za {escalateIn} powiadomimy bliskich.",
    workSms:
      "{prefix} {name} ({phone}) nie odpowiada od {duration}. Prosimy o kontakt z rodziną: {family}.",
    workSmsNoFamily:
      "{prefix} {name} ({phone}) nie odpowiada od {duration}. Prosimy o kontakt z rodziną.",
    workVoice:
      "Dzień dobry. To automatyczny komunikat aplikacji StillAlive. {name} nie daje znaku życia od {duration}. " +
      "Szczegóły i kontakt do rodziny wysłaliśmy SMS-em.",
    familySms:
      "{prefix} {name} nie odpowiada od {duration}. Prosimy pilnie sprawdzić, czy wszystko w porządku. " +
      "Adres: {address}.",
    familySmsPolice: " Za {policeIn} poinformujemy Policję {police}.",
    familyVoice:
      "Dzień dobry. To automatyczny komunikat aplikacji StillAlive. {name} nie potwierdza, " +
      "że wszystko w porządku, od {duration}. Szczegóły wysłaliśmy SMS-em. " +
      "Prosimy o pilny kontakt z tą osobą lub sprawdzenie, czy jest bezpieczna.",
    policeVoice:
      "Dzień dobry. To automatyczny komunikat aplikacji StillAlive, która pomaga osobom mieszkającym samotnie. " +
      "Osoba o nazwisku {name}, adres: {address}, numer telefonu: {phoneSpoken}, " +
      "nie daje znaku życia od {duration}. Rodzina została powiadomiona. " +
      "Prosimy o sprawdzenie, czy ta osoba jest bezpieczna.",
    policeAllClearVoice:
      "Dzień dobry. To automatyczny komunikat aplikacji StillAlive. Osoba o nazwisku {name}, adres: {address}, " +
      "o której informowaliśmy wcześniej, właśnie potwierdziła, że wszystko w porządku. Dziękujemy.",
    allClearSms:
      "{prefix} {name} potwierdza, że wszystko w porządku. Dziękujemy!",
    contactAddedSms:
      "{prefix} {name} ({phone}) dodał(a) Cię jako kontakt alarmowy. Gdy przestanie odpowiadać, wyślemy Ci SMS.",
    unknownAddress: "nie podano",
    addressNotes: "Uwagi",
    never: "nigdy",
  },
  en: {
    callPrompt:
      "Hello {name}. This is the StillAlive app. You have not confirmed that you are okay. " +
      "If everything is fine, press one or open the StillAlive app.",
    callRepeat: "I repeat.",
    nudgeSms:
      "{prefix} You are not answering. Open the app and press I'm OK. We will notify your loved ones in {escalateIn}.",
    workSms:
      "{prefix} {name} has not answered for {duration} and may need help. Please contact their family: {family}.",
    workSmsNoFamily:
      "{prefix} {name} has not answered for {duration} and may need help. Please contact them: {phone}.",
    workVoice:
      "Hello. This is an automated message from the StillAlive app. {name} has not been in touch for {duration} " +
      "and may need help. We have sent you the details and their family's contact by text message.",
    familySms:
      "{prefix} {name} has not answered for {duration}.{police} Please check urgently that they are okay. " +
      "Address: {address}.",
    familySmsPolice: " We will inform the police in {policeIn}.",
    familyVoice:
      "Hello. This is an automated message from the StillAlive app. {name} has not confirmed " +
      "they are okay for {duration}. We have sent you the details by text message. " +
      "Please contact them or check on them as soon as possible.",
    policeVoice:
      "Hello. This is an automated message from StillAlive, an app that looks after people living alone. " +
      "{name}, address: {address}, phone number: {phoneSpoken}, " +
      "has shown no sign of life for {duration}. Their family has been notified. " +
      "Please check whether this person is safe.",
    policeAllClearVoice:
      "Hello. This is an automated message from StillAlive. {name}, address: {address}, " +
      "whom we reported earlier, has just confirmed they are okay. Thank you.",
    allClearSms:
      "{prefix} {name} confirms they are okay. Thank you!",
    contactAddedSms:
      "{prefix} {name} ({phone}) added you as an emergency contact. If they stop answering, we will text you.",
    unknownAddress: "not provided",
    addressNotes: "Notes",
    never: "never",
  },
} satisfies Record<Lang, Record<string, string>>;

export type MessageKey = keyof typeof MESSAGES.pl;

/** Starts every SMS so recipients recognise who is writing. */
const SMS_PREFIX = "App StillAlive:";

export function t(lang: Lang, key: MessageKey, params: Record<string, string | number> = {}): string {
  const all: Record<string, string | number> = { prefix: SMS_PREFIX, ...params };
  return MESSAGES[lang][key]
    .replace(/\{(\w+)\}/g, (_, name: string) => String(all[name] ?? ""))
    // "od 36 godz." or notes ending with a period followed by the sentence's own period.
    .replace(/\.\./g, ".");
}

export function asLang(value: unknown): Lang {
  return value === "en" ? "en" : "pl";
}

/** "10 min", "1 godz. 30 min", "36 godz.", "3 dni": minutes below an hour, hours below two days. */
export function formatDuration(lang: Lang, millis: number): string {
  const totalMinutes = Math.max(1, Math.round(millis / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const min = `${minutes} min`;
  if (hours === 0) return min;
  if (hours < 48) {
    const h = lang === "pl" ? `${hours} godz.` : `${hours} ${hours === 1 ? "hour" : "hours"}`;
    return minutes === 0 ? h : `${h} ${min}`;
  }
  const days = Math.floor(hours / 24);
  return lang === "pl" ? `${days} dni` : `${days} days`;
}

/** Polish numbers without "+48" save SMS characters; foreign numbers keep their prefix. */
export function displayPhone(e164: string): string {
  return /^\+48\d{9}$/.test(e164) ? e164.slice(3) : e164;
}
