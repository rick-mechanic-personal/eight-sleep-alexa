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
  request:
    | LaunchRequest
    | IntentRequest
    | SessionEndedRequest;
}

interface LaunchRequest {
  type: 'LaunchRequest';
  requestId: string;
  timestamp: string;
}

interface IntentRequest {
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

export function getSlot(req: AlexaRequest, slotName: string): string | undefined {
  if (req.request.type !== 'IntentRequest') return undefined;
  return req.request.intent.slots?.[slotName]?.value;
}

// Convert Alexa AMAZON.TIME value ("07:30", "07:30:00", "MO07:30") to "HH:MM"
export function parseAlexaTime(value: string): string | null {
  // Strip day prefix if present (e.g. "MO07:30")
  const cleaned = value.replace(/^[A-Z]{2}/, '');
  const parts = cleaned.split(':');
  if (parts.length >= 2) {
    const h = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    return `${h}:${m}`;
  }
  return null;
}

// Convert Alexa AMAZON.DURATION "PT9M" -> minutes number
export function parseDuration(value: string): number {
  const match = value.match(/PT(\d+)M/i);
  if (match) return parseInt(match[1], 10);
  const hoursMatch = value.match(/PT(\d+)H/i);
  if (hoursMatch) return parseInt(hoursMatch[1], 10) * 60;
  return 9; // default snooze
}

// Convert Alexa AMAZON.DayOfWeek to Eight Sleep 3-letter codes
const DAY_MAP: Record<string, string> = {
  monday: 'MON',
  tuesday: 'TUE',
  wednesday: 'WED',
  thursday: 'THU',
  friday: 'FRI',
  saturday: 'SAT',
  sunday: 'SUN',
};

export function parseDay(value: string): string | null {
  return DAY_MAP[value.toLowerCase()] ?? null;
}
