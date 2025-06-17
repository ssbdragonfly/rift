require('dotenv').config();
const axios = require('axios');

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
const offsetMinutes = new Date().getTimezoneOffset();
const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
const offsetMins = Math.abs(offsetMinutes) % 60;
const offsetSign = offsetMinutes > 0 ? '-' : '+';
const offsetString = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;

async function parseEvent(input) {
  console.log('[parser] Input:', input);
  if (process.env.GEMINI_API_KEY) {
    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const currentDay = now.getDate();
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
      const prompt = `
You are an assistant that extracts Google Calendar event details from natural language.
Always output a JSON object with these keys: title, start, end, location, description, recurrence.
- "title" must always be professionally formatted: use proper capitalization (title case), no all-lowercase, and ensure it reads like a professional calendar event title.
- "start" and "end" must be in RFC3339 format (e.g. "2024-06-14T15:00:00-07:00").
- "recurrence" should be an array of RRULE strings (e.g. ["RRULE:FREQ=DAILY"], ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]) or null if not recurring.
- If the input is ambiguous, do your best to infer the most likely date/time and recurrence.
- If a field is missing, output null for that field.
- If the end time is not specified, infer it as 1 hour after the start time.
- The current date and time is: ${nowIso}
- The current year is: ${currentYear}
- The current month is: ${currentMonth}
- The current day is: ${currentDay}
- If the year is not specified in the input, always use the current year (${currentYear}).
- If the month or day is not specified, infer them based on the current date (${nowIso}).
- The user's timezone is: ${tz} (UTC${offsetString})
- All times should be interpreted and output in this timezone.
- If the input does not specify a timezone, assume ${tz} (UTC${offsetString}).

Example 1:
Input: "meeting with Sarah every Monday at 9am"
Output:
{
  "title": "Meeting with Sarah",
  "start": "2024-06-17T09:00:00-07:00",
  "end": "2024-06-17T10:00:00-07:00",
  "location": null,
  "description": null,
  "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=MO"]
}

Example 2:
Input: "daily standup at 10am"
Output:
{
  "title": "Daily Standup",
  "start": "2024-06-14T10:00:00-07:00",
  "end": "2024-06-14T11:00:00-07:00",
  "location": null,
  "description": null,
  "recurrence": ["RRULE:FREQ=DAILY"]
}

Example 3:
Input: "doctor appointment with Dr. Kim next Thursday 2–3pm in Palo Alto"
Output:
{
  "title": "Doctor Appointment with Dr. Kim",
  "start": "2024-06-20T14:00:00-07:00",
  "end": "2024-06-20T15:00:00-07:00",
  "location": "Palo Alto",
  "description": null,
  "recurrence": null
}

Now, extract the event from this input:
"${input}"

Output:
`;
      const body = {
        contents: [{ parts: [{ text: prompt }] }]
      };
      console.log('[parser] Sending request to Gemini API...');
      const resp = await axios.post(url, body, { timeout: 10000 });
      console.log('[parser] Gemini API response:', resp.data);
      try {
        const text = resp.data.candidates[0].content.parts[0].text;
        const json = text.match(/\{[\s\S]*\}/)[0];
        const parsed = JSON.parse(json);

        parsed.start = parsed.start || parsed.start_datetime || null;
        parsed.end = parsed.end || parsed.end_datetime || null;

        if(!parsed.end && parsed.start){
          try {
            const startDate = new Date(parsed.start);
            if(!isNaN(startDate.getTime())){
              const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

              parsed.end = endDate.toISOString();
              console.log('[parser] Inferred end time as 1 hour after start:', parsed.end);
            }
          }
          catch (e) {
            console.warn('[parser] Could not infer end time:', e);
          }
        }
        parsed.title = toTitleCase(parsed.title);

        if(typeof parsed.recurrence === 'undefined'){
          parsed.recurrence = null;
        }
        console.log('[parser] Gemini parsed:', parsed);

        return parsed;
      }
      catch (e){
        console.error('[parser] Gemini response error (parsing):', resp.data);
        throw new Error('Could not parse event from Gemini response.');
      }
    }
    catch(err){
      console.error('[parser] Gemini API error:', err);
      throw err;
    }
  }

  else{
    console.log('[parser] Using regex fallback');
    const isCalendarEvent = /\b(meeting|appointment|call|event|schedule|reminder|standup|lunch|dinner|breakfast)\b/i.test(input) ||/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(input) ||/\b(at|on|from)\s+\d/i.test(input) ||/\d+(am|pm)/i.test(input) ||/\d{1,2}:\d{2}/i.test(input);
    
    if (!isCalendarEvent) {
      console.log('[parser] Input doesn\'t appear to be a calendar event, treating as chat');
      return `I'm not sure how to create an event from that. Could you provide more details like date and time?`;
    }
    
    const m = input.match(/^(.*?)\s+(on|at|from)?\s*([\w\d:apm\-\s]+)?( in ([\w\s]+))?$/i);
    const parsed = {
      title: m ? m[1] : input,
      start: null,
      end: null,
      location: m && m[5] ? m[5] : null,
      description: null,
      recurrence: null
    };
    parsed.title = toTitleCase(parsed.title);
    console.log('[parser] Regex fallback parsed:', parsed);

    return parsed;
  }
}

function toTitleCase(str) {
  if (!str){
    return str;
  }
  const smallWords = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'with'];
  return str.toLowerCase().replace(/\b\w+/g, function(word, index, full) {
      if((index === 0) || (index + word.length === full.length) || smallWords.indexOf(word) === -1) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      else {
        return word;
      }
    }).replace(/\s+/g, ' ').trim();
}

module.exports = { parseEvent }; 