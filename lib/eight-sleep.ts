// Eight Sleep unofficial API client
// Endpoints verified live on 2026-07-11; auth flow matches the maintained
// Home Assistant integration (github.com/lukas-clarke/eight_sleep).

const AUTH_URL = 'https://auth-api.8slp.net/v1/tokens';
const APP_API_URL = 'https://app-api.8slp.net';
const CLIENT_API_URL = 'https://client-api.8slp.net';

// Client credentials embedded in the Eight Sleep mobile app (community-known).
const DEFAULT_CLIENT_ID = '0894c7f33bb94800a03f1f4df13a4f38';
const DEFAULT_CLIENT_SECRET =
  'f0954a3ed5763ba3d06834c73731a32f15f168f47d4f164751275def86db0c76';

const USER_AGENT = 'okhttp/4.9.3';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VibrationPattern = 'RISE' | 'INTENSE'; // RISE = gentle, INTENSE = strong
export type VibrationPower = 20 | 50 | 100; // low / medium / high

export interface AlarmVibration {
  enabled: boolean;
  powerLevel: number;
  pattern: VibrationPattern;
}

export interface AlarmThermal {
  enabled: boolean;
  /** Temperature offset -100 to 100. Negative = cool, positive = warm. 0 = no change. */
  level: number;
}

export interface AlarmAudio {
  enabled: boolean;
  level: number;
}

export interface AlarmSmart {
  /** Wake during detected light sleep stage (up to 30 min early). */
  lightSleepEnabled: boolean;
  /** Limit how early smart wake can trigger. */
  sleepCapEnabled: boolean;
  sleepCapMinutes?: number;
}

export interface AlarmRepeat {
  enabled: boolean;
  weekDays: {
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
    saturday: boolean;
    sunday: boolean;
  };
}

export interface Alarm {
  id: string;
  enabled: boolean;
  /** "HH:MM:SS" in the user's local timezone. */
  time: string;
  repeat: AlarmRepeat;
  vibration: AlarmVibration;
  thermal: AlarmThermal;
  audio: AlarmAudio;
  smart: AlarmSmart;
  skipNext: boolean;
  dismissedUntil: string; // ISO instant; epoch 0 = never
  skippedUntil: string;
  snoozedUntil: string;
  snoozing: boolean;
}

export interface CreateAlarmOptions {
  time: string; // "HH:MM:SS"
  days?: Partial<AlarmRepeat['weekDays']>; // omitted = one-off (repeat disabled)
  vibration?: {
    pattern?: VibrationPattern;
    powerLevel?: VibrationPower;
  };
  thermal?: {
    enabled?: boolean;
    level?: number;
  };
  smartWake?: boolean;
}

export class EightSleepApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    body: string,
  ) {
    super(`Eight Sleep API ${status} on ${path}: ${body}`);
    this.name = 'EightSleepApiError';
  }
}

// ─── Token cache ──────────────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number;
  userId: string;
}

let _token: TokenCache | null = null;
let _timeZone: string | null = null;

async function getToken(): Promise<TokenCache> {
  if (_token && _token.expiresAt > Date.now() + 120_000) return _token;

  const email = process.env.EIGHT_SLEEP_EMAIL;
  const password = process.env.EIGHT_SLEEP_PASSWORD;
  if (!email || !password) {
    throw new Error('EIGHT_SLEEP_EMAIL and EIGHT_SLEEP_PASSWORD env vars are required');
  }

  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      client_id: process.env.EIGHT_SLEEP_CLIENT_ID ?? DEFAULT_CLIENT_ID,
      client_secret: process.env.EIGHT_SLEEP_CLIENT_SECRET ?? DEFAULT_CLIENT_SECRET,
      grant_type: 'password',
      username: email,
      password,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Eight Sleep login failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    userId: string;
  };
  _token = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    userId: data.userId,
  };
  return _token;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function api(
  path: string,
  options: RequestInit = {},
  baseUrl = APP_API_URL,
): Promise<unknown> {
  const { accessToken, userId } = await getToken();
  const url = path.replace('{userId}', userId);

  const res = await fetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${accessToken}`,
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });

  if (res.status === 204) return null;

  if (!res.ok) {
    throw new EightSleepApiError(res.status, url, await res.text());
  }

  return res.json();
}

// ─── User info ────────────────────────────────────────────────────────────────

/** IANA timezone from the user's Eight Sleep profile, e.g. "America/New_York". */
export async function getUserTimeZone(): Promise<string> {
  if (_timeZone) return _timeZone;
  const data = (await api('/v1/users/me', {}, CLIENT_API_URL)) as {
    user?: { timeZone?: string; notifications?: { timeZone?: string } };
  };
  _timeZone =
    data.user?.timeZone ?? data.user?.notifications?.timeZone ?? 'America/New_York';
  return _timeZone;
}

// ─── Alarm CRUD ───────────────────────────────────────────────────────────────

export async function getAlarms(): Promise<Alarm[]> {
  const data = (await api('/v1/users/{userId}/alarms')) as { alarms?: Alarm[] };
  return data?.alarms ?? [];
}

export async function createAlarm(opts: CreateAlarmOptions): Promise<void> {
  const allDays = {
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
  };

  const hasDays = opts.days && Object.values(opts.days).some(Boolean);

  const body = {
    time: opts.time,
    enabled: true,
    repeat: {
      enabled: hasDays ?? false,
      weekDays: hasDays ? { ...allDays, ...opts.days } : allDays,
    },
    vibration: {
      enabled: true,
      pattern: opts.vibration?.pattern ?? 'RISE',
      powerLevel: opts.vibration?.powerLevel ?? 50,
    },
    thermal: {
      enabled: opts.thermal?.enabled ?? true,
      level: opts.thermal?.level ?? 0,
    },
    audio: { enabled: false, level: 30 },
    smart: {
      lightSleepEnabled: opts.smartWake ?? false,
      sleepCapEnabled: false,
    },
  };

  // Responds with the updated full alarm list
  await api('/v1/users/{userId}/alarms', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** PUT requires the full writable alarm object; server-computed fields are stripped. */
export async function updateAlarm(alarm: Alarm, patch: Partial<Alarm>): Promise<void> {
  const merged = { ...alarm, ...patch };
  const body = {
    id: alarm.id,
    time: merged.time,
    enabled: merged.enabled,
    repeat: merged.repeat,
    vibration: merged.vibration,
    thermal: merged.thermal,
    audio: merged.audio,
    smart: merged.smart,
  };
  await api(`/v1/users/{userId}/alarms/${alarm.id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteAlarm(alarmId: string): Promise<void> {
  await api(`/v1/users/{userId}/alarms/${alarmId}`, { method: 'DELETE' });
}

// ─── Active alarm actions ─────────────────────────────────────────────────────
// Both return 409 Conflict when the alarm is not currently ringing/snoozed.

export async function snoozeAlarm(alarmId: string, minutes = 9): Promise<void> {
  await api(`/v1/users/{userId}/alarms/${alarmId}/snooze`, {
    method: 'PUT',
    body: JSON.stringify({ snoozeMinutes: minutes, ignoreDeviceErrors: false }),
  });
}

export async function dismissAlarm(alarmId: string): Promise<void> {
  await api(`/v1/users/{userId}/alarms/${alarmId}/dismiss`, {
    method: 'PUT',
    body: JSON.stringify({ ignoreDeviceErrors: false }),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minutes since local midnight in the given IANA timezone. */
export function localNowMinutes(timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Alarm most likely ringing or snoozed right now: snoozing, or enabled with a
 * fire time in the past ~45 min that hasn't been dismissed since it fired.
 */
export function findActiveAlarm(alarms: Alarm[], nowMinutes: number): Alarm | null {
  const snoozed = alarms.find((a) => a.snoozing);
  if (snoozed) return snoozed;

  return (
    alarms
      .filter((a) => a.enabled)
      .find((a) => {
        const diff = nowMinutes - timeToMinutes(a.time);
        const recentlyFired = diff >= 0 && diff <= 45;
        const dismissed =
          new Date(a.dismissedUntil).getTime() > Date.now() - 60 * 60_000;
        return recentlyFired && !dismissed;
      }) ?? null
  );
}

/** Next upcoming enabled alarm from now (local time). */
export function findNextAlarm(alarms: Alarm[], nowMinutes: number): Alarm | null {
  const enabled = alarms.filter((a) => a.enabled);
  if (!enabled.length) return null;

  const toFuture = (t: string) => {
    const mins = timeToMinutes(t);
    return mins >= nowMinutes ? mins : mins + 1440;
  };
  return [...enabled].sort((a, b) => toFuture(a.time) - toFuture(b.time))[0];
}

/** "07:30:00" → "7:30 AM" */
export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${period}` : `${hour}:${m.toString().padStart(2, '0')} ${period}`;
}
