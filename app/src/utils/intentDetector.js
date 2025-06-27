const axios = require('axios');

function detectIntentFallback(prompt) {
  const lowerPrompt = prompt.toLowerCase();
  
  // Music/Spotify detection
  if (/\b(play|music|song|artist|album|spotify)\b/i.test(prompt)) {
    if (/\b(pause|stop|resume|next|previous|skip)\b/i.test(prompt)) {
      return 'SPOTIFY_CONTROL';
    }
    if (/\b(playlist)\b/i.test(prompt)) {
      return 'SPOTIFY_PLAYLIST';
    }
    return 'SPOTIFY_PLAY';
  }
  
  // Email detection
  if (/\b(email|mail|message)\b/i.test(prompt)) {
    if (/\b(draft|write|compose|create|send)\b/i.test(prompt)) {
      return 'EMAIL_DRAFT';
    }
    if (/\b(check|view|read|show|list)\b/i.test(prompt)) {
      return 'EMAIL_QUERY';
    }
  }
  
  // Calendar detection
  if (/\b(calendar|event|meeting|appointment)\b/i.test(prompt)) {
    if (/\b(create|add|schedule|make|new)\b/i.test(prompt)) {
      return 'CALENDAR_CREATE';
    }
    if (/\b(show|list|what|when|check)\b/i.test(prompt)) {
      return 'CALENDAR_QUERY';
    }
  }
  
  // Google Meet detection
  if (/\b(meet|video call|video conference)\b/i.test(prompt)) {
    return 'MEET_CREATE';
  }
  
  return 'CHAT';
}

async function detectIntent(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[intentDetector] No Gemini API key, using fallback detection');
    return detectIntentFallback(prompt);
  }

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Analyze this user request and determine what action should be taken:
    "${prompt}"
    
    Respond with ONLY ONE of these categories:
    - EMAIL_DRAFT: If the user wants to create, compose, or send an email
    - EMAIL_VIEW: If the user wants to view a specific email
    - EMAIL_QUERY: If the user wants to check, view, or list emails (including specific counts like "last 20 emails")
    - EMAIL_EDIT: If the user wants to edit, modify, or change an existing email draft
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
    - MEET_CREATE: If the user wants to create a Google Meet (including vague requests like "make a meeting")
    - MEET_SHARE: If the user wants to share a Google Meet link
    - SPOTIFY_PLAY: If the user wants to play music, songs, artists, albums, or any audio content
    - SPOTIFY_SEARCH: If the user wants to search for music, songs, artists, or albums
    - SPOTIFY_CONTROL: If the user wants to control Spotify playback (pause, resume, next, previous, etc.)
    - SPOTIFY_PLAYLIST: If the user wants to create, modify, or play a Spotify playlist
    - CHAT: If the request doesn't fit any of the above categories
    
    IMPORTANT: Be very liberal with music/Spotify detection. Any mention of playing songs, music, artists should be SPOTIFY_PLAY.
    Any mention of creating meetings, video calls, or Google Meet should be MEET_CREATE.
    
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
    
    const resp = await axios.post(url, body, { timeout: 5000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim();
    
    console.log('[intentDetector] Gemini detected intent:', text);
    return text;
  }
  catch (err) {
    console.error('[intentDetector] Error detecting intent with Gemini:', err);
    if (err.response?.status === 429) {
      console.log('[intentDetector] Rate limited, using fallback');
    }
    return detectIntentFallback(prompt);
  }
}



module.exports = {
  detectIntent,
  detectIntentFallback
};