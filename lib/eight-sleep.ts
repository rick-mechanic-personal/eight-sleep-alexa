// Eight Sleep unofficial API client
// Reverse-engineered from the mobile app by the community.
// Ref: https://github.com/lukas-clarke/eight_sleep, https://github.com/Apollo-Sunbeam/pyeight

const APP_API_URL = 'https://app-api.8slp.net';
const CLIENT_API_URL = 'https://client-api.8slp.net';

const USER_AGENT = 'Eight Sleep (com.eightsleep.app) / 7.39.17 platform/iOS';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VibrationPattern = 'RISE' | 'intense'; // RISE = gentle, intense = strong
export type VibrationPower = 20 | 50 | 100; // low / medium / high

export interface AlarmVibration {
  enabled: boolean;
  powerLevel: VibrationPower;
  pattern: VibrationPattern;
}

export interface AlarmThermal {
  enabled: boolean;
  /** Temperature offset -100 to 100. Negative = cool, positive = warm. 0 = no change. */
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
  time: string; // "HH:MM:SS"
  nextTimestamp?: number; // unix ms
  repeat: AlarmRepeat;
  vibration: AlarmVibration;
  thermal: AlarmThermal;
  smart: AlarmSmart;
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

// ─── Token cache ──────────────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number;
  userId: string;
}

let _cache: TokenCache | null = null;

async function getToken(): Promise<TokenCache> {
  if (_cache && _cache.expiresAt > Date.now() + 60_000) return _cache;

  const email = process.env.EIGHT_SLEEP_EMAIL;
  const password = process.env.EIGHT_SLEEP_PASSWORD;
  if (!email || !password) {
    throw new Error('EIGHT_SLEEP_EMAIL and EIGHT_SLEEP_PASSWORD env vars are required');
  }

  // Use the legacy login endpoint — does not require OAuth2 client credentials
  const res = await fetch(`${CLIENT_API_URL}/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Eight Sleep login failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  // Response shape: { session: { userId, token, expirationDate } }
  const session = data.session ?? data;
  _cache = {
    accessToken: session.token ?? session.access_token,
    expiresAt: session.expirationDate
      ? new Date(session.expirationDate).getTime()
      : Date.now() + 3600 * 1000,
    userId: session.userId ?? session.user_id,
  };
  return _cache;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function api(
  path: string,
  options: RequestInit = {},
  baseUrl = APP_API_URL,
): Promise<unknown> {
  const { accessToken, userId } = await getToken();
  const url = path.replace('{userId}', userId);

  let res = await fetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': USER_AGENT,
      ...(options.headers ?? {}),
    },
  });

  // Retry with fallback host on 5xx or network error
  if (!res.ok && res.status >= 500 && baseUrl === APP_API_URL) {
    res = await fetch(`${CLIENT_API_URL}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': USER_AGENT,
        ...(options.headers ?? {}),
      },
    });
  }

  if (res.status === 204) return null;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Eight Sleep API ${res.status} on ${url}: ${body}`);
  }

  return res.json();
}

// ─── Alarm CRUD ───────────────────────────────────────────────────────────────

export async function getAlarms(): Promise<Alarm[]> {
  const data = (await api('/v1/users/{userId}/alarms')) as { alarms?: Alarm[] } | Alarm[];
  return (Array.isArray(data) ? data : data?.alarms) ?? [];
}

export async function createAlarm(opts: CreateAlarmOptions): Promise<Alarm> {
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
    smart: {
      lightSleepEnabled: opts.smartWake ?? true,
      sleepCapEnabled: false,
    },
  };

  return (await api('/v1/users/{userId}/alarms', {
    method: 'POST',
    body: JSON.stringify(body),
  })) as Alarm;
}

export async function updateAlarm(alarmId: string, patch: Partial<Alarm>): Promise<Alarm> {
  return (await api(`/v1/users/{userId}/alarms/${alarmId}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })) as Alarm;
}

export async function deleteAlarm(alarmId: string): Promise<void> {
  // Eight Sleep deletes by disabling, or via DELETE endpoint
  try {
    await api(`/v1/users/{userId}/alarms/${alarmId}`, { method: 'DELETE' });
  } catch {
    // Fallback: disable it
    await updateAlarm(alarmId, { enabled: false });
  }
}

// ─── Active alarm actions (via routines endpoint) ─────────────────────────────

export async function snoozeAlarm(alarmId: string, minutes = 9): Promise<void> {
  await api('/v1/users/{userId}/routines', {
    method: 'PUT',
    body: JSON.stringify({ alarm: { alarmId, snoozeForMinutes: minutes } }),
  });
}

export async function dismissAlarm(alarmId: string): Promise<void> {
  await api('/v1/users/{userId}/routines', {
    method: 'PUT',
    body: JSON.stringify({ alarm: { alarmId, dismissed: true } }),
  });
}

export async function dismissAllAlarms(): Promise<void> {
  const { userId } = await getToken();
  await api(`/v1/users/${userId}/alarms/active/dismiss-all`, { method: 'POST' });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Alarm close to current time (within ±30 min) — likely ringing. */
export function findActiveAlarm(alarms: Alarm[]): Alarm | null {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    alarms
      .filter((a) => a.enabled)
      .find((a) => {
        const [h, m] = a.time.split(':').map(Number);
        return Math.abs(h * 60 + m - nowMin) <= 30;
      }) ?? null
  );
}

/** Next upcoming alarm from now. */
export function findNextAlarm(alarms: Alarm[]): Alarm | null {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const enabled = alarms.filter((a) => a.enabled);
  if (!enabled.length) return null;

  return enabled.sort((a, b) => {
    const toFuture = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      const mins = h * 60 + m;
      return mins >= nowMin ? mins : mins + 1440;
    };
    return toFuture(a.time) - toFuture(b.time);
  })[0];
}

/** "07:30:00" → "7:30 AM" */
export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${period}` : `${hour}:${m.toString().padStart(2, '0')} ${period}`;
}

/** "HH:MM" or "HH:MM:SS" → canonical "HH:MM:SS" */
export function toApiTime(t: string): string {
  const parts = t.split(':');
  return `${parts[0].padStart(2, '0')}:${(parts[1] ?? '00').padStart(2, '0')}:${(parts[2] ?? '00').padStart(2, '0')}`;
}
