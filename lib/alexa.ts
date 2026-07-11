// Alexa request/response types and helpers

export interface AlexaRequest {
  version: string;
  session?: {
    application: { applicationId: string };
    user: { userId: string };
    new: boolean;
  };
  context: {
    System: {
      application: { applicationId: string };
    };
  };
  request: LaunchRequest | IntentRequest | SessionEndedRequest;
}

interface LaunchRequest {
  type: 'LaunchRequest';
  requestId: string;
  timestamp: string;
}

export interface IntentRequest {
  type: 'IntentRequest';
  requestId: string;
  timestamp: string;
  intent: {
    name: string;
    slots?: Record<string, { name: string; value?: string }>;
  };
}

interface SessionEndedRequest {
  type: 'SessionEndedRequest';
  requestId: string;
  timestamp: string;
}

export type AlexaResponse = {
  version: '1.0';
  response: {
    outputSpeech: { type: 'PlainText'; text: string };
    reprompt?: { outputSpeech: { type: 'PlainText'; text: string } };
    shouldEndSession: boolean;
  };
};

export function speak(text: string, endSession = true): AlexaResponse {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      shouldEndSession: endSession,
    },
  };
}

export function ask(text: string, reprompt: string): AlexaResponse {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      reprompt: { outputSpeech: { type: 'PlainText', text: reprompt } },
      shouldEndSession: false,
    },
  };
}

export function getSlot(req: AlexaRequest, name: string): string | undefined {
  if (req.request.type !== 'IntentRequest') return undefined;
  return (req.request as IntentRequest).intent.slots?.[name]?.value;
}

/** Alexa AMAZON.TIME ("07:30", "07:30:00", "MO07:30") → "HH:MM:SS" */
export function parseAlexaTime(value: string): string | null {
  const cleaned = value.replace(/^[A-Z]{2}/, '');
  const parts = cleaned.split(':');
  if (parts.length < 2) return null;
  const h = parts[0].padStart(2, '0');
  const m = parts[1].padStart(2, '0');
  return `${h}:${m}:00`;
}

/** Alexa AMAZON.DURATION "PT9M" or "PT1H" → minutes */
export function parseDuration(value: string): number {
  const mMatch = value.match(/PT(\d+)M/i);
  if (mMatch) return parseInt(mMatch[1], 10);
  const hMatch = value.match(/PT(\d+)H/i);
  if (hMatch) return parseInt(hMatch[1], 10) * 60;
  return 9;
}

/** Alexa AMAZON.DayOfWeek → full lowercase day name */
const DAY_MAP: Record<string, keyof import('./eight-sleep').AlarmRepeat['weekDays']> = {
  monday: 'monday',
  tuesday: 'tuesday',
  wednesday: 'wednesday',
  thursday: 'thursday',
  friday: 'friday',
  saturday: 'saturday',
  sunday: 'sunday',
  // aliases Alexa sometimes returns
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
};

export function parseDay(value: string): keyof import('./eight-sleep').AlarmRepeat['weekDays'] | null {
  return DAY_MAP[value.toLowerCase()] ?? null;
}

/** "gradual" / "gentle" / "rise" → RISE,  "heavy" / "strong" / "intense" → INTENSE */
export function parseVibrationPattern(value: string): 'RISE' | 'INTENSE' {
  const v = value.toLowerCase();
  if (
    v.includes('heavy') ||
    v.includes('strong') ||
    v.includes('intense') ||
    v.includes('hard') ||
    v.includes('double')
  ) {
    return 'INTENSE';
  }
  return 'RISE';
}

/** Vibration strength "low" / "medium" / "high" → Eight Sleep powerLevel 20 / 50 / 100 */
export function parseStrength(value: string): 20 | 50 | 100 {
  const v = value.toLowerCase();
  if (v.includes('low') || v.includes('weak') || v.includes('min')) return 20;
  if (v.includes('high') || v.includes('max') || v.includes('full')) return 100;
  return 50;
}

/**
 * Spoken temperature → Eight Sleep thermal level.
 * The app's -10…+10 temperature scale maps to the API's -100…+100.
 * Direction words ("cooling", "minus", …) set the sign; no direction = warming.
 */
export function parseTempLevel(
  direction: string | undefined,
  level: string,
): number | null {
  const n = Number(level);
  if (!Number.isFinite(n)) return null;
  const d = direction?.toLowerCase() ?? '';
  const sign = d.includes('cool') || d.includes('cold') || d.includes('chill') ||
    d.includes('minus') || d.includes('negative')
    ? -1
    : 1;
  const clamped = Math.max(0, Math.min(10, Math.round(Math.abs(n))));
  return sign * clamped * 10;
}

/** API thermal level → speech, e.g. -30 → "cooling level 3" */
export function formatTempLevel(level: number): string {
  if (level === 0) return 'temperature level zero';
  const dir = level > 0 ? 'warming' : 'cooling';
  return `${dir} level ${Math.abs(level) / 10}`;
}
