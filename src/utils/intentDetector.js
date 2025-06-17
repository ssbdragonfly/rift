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
    - EMAIL_VIEW: If the user wants to view a specific email (e.g., "show me the Wall Street Journal email", "open the email from Amazon", "show me emails about meeting", "open email #2")
    - EMAIL_QUERY: If the user wants to check, view, or list emails in general (e.g., "do I have any unread emails")
    - CALENDAR_CREATE: If the user wants to create or add a calendar event
    - CALENDAR_QUERY: If the user wants to check or view calendar events
    - CALENDAR_MODIFY: If the user wants to modify, update, or change a calendar event
    - CALENDAR_DELETE: If the user wants to delete or remove a calendar event
    - CHAT: If the request doesn't fit any of the above categories
    
    Be smart about detecting EMAIL_VIEW intents. If the user mentions a specific email source (like "Wall Street Journal", "Amazon", "helpbnk") or topic, or uses a number reference, classify it as EMAIL_VIEW, not EMAIL_QUERY.
    
    Respond with ONLY the category name, nothing else.
    Do not include any other text in your response.
    Example:
    Prompt: "Show me the Wall Street Journal email"
    Response: EMAIL_VIEW
    `;

    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }]
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
  
  if (/\b(draft|write|compose|create|send)\s+(email|mail|message)\b/i.test(prompt) || /\b(email|mail|message)\s+(to|for)\b/i.test(prompt) ||/\b(email|mail|message)\s+([a-z]+)\b/i.test(prompt)) {
    return 'EMAIL_DRAFT';
  }
  
  if (/\b(email|emails|mail|inbox|unread|message|messages)\b/i.test(prompt) && /\b(show|list|get|check|view|read|any|new|unread|recent)\b/i.test(prompt)) {
    return 'EMAIL_QUERY';
  }
  
  if (/\b(delete|remove|cancel)\b/i.test(prompt) &&  /\b(event|meeting|appointment|calendar)\b/i.test(prompt)) {
    return 'CALENDAR_DELETE';
  }
  
  if (/\b(change|modify|update|edit|rename|reschedule|add|invite)\b/i.test(prompt) &&  /\b(event|meeting|appointment|calendar)\b/i.test(prompt)) {
    return 'CALENDAR_MODIFY';
  }
  
  if (/\b(what|when|show|list|do i have|upcoming|next|today|tomorrow|this|week|month|schedule|events?|calendar|meetings?|appointments?|on my calendar|my schedule)\b/i.test(prompt) &&  !/\b(add|create|schedule|set up|make|new)\b/i.test(prompt.substring(0, 20))) {
    return 'CALENDAR_QUERY';
  }
  
  if (/\b(add|create|schedule|set up|make|new)\b/i.test(prompt) && 
      /\b(event|meeting|appointment|calendar)\b/i.test(prompt)) {
    return 'CALENDAR_CREATE';
  }
  
  return 'CHAT';
}

module.exports = { detectIntent };