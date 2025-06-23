const axios = require('axios');

async function detectIntent(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return detectIntentWithRegex(prompt);
  }

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Analyze this user request and determine what action should be taken:
    "${prompt}"
    
    Respond with ONLY ONE of these categories:
    - EMAIL_DRAFT: If the user wants to create, compose, or send an email
    - EMAIL_VIEW: If the user wants to view a specific email (e.g., "show me the Wall Street Journal email", "open the email from Amazon")
    - EMAIL_QUERY: If the user wants to check, view, or list emails in general (e.g., "do I have any unread emails")
    - CALENDAR_CREATE: If the user wants to create or add a calendar event
    - CALENDAR_QUERY: If the user wants to check or view calendar events
    - CALENDAR_MODIFY: If the user wants to modify, update, or change a calendar event
    - CALENDAR_DELETE: If the user wants to delete or remove a calendar event
    - DRIVE_SEARCH: If the user wants to search for files in Google Drive
    - DRIVE_OPEN: If the user wants to open or view a specific file from Google Drive
    - DRIVE_SHARE: If the user wants to share a file from Google Drive
    - DOCS_CREATE: If the user wants to create a new Google Doc
    - DOCS_SEARCH: If the user wants to search for Google Docs
    - DOCS_OPEN: If the user wants to open or view a specific Google Doc
    - DOCS_SHARE: If the user wants to share a Google Doc
    - DOCS_UPDATE: If the user wants to update or add content to a Google Doc
    - MEET_CREATE: If the user wants to create a Google Meet
    - MEET_SHARE: If the user wants to share a Google Meet link
    - SPOTIFY_PLAY: If the user wants to play music, a song, an artist, or an album on Spotify
    - SPOTIFY_SEARCH: If the user wants to search for music, songs, artists, or albums on Spotify
    - SPOTIFY_CONTROL: If the user wants to control Spotify playback (pause, resume, next, previous, etc.)
    - SPOTIFY_PLAYLIST: If the user wants to create, modify, or play a Spotify playlist
    - CHAT: If the request doesn't fit any of the above categories
    
    Be smart about understanding the user's intent. For example:
    - "Search for notes in my Google Docs" should be DOCS_SEARCH, not searching for the literal term "notes"
    - "Create a Google Meet and email it to john@example.com" should be recognized as a complex workflow
    - "Play some jazz music" should be SPOTIFY_PLAY, recognizing the music-related intent
    
    Respond with ONLY the category name, nothing else.
    `;

    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: {
        temperature: 0.0,
        topP: 1.0,
        topK: 1
      }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim();
    
    console.log('[intentDetector] Gemini detected intent:', text);
    return text;
  }
  catch (err) {
    console.error('[intentDetector] Error detecting intent with Gemini:', err);
    return detectIntentWithRegex(prompt);
  }
}

function detectIntentWithRegex(prompt) {
  const lowerPrompt = prompt.toLowerCase();
  
  if (/\b(draft|write|compose|create|send)\s+(email|mail|message)\b/i.test(prompt) || /\b(email|mail|message)\s+(to|for)\b/i.test(prompt)) {
    return 'EMAIL_DRAFT';
  }
  
  if (/\b(email|emails|mail|inbox|unread|message|messages)\b/i.test(prompt) && /\b(show|list|get|check|view|read|any|new|unread|recent)\b/i.test(prompt)) {
    return 'EMAIL_QUERY';
  }
  
  if (/\b(delete|remove|cancel)\b/i.test(prompt) && /\b(event|meeting|appointment|calendar)\b/i.test(prompt)) {
    return 'CALENDAR_DELETE';
  }
  
  if (/\b(change|modify|update|edit|rename|reschedule|add|invite)\b/i.test(prompt) && /\b(event|meeting|appointment|calendar)\b/i.test(prompt)) {
    return 'CALENDAR_MODIFY';
  }
  
  if (/\b(what|when|show|list|do i have|upcoming|next|today|tomorrow|this|week|month|schedule|events?|calendar|meetings?|appointments?)\b/i.test(prompt)) {
    return 'CALENDAR_QUERY';
  }
  
  if (/\b(add|create|schedule|set up|make|new)\b/i.test(prompt) && /\b(event|meeting|appointment|calendar)\b/i.test(prompt)) {
    return 'CALENDAR_CREATE';
  }
  
  if (/\b(search|find|look\s+for)\b/i.test(prompt) && /\b(drive|files?|documents?)\b/i.test(prompt)) {
    return 'DRIVE_SEARCH';
  }
  
  if (/\b(search|find|look\s+for)\b/i.test(prompt) && /\b(google\s+docs?|documents?|notes?)\b/i.test(prompt)) {
    return 'DOCS_SEARCH';
  }
  
  if (/\b(create|make|new)\b/i.test(prompt) && /\b(google\s+meet|video\s+call|video\s+conference|video\s+meeting)\b/i.test(prompt)) {
    return 'MEET_CREATE';
  }
  
  if (/\b(play|start|listen\s+to)\b/i.test(prompt) && /\b(music|song|track|artist|album|spotify)\b/i.test(prompt)) {
    return 'SPOTIFY_PLAY';
  }
  
  if (/\b(search|find|look\s+for)\b/i.test(prompt) && /\b(music|song|track|artist|album|spotify)\b/i.test(prompt)) {
    return 'SPOTIFY_SEARCH';
  }
  
  if (/\b(pause|stop|resume|next|previous|skip|volume|shuffle|repeat)\b/i.test(prompt) && /\b(music|song|track|spotify)\b/i.test(prompt)) {
    return 'SPOTIFY_CONTROL';
  }
  
  if (/\b(playlist|create\s+playlist|add\s+to\s+playlist)\b/i.test(prompt) && /\b(music|song|track|spotify)\b/i.test(prompt)) {
    return 'SPOTIFY_PLAYLIST';
  }
  
  if (/\b(music|song|track|artist|album)\b/i.test(prompt) && (/\b(play|start|listen\s+to|search|find|look\s+for)\b/i.test(prompt))) {
    return 'SPOTIFY_PLAY';
  }
  
  return 'CHAT';
}

module.exports = { detectIntent };