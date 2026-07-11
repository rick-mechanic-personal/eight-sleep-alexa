import { NextRequest, NextResponse } from 'next/server';
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
  parseStrength,
  parseTempLevel,
  formatTempLevel,
} from '@/lib/alexa';
import {
  type Alarm,
  EightSleepApiError,
  getAlarms,
  getUserTimeZone,
  createAlarm,
  snoozeAlarm,
  dismissAlarm,
  deleteAlarm,
  updateAlarm,
  findActiveAlarm,
  findNextAlarm,
  localNowMinutes,
  formatTime,
} from '@/lib/eight-sleep';

export async function POST(req: NextRequest) {
  let body = '';
  try {
    body = await req.text();

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

async function alarmsWithNow(): Promise<{ alarms: Alarm[]; nowMinutes: number }> {
  const [alarms, timeZone] = await Promise.all([getAlarms(), getUserTimeZone()]);
  return { alarms, nowMinutes: localNowMinutes(timeZone) };
}

function isConflict(err: unknown): boolean {
  return err instanceof EightSleepApiError && err.status === 409;
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
            '"set a gradual alarm" or "set a heavy alarm" for the vibration pattern. ' +
            '"set an alarm for 7 with high strength" for vibration strength. ' +
            '"set an alarm for 7 warming level 3" or "cooling level 5" for wake temperature. ' +
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
          if (a.vibration.pattern === 'INTENSE') parts.push('heavy vibration');
          if (a.thermal.enabled && a.thermal.level !== 0)
            parts.push(formatTempLevel(a.thermal.level));
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
      const strengthValue = getSlot(alexaReq, 'strength');
      const tempDirectionValue = getSlot(alexaReq, 'tempDirection');
      const tempLevelValue = getSlot(alexaReq, 'tempLevel');

      if (!timeValue) {
        return json(ask('What time should I set the alarm for?', 'Please say a time, like 7 AM.'));
      }

      const time = parseAlexaTime(timeValue);
      if (!time) return json(speak("Sorry, I couldn't understand that time. Please try again."));

      const day = dayValue ? parseDay(dayValue) : null;
      const days = day ? { [day]: true } : undefined;
      const vibrationPattern = vibrationValue ? parseVibrationPattern(vibrationValue) : 'RISE';
      const powerLevel = strengthValue ? parseStrength(strengthValue) : 50;
      const tempLevel = tempLevelValue
        ? parseTempLevel(tempDirectionValue, tempLevelValue)
        : null;

      const created = await createAlarm({
        time,
        days,
        vibration: { pattern: vibrationPattern, powerLevel },
        thermal: tempLevel !== null ? { enabled: true, level: tempLevel } : undefined,
      });

      const friendlyTime = formatTime(time);
      if (!created) {
        return json(
          speak(
            `I asked your Eight Sleep to set an alarm for ${friendlyTime}, but couldn't confirm it was saved. Please check the app.`,
          ),
        );
      }

      const parts = [
        created.vibration.pattern === 'INTENSE' ? 'heavy vibration' : 'gradual vibration',
      ];
      if (strengthValue) parts.push(`${strengthValue.toLowerCase()} strength`);
      if (created.thermal.enabled && created.thermal.level !== 0)
        parts.push(formatTempLevel(created.thermal.level));
      const dayMsg = day ? ` every ${day}` : '';
      return json(
        speak(
          `Done! Your Eight Sleep confirmed the alarm for ${friendlyTime}${dayMsg} with ${parts.join(', ')}.`,
        ),
      );
    }

    // ── Snooze (only works while an alarm is ringing or snoozed) ───────────────
    if (intentName === 'SnoozeAlarmIntent') {
      const durationValue = getSlot(alexaReq, 'duration');
      const minutes = durationValue ? parseDuration(durationValue) : 9;

      const { alarms, nowMinutes } = await alarmsWithNow();
      const target = findActiveAlarm(alarms, nowMinutes);
      if (!target) {
        return json(speak("There doesn't seem to be an alarm ringing to snooze."));
      }

      try {
        await snoozeAlarm(target.id, minutes);
      } catch (err) {
        if (isConflict(err)) {
          return json(speak("There doesn't seem to be an alarm ringing to snooze."));
        }
        throw err;
      }
      const word = minutes === 1 ? 'minute' : 'minutes';
      return json(
        speak(`Your Eight Sleep confirmed the snooze for ${minutes} ${word}. Sweet dreams.`),
      );
    }

    // ── Dismiss (stop currently ringing alarm) ─────────────────────────────────
    if (intentName === 'DismissAlarmIntent') {
      const { alarms, nowMinutes } = await alarmsWithNow();
      const active = findActiveAlarm(alarms, nowMinutes);
      if (!active) {
        return json(speak("There doesn't seem to be an alarm ringing right now."));
      }

      try {
        await dismissAlarm(active.id);
      } catch (err) {
        if (isConflict(err)) {
          return json(speak("There doesn't seem to be an alarm ringing right now."));
        }
        throw err;
      }
      return json(speak('Your Eight Sleep confirmed the alarm is dismissed. Good morning!'));
    }

    // ── Cancel / delete alarm ──────────────────────────────────────────────────
    if (intentName === 'CancelAlarmIntent') {
      const timeValue = getSlot(alexaReq, 'time');
      const { alarms, nowMinutes } = await alarmsWithNow();
      const enabled = alarms.filter((a) => a.enabled);

      if (timeValue) {
        const time = parseAlexaTime(timeValue);
        const target = enabled.find((a) => a.time === time);
        if (!target)
          return json(
            speak(`I couldn't find an alarm for ${formatTime(time ?? timeValue)}.`),
          );
        const gone = await deleteAlarm(target.id);
        return json(
          speak(
            gone
              ? `Your Eight Sleep confirmed the ${formatTime(target.time)} alarm was removed.`
              : `I asked your Eight Sleep to cancel the ${formatTime(target.time)} alarm, but couldn't confirm it was removed. Please check the app.`,
          ),
        );
      }

      const next = findNextAlarm(alarms, nowMinutes);
      if (!next) return json(speak('You have no alarms to cancel.'));
      const gone = await deleteAlarm(next.id);
      return json(
        speak(
          gone
            ? `Your Eight Sleep confirmed the ${formatTime(next.time)} alarm was removed.`
            : `I asked your Eight Sleep to cancel the ${formatTime(next.time)} alarm, but couldn't confirm it was removed. Please check the app.`,
        ),
      );
    }

    // ── Toggle vibration on next alarm ─────────────────────────────────────────
    if (intentName === 'SetVibrationIntent') {
      const vibrationValue = getSlot(alexaReq, 'vibration');
      if (!vibrationValue) return json(ask('Should I set gradual or heavy vibration?', 'Gradual or heavy?'));

      const { alarms, nowMinutes } = await alarmsWithNow();
      const next = findNextAlarm(alarms, nowMinutes);
      if (!next) return json(speak("You don't have an upcoming alarm to update."));

      const pattern = parseVibrationPattern(vibrationValue);
      const updated = await updateAlarm(next, { vibration: { ...next.vibration, pattern } });

      const desc = pattern === 'INTENSE' ? 'heavy' : 'gradual';
      return json(
        speak(
          updated?.vibration.pattern === pattern
            ? `Your Eight Sleep confirmed ${desc} vibration for the ${formatTime(next.time)} alarm.`
            : `I asked your Eight Sleep to change the vibration, but couldn't confirm the update. Please check the app.`,
        ),
      );
    }

    // ── Set vibration strength on next alarm ──────────────────────────────────
    if (intentName === 'SetStrengthIntent') {
      const strengthValue = getSlot(alexaReq, 'strength');
      if (!strengthValue)
        return json(ask('Should the strength be low, medium, or high?', 'Low, medium, or high?'));

      const { alarms, nowMinutes } = await alarmsWithNow();
      const next = findNextAlarm(alarms, nowMinutes);
      if (!next) return json(speak("You don't have an upcoming alarm to update."));

      const powerLevel = parseStrength(strengthValue);
      const updated = await updateAlarm(next, { vibration: { ...next.vibration, powerLevel } });

      const desc = powerLevel === 20 ? 'low' : powerLevel === 100 ? 'high' : 'medium';
      return json(
        speak(
          updated?.vibration.powerLevel === powerLevel
            ? `Your Eight Sleep confirmed ${desc} vibration strength for the ${formatTime(next.time)} alarm.`
            : `I asked your Eight Sleep to change the strength, but couldn't confirm the update. Please check the app.`,
        ),
      );
    }

    // ── Set wake temperature on next alarm ────────────────────────────────────
    if (intentName === 'SetTemperatureAlarmIntent') {
      const tempDirectionValue = getSlot(alexaReq, 'tempDirection');
      const tempLevelValue = getSlot(alexaReq, 'tempLevel');
      if (!tempLevelValue)
        return json(
          ask(
            'What temperature level, from cooling ten to warming ten?',
            'Say something like warming three or cooling five.',
          ),
        );

      const tempLevel = parseTempLevel(tempDirectionValue, tempLevelValue);
      if (tempLevel === null)
        return json(speak("Sorry, I couldn't understand that temperature level."));

      const { alarms, nowMinutes } = await alarmsWithNow();
      const next = findNextAlarm(alarms, nowMinutes);
      if (!next) return json(speak("You don't have an upcoming alarm to update."));

      const updated = await updateAlarm(next, { thermal: { enabled: true, level: tempLevel } });

      return json(
        speak(
          updated?.thermal.enabled && updated.thermal.level === tempLevel
            ? `Your Eight Sleep confirmed the ${formatTime(next.time)} alarm will wake you with ${formatTempLevel(tempLevel)}.`
            : `I asked your Eight Sleep to change the wake temperature, but couldn't confirm the update. Please check the app.`,
        ),
      );
    }

    // ── Toggle thermal on next alarm ───────────────────────────────────────────
    if (intentName === 'SetThermalAlarmIntent') {
      const thermalValue = getSlot(alexaReq, 'thermal');
      const { alarms, nowMinutes } = await alarmsWithNow();
      const next = findNextAlarm(alarms, nowMinutes);
      if (!next) return json(speak("You don't have an upcoming alarm to update."));

      let thermalEnabled = true;
      if (thermalValue?.toLowerCase().includes('off') || thermalValue?.toLowerCase().includes('no')) {
        thermalEnabled = false;
      }

      const updated = await updateAlarm(next, {
        thermal: { ...next.thermal, enabled: thermalEnabled },
      });

      if (updated?.thermal.enabled !== thermalEnabled) {
        return json(
          speak(
            'I asked your Eight Sleep to change thermal wake, but couldn\'t confirm the update. Please check the app.',
          ),
        );
      }
      return json(
        speak(
          thermalEnabled
            ? `Your Eight Sleep confirmed thermal wake is on for the ${formatTime(next.time)} alarm.`
            : `Your Eight Sleep confirmed thermal wake is off for the ${formatTime(next.time)} alarm.`,
        ),
      );
    }

    // ── Toggle smart wake on next alarm ────────────────────────────────────────
    if (intentName === 'SetSmartWakeIntent') {
      const smartValue = getSlot(alexaReq, 'smart');
      const { alarms, nowMinutes } = await alarmsWithNow();
      const next = findNextAlarm(alarms, nowMinutes);
      if (!next) return json(speak("You don't have an upcoming alarm to update."));

      const enabled =
        !smartValue ||
        !(smartValue.toLowerCase().includes('off') || smartValue.toLowerCase().includes('no'));

      const updated = await updateAlarm(next, {
        smart: { ...next.smart, lightSleepEnabled: enabled },
      });

      if (updated?.smart.lightSleepEnabled !== enabled) {
        return json(
          speak(
            'I asked your Eight Sleep to change smart wake, but couldn\'t confirm the update. Please check the app.',
          ),
        );
      }
      return json(
        speak(
          enabled
            ? `Your Eight Sleep confirmed smart wake is on. It will wake you during light sleep before ${formatTime(next.time)}.`
            : `Your Eight Sleep confirmed smart wake is off for the ${formatTime(next.time)} alarm.`,
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
