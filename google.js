require('dotenv').config();
const { google } = require('googleapis');
const keytar = require('keytar');
const os = require('os');
const express = require('express');
const SERVICE = 'shifted-google-calendar';
const ACCOUNT = os.userInfo().username;

let oauth2Client;
let redirectUri;
let getPort;

async function getAvailablePort() {
  if (!getPort) {
    getPort = (await import('get-port')).default;
  }
  return getPort();
}

async function getStoredTokens() {
  try {
    const tokens = await keytar.getPassword(SERVICE, ACCOUNT);
    if (tokens) {
      console.log('[google] Loaded tokens from keytar');
      return JSON.parse(tokens);
    }
    else {
      console.log('[google] No tokens found in keytar');
      return null;
    }
  }
  catch (err) {
    console.error('[google] Error loading tokens:', err);
    return null;
  }
}

async function storeTokens(tokens) {
  try {
    if(!tokens || typeof tokens !== 'object') {
      throw new Error('Invalid tokens object');
    }
    
    if (!tokens.expiry_date && tokens.expires_in) {
      tokens.expiry_date = Date.now() + (tokens.expires_in * 1000);
    }
    
    await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(tokens));
    console.log('[google] Tokens stored in keytar');
  }
  catch (err) {
    console.error('[google] Error storing tokens:', err);
    throw err;
  }
}

async function ensureAuth(win) {
  try {
    let tokens = await getStoredTokens();
    if (!tokens || !tokens.access_token) {
      console.error('[google] No valid access token');
      throw new Error('auth required');
    }
    
    if (!oauth2Client) {
      const redirect = redirectUri || 'http://localhost:51739/oauth2callback';
      oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirect
      );
    }
    
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      console.log('[google] Token expired, refreshing...');
      try {
        const { credentials } = await oauth2Client.refreshToken(tokens.refresh_token);
        tokens = credentials;
        await storeTokens(tokens);
        console.log('[google] Token refreshed successfully');
      }
      catch (err) {
        console.error('[google] Failed to refresh token:', err);
        throw new Error('auth required');
      }
    }
    
    oauth2Client.setCredentials(tokens);
    oauth2Client.apiKey = process.env.GOOGLE_API_KEY;
    
    return oauth2Client;
  }
  catch(err){
    console.error('[google] Error in ensureAuth:', err);
    throw err;
  }
}

async function getAuthUrl() {
  try {
    const port = await getAvailablePort();
    redirectUri = `http://localhost:${port}/oauth2callback`;
    oauth2Client = null;
    
    oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
    
    oauth2Client.apiKey = process.env.GOOGLE_API_KEY;
    
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
      ]
    });
    
    const app = express();

    return new Promise((resolve) => {
      const server = app.listen(port);
      app.get('/oauth2callback', async (req, res) => {
        const code = req.query.code;
        if (code) {
          try {
            await handleOAuthCallback(code);
            res.send('<h2>Authentication successful! You may close this window and return to Shifted.</h2>');
          }
          catch (err) {
            res.send('<h2>Authentication failed: ' + err.message + '</h2>');
          }
        }
        else {
          res.send('<h2>No code received.</h2>');
        }
        server.close();
      });
      resolve(url);
    });
  }
  catch (err) {
    console.error('[google] Error generating auth URL:', err);
    throw err;
  }
}

async function handleOAuthCallback(code) {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('[google] Received new tokens:', tokens ? 'Yes' : 'No');
    
    if(!tokens || !tokens.access_token) {
      throw new Error('Invalid token response');
    }
    
    if(!tokens.expiry_date) {
      tokens.expiry_date = Date.now() + (tokens.expires_in || 3600) * 1000;
    }
    
    await storeTokens(tokens);
    oauth2Client.setCredentials(tokens);
    return tokens;
  }
  catch (err) {
    console.error('[google] Error getting tokens:', err);
    throw err;
  }
}

async function createEvent(parsed) {
  try {
    const auth = await ensureAuth(); 
    const calendar = google.calendar({ 
      version: 'v3', 
      auth: auth,
      key: process.env.GOOGLE_API_KEY
    });
    
    if (!parsed.start || !parsed.end) {
      console.error('[google] Missing start or end time in parsed event:', parsed);
      throw new Error('Event parsing failed: missing start or end time.');
    }
    
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    
    const event = {
      summary: parsed.title,
      start: { dateTime: parsed.start, timeZone: tz },
      end: { dateTime: parsed.end, timeZone: tz },
      location: parsed.location,
      description: parsed.description
    };
    
    if (parsed.recurrence && Array.isArray(parsed.recurrence)) {
      event.recurrence = parsed.recurrence;
    }
    
    console.log('[google] Creating event:', event);
    
    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event
    });
    
    console.log('[google] Google Calendar API response:', res.data);
    return res.data;
  }
  catch (err) {
    if (err.response && err.response.data) {
      console.error('[google] Google Calendar API error:', err.response.data);
      throw new Error('Google Calendar API error: ' + JSON.stringify(err.response.data));
    }
    else {
      console.error('[google] Google Calendar API error:', err);
      throw err;
    }
  }
}

async function deleteEvent(eventId) {
  try {
    const auth = await ensureAuth();
    const calendar = google.calendar({ 
      version: 'v3', 
      auth: auth,
      key: process.env.GOOGLE_API_KEY
    });
    
    await calendar.events.delete({ calendarId: 'primary', eventId });
    console.log('[google] Deleted event:', eventId);
    return true;
  }
  catch (err) {
    if (err.response && err.response.data) {
      console.error('[google] Google Calendar API error:', err.response.data);
      throw new Error('Google Calendar API error: ' + JSON.stringify(err.response.data));
    }
    else {
      console.error('[google] Google Calendar API error:', err);
      throw err;
    }
  }
}

async function validateAndRefreshAuth() {
  try {
    const tokens = await getStoredTokens();
    if (!tokens || !tokens.refresh_token) {
      console.log('[google] No valid tokens found, need to re-authenticate');
      return false;
    }
    
    if (!oauth2Client) {
      oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri || 'http://localhost:51739/oauth2callback'
      );
      
      oauth2Client.apiKey = process.env.GOOGLE_API_KEY;
    }
    
    oauth2Client.setCredentials(tokens);
    
    if (tokens.expiry_date && tokens.expiry_date < (Date.now() + 60000)) {
      console.log('[google] Token expired or expiring soon, refreshing...');
      try {
        const { credentials } = await oauth2Client.refreshToken(tokens.refresh_token);
        await storeTokens(credentials);
        oauth2Client.setCredentials(credentials);
        console.log('[google] Token refreshed successfully');
      }
      catch (err) {
        console.error('[google] Failed to refresh token:', err);
        return false;
      }
    }
    
    try {
      const calendar = google.calendar({ 
        version: 'v3', 
        auth: oauth2Client,
        key: process.env.GOOGLE_API_KEY
      });
      
      const now = new Date();
      const res = await calendar.calendarList.list();
      console.log('[google] API test successful, found', res.data.items.length, 'calendars');

      return true;
    }
    catch (err) {
      console.error('[google] API test failed:', err);
      return false;
    }
  }
  catch (err) {
    console.error('[google] Error validating auth:', err);
    return false;
  }
}

module.exports = { 
  ensureAuth, 
  getAuthUrl, 
  handleOAuthCallback, 
  createEvent, 
  deleteEvent, 
  getStoredTokens, 
  validateAndRefreshAuth,
  oauth2Client 
};