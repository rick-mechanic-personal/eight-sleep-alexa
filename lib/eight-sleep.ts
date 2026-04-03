// Eight Sleep unofficial API client
// API reverse-engineered from the mobile app by the community
// Ref: https://github.com/lukas-clarke/eight_sleep, https://github.com/Apollo-Sunbeam/pyeight

const AUTH_URL = 'https://auth-api.8slp.net';
const CLIENT_URL = 'https://client-api.8slp.net';

// Credentials extracted from the Eight Sleep Android APK by the community.
// Override via env vars if these stop working.
const DEFAULT_CLIENT_ID = process.env.EIGHT_SLEEP_CLIENT_ID || '0894c7f33bb94800a03f1f4df13a4f38';
const DEFAULT_CLIENT_SECRET = process.env.EIGHT_SLEEP_CLIENT_SECRET || 'f0954a3ed5763ba4e44ec7191b7a2e7b';

const USER_AGENT = 'Eight Sleep (com.eightsleep.app) / 7.39.17 platform/iOS';

export interface Alarm {
  id: string;
  time: string; // HH:MM format (24h)
  enabled: boolean;
  vibration?: string; // 'rise' | 'double'
  thermalWake?: boolean;
  days?: string[]; // ['MON','TUE','WED','THU','FRI','SAT','SUN']
}

interface TokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
}

// Module-level cache — persists across warm serverless invocations
let _tokenCache: TokenCache | null = null;

async function getToken(): Promise<TokenCache> {
  // Return cached token if still valid (with 60s buffer)
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60_000) {
    return _tokenCache;
  }

  // Try refresh token first to avoid rate-limiting from repeated logins
  if (_tokenCache?.refreshToken) {
    try {
      const res = await fetch(`${AUTH_URL}/v1/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: _tokenCache.refreshToken,
          client_id: DEFAULT_CLIENT_ID,
          client_secret: DEFAULT_CLIENT_SECRET,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        _tokenCache = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || _tokenCache.refreshToken,
          expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
          userId: _tokenCache.userId,
        };
        return _tokenCache;
      }
    } catch {
      // Fall through to full login
    }
  }

  // Full login
  const email = process.env.EIGHT_SLEEP_EMAIL;
  const password = process.env.EIGHT_SLEEP_PASSWORD;
  if (!email || !password) {
    throw new Error('EIGHT_SLEEP_EMAIL and EIGHT_SLEEP_PASSWORD env vars are required');
  }

  const res = await fetch(`${AUTH_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      email,
      password,
      client_id: DEFAULT_CLIENT_ID,
      client_secret: DEFAULT_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Eight Sleep login failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  _tokenCache = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    userId: data.userId ?? data.user?.id,
  };
  return _tokenCache;
}

async function api(path: string, options: RequestInit = {}) {
  const { accessToken, userId } = await getToken();
  const url = path.replace('{userId}', userId);

  const res = await fetch(`${CLIENT_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': USER_AGENT,
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 204) return null;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Eight Sleep API error ${res.status} on ${url}: ${body}`);
  }

  return res.json();
}

export async function getAlarms(): Promise<Alarm[]> {
  const data = await api('/v1/users/{userId}/alarms');
  return data?.alarms ?? data ?? [];
}

export async function createAlarm(
  time: string, // "HH:MM" 24-hour
  days?: string[], // e.g. ['MON','WED','FRI']
): Promise<Alarm> {
  const body: Record<string, unknown> = {
    time,
    enabled: true,
    vibration: 'rise',
    thermalWake: true,
  };
  if (days && days.length > 0) body.days = days;

  return api('/v1/users/{userId}/alarms', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function snoozeAlarm(alarmId: string, minutes = 9): Promise<void> {
  await api(`/v1/users/{userId}/alarms/${alarmId}/snooze`, {
    method: 'POST',
    body: JSON.stringify({ minutes }),
  });
}

export async function dismissAlarm(alarmId: string): Promise<void> {
  await api(`/v1/users/{userId}/alarms/${alarmId}/dismiss`, {
    method: 'POST',
  });
}

export async function deleteAlarm(alarmId: string): Promise<void> {
  await api(`/v1/users/{userId}/alarms/${alarmId}`, {
    method: 'DELETE',
  });
}

// Returns the alarm closest to current time that's within 30 minutes (likely ringing)
export function findActiveAlarm(alarms: Alarm[]): Alarm | null {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    alarms
      .filter((a) => a.enabled)
      .find((a) => {
        const [h, m] = a.time.split(':').map(Number);
        const alarmMinutes = h * 60 + m;
        const diff = Math.abs(alarmMinutes - nowMinutes);
        return diff <= 30;
      }) ?? null
  );
}

// Returns the next upcoming alarm from now
export function findNextAlarm(alarms: Alarm[]): Alarm | null {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const enabled = alarms.filter((a) => a.enabled);
  if (enabled.length === 0) return null;

  enabled.sort((a, b) => {
    const [ah, am] = a.time.split(':').map(Number);
    const [bh, bm] = b.time.split(':').map(Number);
    const aMins = ah * 60 + am;
    const bMins = bh * 60 + bm;
    // Future alarms first; wrap around midnight
    const aFuture = aMins >= nowMinutes ? aMins : aMins + 1440;
    const bFuture = bMins >= nowMinutes ? bMins : bMins + 1440;
    return aFuture - bFuture;
  });

  return enabled[0];
}

// Format "07:30" -> "7:30 AM", "14:00" -> "2 PM"
export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${period}` : `${hour}:${m.toString().padStart(2, '0')} ${period}`;
}
