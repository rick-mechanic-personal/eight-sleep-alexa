import { NextRequest, NextResponse } from 'next/server';
import verifier from 'alexa-verifier';
import {
  type AlexaRequest,
  type IntentRequest,
  speak,
  ask,
  getSlot,
  parseAlexaTime,
  parseDuration,
  parseDay,
  parseVibrationPattern,
} from '@/lib/alexa';
import {
  getAlarms,
  createAlarm,
  snoozeAlarm,
  dismissAlarm,
  dismissAllAlarms,
  deleteAlarm,
  updateAlarm,
  findActiveAlarm,
  findNextAlarm,
  formatTime,
} from '@/lib/eight-sleep';

async function verifyAlexaRequest(req: NextRequest, body: string): Promise<boolean> {
  if (process.env.NODE_ENV === 'development') return true;
  const signatureChainUrl = req.headers.get('signaturecertchainurl');
  const signature = req.headers.get('signature');
  if (!signatureChainUrl || !signature) return false;
  try {
    return await new Promise((resolve) => {
      verifier(signatureChainUrl, signature, body, (err: Error | null) => resolve(!err));
    });
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  let body = '';
  try {
    body = await req.text();

    if (!(await verifyAlexaRequest(req, body))) {
      console.error('[Sleep Alarms] Signature verification failed');
      return NextResponse.json({ error: 'Invalid Alexa signature' }, { status: 400 });
    }

    let alexaReq: AlexaRequest;
    try {
      alexaReq = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    return await handleAlexaRequest(alexaReq);
  } catch (err) {
    console.error('[Sleep Alarms] Unhandled top-level error:', err);
    return NextResponse.json(speak('An unexpected error occurred. Please try again.'));
  }
}

async function handleAlexaRequest(alexaReq: AlexaRequest) {

  // Restrict to your skill (optional but recommended)
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

  if (requestType === 'LaunchRequest') {
    return json(
      ask(
        'Sleep Alarms is ready. You can set an alarm, snooze, dismiss, cancel, or ask what alarms you have.',
        'What would you like to do?',
      ),
    );
  }

  if (requestType === 'SessionEndedRequest') {
    return json(speak('Goodbye.'));
  }

  if (requestType !== 'IntentRequest') {
    return json(speak('Sorry, I did not understand that.'));
  }

  const intentName = (alexaReq.request as IntentRequest).intent.name;

  try {
    // ── Built-ins ──────────────────────────────────────────────────────────────
    if (intentName === 'AMAZON.HelpIntent') {
      return json(
        ask(
          'You can say: ' +
            '"set an alarm for 7 AM" to create an alarm. ' +
            '"set a gentle alarm for 6:30" or "set a strong alarm for 7" for different vibrations. ' +
            '"snooze" or "snooze for 10 minutes" to snooze. ' +
            '"dismiss alarm" to stop the current alarm. ' +
            '"cancel my alarm" to delete the next alarm. ' +
            'Or "what alarms do I have" to list them.',
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
      if (!enabled.length) return json(speak('You have no alarms set on your Eight Sleep.'));

      const sorted = [...enabled].sort((a, b) => a.time.localeCompare(b.time));
      const list = sorted
        .map((a) => {
          const parts: string[] = [formatTime(a.time)];
          if (a.vibration.pattern === 'intense') parts.push('strong vibration');
          if (a.thermal.enabled && a.thermal.level !== 0)
            parts.push(a.thermal.level > 0 ? 'warming' : 'cooling');
          if (a.smart.lightSleepEnabled) parts.push('smart wake');
          return parts.join(' with ');
        })
        .join('. ');

      return json(
        speak(
          sorted.length === 1
            ? `You have one alarm: ${list}.`
            : `You have ${sorted.length} alarms: ${list}.`,
        ),
      );
    }

    // ── Set alarm ──────────────────────────────────────────────────────────────
    if (intentName === 'SetAlarmIntent') {
      const timeValue = getSlot(alexaReq, 'time');
      const dayValue = getSlot(alexaReq, 'day');
      const vibrationValue = getSlot(alexaReq, 'vibration');

      if (!timeValue) {
        return json(ask('What time should I set the alarm for?', 'Please say a time, like 7 AM.'));
      }

      const time = parseAlexaTime(timeValue);
      if (!time) return json(speak("Sorry, I couldn't understand that time. Please try again."));

      const days = dayValue ? { [parseDay(dayValue) ?? dayValue.toLowerCase()]: true } : undefined;
      const vibrationPattern = vibrationValue ? parseVibrationPattern(vibrationValue) : 'RISE';

      await createAlarm({ time, days, vibration: { pattern: vibrationPattern } });

      const friendlyTime = formatTime(time);
      const vibDesc = vibrationPattern === 'intense' ? 'strong vibration' : 'gentle rise';
      const dayMsg = dayValue ? ` on ${dayValue}` : '';
      return json(speak(`Done! Alarm set for ${friendlyTime}${dayMsg} with ${vibDesc}.`));
    }

    // ── Snooze ─────────────────────────────────────────────────────────────────
    if (intentName === 'SnoozeAlarmIntent') {
      const durationValue = getSlot(alexaReq, 'duration');
      const minutes = durationValue ? parseDuration(durationValue) : 9;

      const alarms = await getAlarms();
      const target = findActiveAlarm(alarms) ?? findNextAlarm(alarms);
      if (!target) return json(speak("I couldn't find an alarm to snooze."));

      await snoozeAlarm(target.id, minutes);
      const word = minutes === 1 ? 'minute' : 'minutes';
      return json(speak(`Snoozed for ${minutes} ${word}. Sweet dreams.`));
    }

    // ── Dismiss (stop currently ringing alarm) ─────────────────────────────────
    if (intentName === 'DismissAlarmIntent') {
      const alarms = await getAlarms();
      const active = findActiveAlarm(alarms);

      if (!active) {
        // Try dismiss-all as a fallback — catches alarms the app considers active
        try {
          await dismissAllAlarms();
          return json(speak('Alarm dismissed. Good morning!'));
        } catch {
          return json(speak("There doesn't seem to be an alarm ringing right now."));
        }
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
        const target = alarms.find((a) => a.time === time || a.time.startsWith(time ?? ''));
        if (!target)
          return json(
            speak(`I couldn't find an alarm for ${formatTime(time ?? timeValue)}.`),
          );
        await deleteAlarm(target.id);
        return json(speak(`Alarm for ${formatTime(target.time)} has been cancelled.`));
      }

      const next = findNextAlarm(alarms);
      if (!next) return json(speak('You have no alarms to cancel.'));
      await deleteAlarm(next.id);
      return json(speak(`Your ${formatTime(next.time)} alarm has been cancelled.`));
    }

    // ── Toggle vibration on next alarm ─────────────────────────────────────────
    if (intentName === 'SetVibrationIntent') {
      const vibrationValue = getSlot(alexaReq, 'vibration');
      if (!vibrationValue) return json(ask('Should I set gentle or strong vibration?', 'Gentle or strong?'));

      const alarms = await getAlarms();
      const next = findNextAlarm(alarms);
      if (!next) return json(speak("You don't have an upcoming alarm to update."));

      const pattern = parseVibrationPattern(vibrationValue);
      await updateAlarm(next.id, {
        ...next,
        vibration: { ...next.vibration, pattern },
      });

      const desc = pattern === 'intense' ? 'strong' : 'gentle rise';
      return json(speak(`Updated your ${formatTime(next.time)} alarm to ${desc} vibration.`));
    }

    // ── Toggle thermal on next alarm ───────────────────────────────────────────
    if (intentName === 'SetThermalAlarmIntent') {
      const thermalValue = getSlot(alexaReq, 'thermal');
      const alarms = await getAlarms();
      const next = findNextAlarm(alarms);
      if (!next) return json(speak("You don't have an upcoming alarm to update."));

      let thermalEnabled = true;
      if (thermalValue?.toLowerCase().includes('off') || thermalValue?.toLowerCase().includes('no')) {
        thermalEnabled = false;
      }

      await updateAlarm(next.id, {
        ...next,
        thermal: { ...next.thermal, enabled: thermalEnabled },
      });

      return json(
        speak(
          thermalEnabled
            ? `Thermal wake turned on for your ${formatTime(next.time)} alarm.`
            : `Thermal wake turned off for your ${formatTime(next.time)} alarm.`,
        ),
      );
    }

    // ── Toggle smart wake on next alarm ────────────────────────────────────────
    if (intentName === 'SetSmartWakeIntent') {
      const smartValue = getSlot(alexaReq, 'smart');
      const alarms = await getAlarms();
      const next = findNextAlarm(alarms);
      if (!next) return json(speak("You don't have an upcoming alarm to update."));

      const enabled =
        !smartValue ||
        !(smartValue.toLowerCase().includes('off') || smartValue.toLowerCase().includes('no'));

      await updateAlarm(next.id, {
        ...next,
        smart: { ...next.smart, lightSleepEnabled: enabled },
      });

      return json(
        speak(
          enabled
            ? `Smart wake enabled. Eight Sleep will wake you during light sleep before ${formatTime(next.time)}.`
            : `Smart wake disabled for your ${formatTime(next.time)} alarm.`,
        ),
      );
    }

    return json(speak("Sorry, I don't know how to handle that request."));
  } catch (err) {
    console.error('[Sleep Alarms] Error:', err);
    const message = err instanceof Error ? err.message : 'unknown error';
    if (message.includes('login failed') || message.includes('env vars are required')) {
      return json(
        speak(
          'Eight Sleep is not configured. Please add your credentials in the Vercel environment settings.',
        ),
      );
    }
    return json(speak('Something went wrong talking to Eight Sleep. Please try again.'));
  }
}

function json(data: object) {
  return NextResponse.json(data);
}
