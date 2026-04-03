import { NextRequest, NextResponse } from 'next/server';
import {
  type AlexaRequest,
  speak,
  ask,
  getSlot,
  parseAlexaTime,
  parseDuration,
} from '@/lib/alexa';
import {
  getAlarms,
  createAlarm,
  snoozeAlarm,
  dismissAlarm,
  deleteAlarm,
  findActiveAlarm,
  findNextAlarm,
  formatTime,
} from '@/lib/eight-sleep';

// Alexa requires the raw body for signature verification.
// We skip cert verification in dev; in prod it's enforced below.
async function verifyAlexaRequest(req: NextRequest, body: string): Promise<boolean> {
  if (process.env.NODE_ENV === 'development') return true;

  const signatureChainUrl = req.headers.get('signaturecertchainurl');
  const signature = req.headers.get('signature');

  if (!signatureChainUrl || !signature) return false;

  // Dynamically import to avoid edge runtime issues
  const { default: verifier } = await import('alexa-verifier');

  return new Promise((resolve) => {
    verifier(signatureChainUrl, signature, body, (err: Error | null) => {
      resolve(!err);
    });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.text();

  const valid = await verifyAlexaRequest(req, body);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid Alexa signature' }, { status: 400 });
  }

  let alexaReq: AlexaRequest;
  try {
    alexaReq = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Optional: restrict to your skill's ID
  const allowedSkillId = process.env.ALEXA_SKILL_ID;
  if (allowedSkillId) {
    const incomingId =
      alexaReq.session?.application?.applicationId ??
      alexaReq.context?.System?.application?.applicationId;
    if (incomingId !== allowedSkillId) {
      return NextResponse.json({ error: 'Skill ID mismatch' }, { status: 403 });
    }
  }

  const requestType = alexaReq.request.type;

  // ── Launch ──────────────────────────────────────────────────────────────────
  if (requestType === 'LaunchRequest') {
    return json(
      ask(
        'Eight Sleep is ready. You can say: set an alarm, snooze my alarm, cancel my alarm, or list my alarms.',
        'What would you like to do? You can set, snooze, or cancel an alarm.',
      ),
    );
  }

  // ── Session ended ────────────────────────────────────────────────────────────
  if (requestType === 'SessionEndedRequest') {
    return json(speak('Goodbye.'));
  }

  if (requestType !== 'IntentRequest') {
    return json(speak('Sorry, I did not understand that request.'));
  }

  const intentName = (alexaReq.request as { type: string; intent: { name: string } }).intent.name;

  try {
    // ── Built-in intents ───────────────────────────────────────────────────────
    if (intentName === 'AMAZON.HelpIntent') {
      return json(
        ask(
          'With Eight Sleep you can: say "set an alarm for 7 AM" to create an alarm, ' +
            '"snooze" or "snooze for 10 minutes" to snooze an alarm, ' +
            '"cancel my alarm" to delete your next alarm, ' +
            'or "list my alarms" to hear your upcoming alarms.',
          'What would you like to do?',
        ),
      );
    }

    if (intentName === 'AMAZON.CancelIntent' || intentName === 'AMAZON.StopIntent') {
      return json(speak('Goodbye.'));
    }

    // ── List alarms ────────────────────────────────────────────────────────────
    if (intentName === 'ListAlarmsIntent') {
      const alarms = await getAlarms();
      const enabled = alarms.filter((a) => a.enabled);

      if (enabled.length === 0) {
        return json(speak('You have no alarms set on your Eight Sleep.'));
      }

      const sorted = [...enabled].sort((a, b) => a.time.localeCompare(b.time));
      const list = sorted.map((a) => formatTime(a.time)).join(', ');
      const msg =
        sorted.length === 1
          ? `You have one alarm set for ${list}.`
          : `You have ${sorted.length} alarms: ${list}.`;
      return json(speak(msg));
    }

    // ── Set alarm ──────────────────────────────────────────────────────────────
    if (intentName === 'SetAlarmIntent') {
      const timeValue = getSlot(alexaReq, 'time');
      const dayValue = getSlot(alexaReq, 'day');

      if (!timeValue) {
        return json(ask('What time should I set the alarm for?', 'Please say a time, like 7 AM.'));
      }

      const time = parseAlexaTime(timeValue);
      if (!time) {
        return json(speak("Sorry, I couldn't understand that time. Please try again."));
      }

      const days = dayValue ? [dayValue.toUpperCase().slice(0, 3)] : undefined;
      await createAlarm(time, days);

      const friendly = formatTime(time);
      const dayMsg = days ? ` on ${dayValue}` : '';
      return json(speak(`Done! I've set your Eight Sleep alarm for ${friendly}${dayMsg}.`));
    }

    // ── Snooze alarm ───────────────────────────────────────────────────────────
    if (intentName === 'SnoozeAlarmIntent') {
      const durationValue = getSlot(alexaReq, 'duration');
      const minutes = durationValue ? parseDuration(durationValue) : 9;

      const alarms = await getAlarms();
      const active = findActiveAlarm(alarms) ?? findNextAlarm(alarms);

      if (!active) {
        return json(speak("I couldn't find an active or upcoming alarm to snooze."));
      }

      await snoozeAlarm(active.id, minutes);
      const minuteWord = minutes === 1 ? 'minute' : 'minutes';
      return json(speak(`Snoozed for ${minutes} ${minuteWord}. Sweet dreams.`));
    }

    // ── Dismiss alarm (stop ringing) ───────────────────────────────────────────
    if (intentName === 'DismissAlarmIntent') {
      const alarms = await getAlarms();
      const active = findActiveAlarm(alarms);

      if (!active) {
        return json(speak("There doesn't appear to be an alarm currently ringing."));
      }

      await dismissAlarm(active.id);
      return json(speak('Alarm dismissed. Good morning!'));
    }

    // ── Cancel / delete alarm ──────────────────────────────────────────────────
    if (intentName === 'CancelAlarmIntent') {
      const timeValue = getSlot(alexaReq, 'time');

      const alarms = await getAlarms();

      if (timeValue) {
        const time = parseAlexaTime(timeValue);
        const target = alarms.find((a) => a.time === time);
        if (!target) {
          return json(speak(`I couldn't find an alarm for ${formatTime(time ?? timeValue)}.`));
        }
        await deleteAlarm(target.id);
        return json(speak(`Alarm for ${formatTime(target.time)} has been cancelled.`));
      }

      // No time given — cancel next upcoming alarm
      const next = findNextAlarm(alarms);
      if (!next) {
        return json(speak('You have no alarms to cancel.'));
      }
      await deleteAlarm(next.id);
      return json(speak(`Your ${formatTime(next.time)} alarm has been cancelled.`));
    }

    return json(speak("Sorry, I don't know how to handle that request."));
  } catch (err) {
    console.error('[Eight Sleep Alexa] Error:', err);
    const message = err instanceof Error ? err.message : 'unknown error';

    // Friendly error for credential issues
    if (message.includes('login failed') || message.includes('env vars are required')) {
      return json(
        speak(
          'Eight Sleep is not configured yet. Please add your credentials in the Vercel environment settings.',
        ),
      );
    }

    return json(speak('Something went wrong talking to Eight Sleep. Please try again.'));
  }
}

function json(data: object) {
  return NextResponse.json(data);
}
