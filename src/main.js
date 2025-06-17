const { app, BrowserWindow, globalShortcut, ipcMain, shell } = require('electron');
const path = require('path');
const isDev = !app.isPackaged;
const { createEvent, ensureAuth, getAuthUrl, handleOAuthCallback, deleteEvent } = require('./calendar/google');
const { parseEvent } = require('./calendar/parser');
const { google } = require('googleapis');
const emailFunctions = require('./email/email');
const emailHandlers = require('./email/email-handlers');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 300,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'utils/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win.loadFile(path.join(__dirname, 'ui/index.html'));
  win.hide();
}

app.whenReady().then(async () => {
  createWindow();
  
  try {
    console.log('[main] Checking Google API key:', process.env.GOOGLE_API_KEY ? 'Present' : 'Missing');
    
    const { validateAndRefreshAuth, getAuthUrl } = require('./calendar/google');
    const isValid = await validateAndRefreshAuth();
    if (!isValid) {
      console.log('[main] Auth validation failed, will prompt for re-auth when needed');
      try {
        const { clearTokensAndAuth } = require('./utils/authHelper');
        await clearTokensAndAuth('shifted-google-calendar', shell);
        console.log('[main] Cleared stored credentials and triggered re-auth');
      } catch (e) {
        console.error('[main] Failed to clear credentials:', e);
      }
    }
    else {
      console.log('[main] Auth validation successful');
    }
    
    try {
      const { validateEmailAuth, getEmailAuthUrl } = require('./email/email');
      const isEmailValid = await validateEmailAuth();
      if (!isEmailValid) {
        console.log('[main] Email auth validation failed, will prompt for re-auth when needed');
        const { clearTokensAndAuth } = require('./utils/authHelper');
        await clearTokensAndAuth('shifted-google-email', shell);
      }
    } catch (e) {
      console.error('[main] Error checking email auth:', e);
    }
  }
  catch (err) {
    console.error('[main] Error validating auth on startup:', err);
  }
  
  setupEmailHandlers();
  
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (win.isVisible()) {
      win.hide();
    } else {
      win.center();
      win.show();
      win.focus();
      win.webContents.send('focus-input');
    }
  });
});

app.on('window-all-closed', (e) => {
});

function isCalendarQuery(prompt) {
  return /\b(what|when|show|list|do i have|upcoming|next|today|tomorrow|this|week|month|schedule|events?|calendar|meetings?|appointments?|on my calendar|my schedule)\b/i.test(prompt) && 
         !/\b(add|create|schedule|set up|make|new)\b/i.test(prompt.substring(0, 20));
}

function isDeleteEvent(prompt) {
  return /\b(delete|remove|cancel)\b/i.test(prompt);
}

function isModifyEvent(prompt) {
  return /\b(change|modify|update|edit|rename|reschedule|add|invite)\b/i.test(prompt) && 
         /\b(event|meeting|appointment|calendar)\b/i.test(prompt);
}

function extractTitleForDelete(prompt) {
  const quotedMatch = prompt.match(/['"]([^'"]+)['"]/);
  if (quotedMatch){
    return quotedMatch[1].trim();
  }
  
  const m = prompt.match(/(?:delete|remove|cancel)\s+(.+?)(?:\s+from calendar|\s+from|\s+at|\s+on|$)/i);
  return m ? m[1].trim() : null;
}

function extractDateFromPrompt(prompt) {
  const m = prompt.match(/(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})/i);
  return m ? m[1].toLowerCase() : null;
}

async function queryCalendar(prompt) {
  try {
    const { ensureAuth } = require('./calendar/google');
    const auth = await ensureAuth(win);
    
    const calendar = google.calendar({ 
      version: 'v3', 
      auth: auth,
      key: process.env.GOOGLE_API_KEY
    });
    
    const now = new Date();
    let timeMin = now.toISOString();
    let timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const dateWord = extractDateFromPrompt(prompt);
    if (dateWord) {
      let target = new Date();
      if (dateWord === 'tomorrow') target.setDate(target.getDate() + 1);
      else if (dateWord === 'today') {}
      else if (/\d{4}-\d{2}-\d{2}/.test(dateWord)) target = new Date(dateWord);
      else {
        const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        const idx = days.indexOf(dateWord);
        if (idx !== -1) {
          const nowIdx = target.getDay();
          let diff = idx - nowIdx;
          if (diff <= 0) diff += 7;
          target.setDate(target.getDate() + diff);
        }
      }
      timeMin = new Date(target.setHours(0,0,0,0)).toISOString();
      timeMax = new Date(target.setHours(23,59,59,999)).toISOString();
    }
    
    console.log(`[main] Querying calendar from ${timeMin} to ${timeMax}`);
    
    const eventsRes = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 10
    });
    
    const events = eventsRes.data.items || [];
    if (events.length === 0) return 'No events found.';
    
    if (process.env.GEMINI_API_KEY && events.length > 0) {
      try {
        const axios = require('axios');
        const eventsText = events.map(ev => {
          const start = ev.start.dateTime || ev.start.date;
          const startDate = new Date(start);
          const timeStr = startDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
          const dateStr = startDate.toLocaleDateString(undefined, {weekday: 'long', month: 'short', day: 'numeric'});
          return `Event: ${ev.summary}, Date: ${dateStr}, Time: ${timeStr}, Location: ${ev.location || 'Not specified'}`;
        }).join('\n');
        
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
        const geminiPrompt = `
        Based on the user's query: "${prompt}"
        
        Format these calendar events in a clear, organized way:
        ${eventsText}
        
        Group by date if appropriate. Include all relevant details like time, date, and location.
        Be concise but informative. Format the response to be easily readable.
        `;
        
        const body = {
          contents: [{ parts: [{ text: geminiPrompt }] }],
          generationConfig: {
            temperature: 0.3,
            topP: 0.95,
            topK: 40
          }
        };
        
        const resp = await axios.post(url, body, { timeout: 5000 });
        const text = resp.data.candidates[0].content.parts[0].text.trim();
        return text;
      }
      catch (err) {
        console.error('[main] Error using Gemini for calendar formatting:', err);
      }
    }
    
    return events.map(ev => {
      const start = ev.start.dateTime || ev.start.date;
      const startDate = new Date(start);
      const timeStr = startDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      const dateStr = startDate.toLocaleDateString(undefined, {weekday: 'long', month: 'short', day: 'numeric'});
      return `${dateStr} at ${timeStr}: ${ev.summary}${ev.location ? ' ('+ev.location+')' : ''}`;
    }).join('\n');
  }
  catch (err) {
    console.error('[main] Error querying calendar:', err);
    if (err.message === 'auth required') {
      const { getAuthUrl } = require('./calendar/google');
      const authUrl = await getAuthUrl();
      shell.openExternal(authUrl);
      return 'Authentication required. Please check your browser to complete the sign-in process.';
    }

    return `Error: ${err.message}`;
  }
}

async function deleteEventByPrompt(prompt) {
  try {
    const { ensureAuth, deleteEvent } = require('./calendar/google');
    const { identifyEventToDelete } = require('./calendar/deleteHelper');
    const auth = await ensureAuth(win);
    const calendar = google.calendar({ 
      version: 'v3', 
      auth: auth,
      key: process.env.GOOGLE_API_KEY
    });
    
    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const eventsRes = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 10
    });
    
    const events = eventsRes.data.items || [];
    if (events.length === 0) throw new Error('No upcoming events found to delete.');
    
    console.log(`[main] Found ${events.length} upcoming events`);
    
    const geminiMatch = await identifyEventToDelete(prompt, events);
    
    if (geminiMatch) {
      console.log(`[main] Gemini identified event to delete: ${geminiMatch.summary}`);
      await deleteEvent(geminiMatch.id);
      return `Deleted event: ${geminiMatch.summary}`;
    }
    
    const title = extractTitleForDelete(prompt);
    if (!title) throw new Error('Could not determine which event to delete. Please specify the event name.');
    
    console.log(`[main] Searching for event to delete with title: "${title}"`);
    
    const match = events.find(ev => ev.summary && ev.summary.toLowerCase().includes(title.toLowerCase()));
    if (!match) throw new Error('No matching event found to delete.');
    
    await deleteEvent(match.id);
    return `Deleted event: ${match.summary}`;
  }
  catch (err) {
    console.error('[main] Error deleting event:', err);
    if (err.message === 'auth required') {
      const { getAuthUrl } = require('./calendar/google');
      const authUrl = await getAuthUrl();
      shell.openExternal(authUrl);
      return 'Authentication required. Please check your browser to complete the sign-in process.';
    }
    throw err;
  }
}

function setupEmailHandlers() {
  const emailViewer = require('./email/emailViewer');
  emailViewer.setupEmailViewerHandlers(emailFunctions);
  
  try {
    ipcMain.removeHandler('start-email-auth');
  } catch (e) {}
  
  ipcMain.handle('start-email-auth', async () => {
    try {
      const url = await emailFunctions.getEmailAuthUrl();
      shell.openExternal(url);
      return true;
    } catch (err) {
      console.error('[main] Error starting email auth:', err);
      return { success: false, error: err.message };
    }
  });

  try {
    ipcMain.removeHandler('email-oauth-callback');
  } catch (e) {}
  
  ipcMain.handle('email-oauth-callback', async (event, code) => {
    try {
      await emailFunctions.handleEmailOAuthCallback(code);
      return { success: true };
    }
    catch (err) {
      console.error('[main] Error in email OAuth callback:', err);
      return { success: false, error: err.message };
    }
  });

  try {
    ipcMain.removeHandler('get-unread-emails');
  } catch (e) {}
  
  ipcMain.handle('get-unread-emails', async () => {
    try {
      await emailFunctions.ensureEmailAuth(win);
      const result = await emailFunctions.getUnreadEmails();
      return result;
    }
    catch (err) {
      console.error('[main] Error getting unread emails:', err);
      if (err.message === 'auth required') {
        try {
          const url = await emailFunctions.getEmailAuthUrl();
          shell.openExternal(authUrl);
          return { error: 'Authentication required. Please check your browser to complete the sign-in process.' };
        } catch (authErr) {
          console.error('[main] Error getting email auth URL:', authErr);
          return { error: 'Failed to start authentication: ' + authErr.message };
        }
      }
      return { error: err.message };
    }
  });

  try {
    ipcMain.removeHandler('get-email-content');
  } catch (e) {}
  
  ipcMain.handle('get-email-content', async (event, messageId) => {
    try {
      await emailFunctions.ensureEmailAuth(win);
      const result = await emailFunctions.getEmailContent(messageId);
      return result;
    }
    catch (err) {
      console.error('[main] Error getting email content:', err);
      if (err.message === 'auth required') {
        try {
          const url = await emailFunctions.getEmailAuthUrl();
          shell.openExternal(authUrl);
          return { error: 'Authentication required. Please check your browser to complete the sign-in process.' };
        }
        catch (authErr) {
          console.error('[main] Error getting email auth URL:', authErr);
          return { error: 'Failed to start authentication: ' + authErr.message };
        }
      }
      return { error: err.message };
    }
  });

  try {
    ipcMain.removeHandler('save-draft');
  } catch (e) {}
  
  ipcMain.handle('save-draft', async (event, draft) => {
    emailHandlers.currentDraft = draft;
    return { success: true };
  });

  try {
    ipcMain.removeHandler('send-draft');
  } catch (e) {}
  
  ipcMain.handle('send-draft', async () => {
    try {
      if (!emailHandlers.currentDraft) {
        throw new Error('No draft email to send');
      }
      
      await emailFunctions.ensureEmailAuth(win);
      const result = await emailFunctions.sendEmail(emailHandlers.currentDraft);
      emailHandlers.currentDraft = null;
      return { success: true, result };
    }
    catch (err) {
      console.error('[main] Error sending email:', err);
      if (err.message === 'auth required') {
        try {
          const url = await emailFunctions.getEmailAuthUrl();
          shell.openExternal(authUrl);
          return { error: 'Authentication required. Please check your browser to complete the sign-in process.' };
        }
        catch (authErr) {
          console.error('[main] Error getting email auth URL:', authErr);
          return { error: 'Failed to start authentication: ' + authErr.message };
        }
      }
      return { error: err.message };
    }
  });

  try {
    ipcMain.removeHandler('store-history');
  } catch (e) {}
  
  ipcMain.handle('store-history', (event, prompt, response) => {
    emailHandlers.storePromptInHistory(prompt, response);
    return { success: true };
  });

  try {
    ipcMain.removeHandler('get-history');
  } catch (e) {}
  
  ipcMain.handle('get-history', () => {
    return emailHandlers.getPromptHistory();
  });
}

ipcMain.handle('route-prompt', async (event, prompt) => {
  try {
    const { ensureAuth, getAuthUrl, createEvent, validateAndRefreshAuth } = require('./calendar/google');
    const { detectIntent } = require('./utils/intentDetector');
    
    const intent = await detectIntent(prompt);
    console.log(`[main] Detected intent: ${intent} for prompt: "${prompt}"`);
    
    if (global.lastEmailSearchResults && /\b(open|view|show|read)\s+(email|mail|message)\s+#?(\d+)\b/i.test(prompt)) {
      const match = prompt.match(/\b(open|view|show|read)\s+(email|mail|message)\s+#?(\d+)\b/i);
      if (match) {
        const emailNumber = parseInt(match[3]);
        if (emailNumber > 0 && emailNumber <= global.lastEmailSearchResults.length) {
          const email = global.lastEmailSearchResults[emailNumber - 1];
          const emailContent = await emailFunctions.getEmailContent(email.id);
          
          let responseAnalysis = '';
          try {
            const analysis = await emailFunctions.analyzeEmailForResponse(emailContent);
            if (analysis) {
              emailContent.suggestedResponse = analysis;
            }
          } catch (err) {
            console.error('[main] Error analyzing email for response:', err);
          }
          
          const emailViewer = require('./email/emailViewer');
          emailViewer.showEmail(emailContent);
          
          global.lastEmailSearchResults = null;
          global.lastEmailSearchPrompt = null;
          
          const formattedEmail = `
Subject: ${emailContent.subject}
From: ${emailContent.from}
To: ${emailContent.to}
Date: ${emailContent.date}

Email opened in viewer window. You can reply directly from there.
${emailContent.suggestedResponse ? "\n\nSuggested response available in the viewer." : ""}
          `.trim();
          
          return { 
            type: 'email-view', 
            response: formattedEmail,
            followUpMode: true,
            followUpType: 'email-view'
          };
        }
      }
    }
    
    if (intent === 'EMAIL_VIEW') {
      const { handleEmailViewRequest } = require('./email/emailViewHandler');
      return await handleEmailViewRequest(prompt, emailFunctions, shell, win);
    }
    
    if (intent === 'EMAIL_QUERY') {
      return await emailHandlers.handleEmailQuery(prompt, emailFunctions, shell, win);
    }
    
    if (intent === 'EMAIL_DRAFT') {
      return await emailHandlers.handleEmailDraftRequest(prompt, emailFunctions, shell, win);
    }
    
    try {
      const isValid = await validateAndRefreshAuth();
      if (!isValid) {
        console.log('[main] Auth validation failed, requesting new authentication');
        const authUrl = await getAuthUrl();
        shell.openExternal(authUrl);
        return { type: 'error', error: 'Authentication required. Please check your browser to complete the sign-in process.' };
      }
      
      await ensureAuth(win);
    } catch (err) {
      if (err.message === 'auth required') {
        const authUrl = await getAuthUrl();
        shell.openExternal(authUrl);
        return { type: 'error', error: 'Authentication required. Please check your browser to complete the sign-in process.' };
      }
      console.error('[main] Auth error:', err);
      return { type: 'error', error: `Authentication error: ${err.message}` };
    }
    
    if (intent === 'CALENDAR_DELETE') {
      try {
        const response = await deleteEventByPrompt(prompt);
        return { type: 'delete', response };
      } catch (err) {
        console.error('[main] Delete event error:', err);
        return { type: 'error', error: `Failed to delete event: ${err.message}` };
      }
    }
    
    if (intent === 'CALENDAR_MODIFY') {
      try {
        const calendarModifier = require('./calendar/calendarModifier');
        const auth = await ensureAuth(win);
        const result = await calendarModifier.handleEventModification(prompt, auth);
        
        if (result.success) {
          return { 
            type: 'event-modified', 
            success: true, 
            result: result.event,
            changes: result.changes
          };
        } else {
          return { type: 'error', error: result.error };
        }
      } catch (err) {
        console.error('[main] Event modification error:', err);
        return { type: 'error', error: `Failed to modify event: ${err.message}` };
      }
    }
    
    if (intent === 'CALENDAR_QUERY') {
      try {
        const response = await queryCalendar(prompt);
        return { type: 'query', response };
      } catch (err) {
        console.error('[main] Calendar query error:', err);
        return { type: 'error', error: `Failed to query calendar: ${err.message}` };
      }
    }
    
    if (intent === 'CALENDAR_CREATE') {
      try {
        const parsed = await parseEvent(prompt);
        if (typeof parsed === 'string') {
          return { type: 'chat', response: parsed };
        }
        
        if (!parsed.start || !parsed.end) {
          return { 
            type: 'chat', 
            response: `I understood you want to create an event titled "${parsed.title}", but I need more information about the date and time.` 
          };
        }
        
        const result = await createEvent(parsed);
        return { type: 'event', success: true, result };
      } catch (err) {
        console.error('[main] Error in event creation:', err);
        if (err.message && err.message.includes('auth')) {
          return { type: 'error', error: 'Authentication issue: ' + err.message };
        }
        return { type: 'chat', response: 'I understood your request but encountered an issue: ' + err.message };
      }
    }
    
    return { type: 'chat', response: 'I\'m not sure how to help with that. You can ask me about your calendar events, emails, or create new events and emails.' };
  } catch (err) {
    console.error('[main] Unhandled error in route-prompt:', err);
    return { type: 'error', error: err.message };
  }
});

ipcMain.handle('parse-and-create-event', async (event, input) => {
  try {
    const parsed = await parseEvent(input);
    await ensureAuth(win);
    const result = await createEvent(parsed);
    console.log('[main] Event created successfully:', result);
    return { success: true, result };
  } catch (err) {
    console.error('[main] Error in parse-and-create-event:', err);
    if (err.message === 'auth required') {
      const authUrl = await getAuthUrl();
      shell.openExternal(authUrl);
      return { success: false, error: 'Authentication required. Please check your browser.' };
    }
    return { success: false, error: err.message };
  }
});

ipcMain.handle('start-auth', async () => {
  const url = await getAuthUrl();
  shell.openExternal(url);
  return true;
});

ipcMain.handle('oauth-callback', async (event, code) => {
  try {
    await handleOAuthCallback(code);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.on('hide-window', () => {
  if (win && !win.isDestroyed()) {
    win.hide();
  }
});

ipcMain.on('resize-window', (event, { width, height }) => {
  if (win && !win.isDestroyed()) {
    win.setSize(width, height);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});