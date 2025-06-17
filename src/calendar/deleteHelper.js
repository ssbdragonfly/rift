const axios = require('axios');

async function identifyEventToDelete(prompt, events) {
  if (!process.env.GEMINI_API_KEY || !events || events.length === 0) {
    return null;
  }

  try {
    const eventsText = events.map((event, i) => {
      const start = event.start.dateTime || event.start.date;
      const startDate = new Date(start);
      const timeStr = startDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      const dateStr = startDate.toLocaleDateString();
      return `Event ${i+1}: "${event.summary}" on ${dateStr} at ${timeStr}`;
    }).join('\n');

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Based on the user's request: "${prompt}"
    
    Which of these events should be deleted?
    ${eventsText}
    
    Respond with ONLY the number of the event to delete (e.g., "1" or "2"). If none match, respond with "none".
    `;

    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }]
    };
    
    const resp = await axios.post(url, body, { timeout: 5000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim();
    const match = text.match(/\b(\d+)\b/);
    if (match) {
      const eventIndex = parseInt(match[1]) - 1;
      if (eventIndex >= 0 && eventIndex < events.length) {
        return events[eventIndex];
      }
    }
    
    return null;
  }
  catch (err) {
    console.error('[deleteHelper] Error identifying event to delete:', err);
    return null;
  }
}

module.exports = { identifyEventToDelete };