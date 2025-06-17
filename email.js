require('dotenv').config();
const { google } = require('googleapis');
const keytar = require('keytar');
const os = require('os');
const express = require('express');
const axios = require('axios');
const { shell } = require('electron');

const SERVICE = 'shifted-google-email';
const ACCOUNT = os.userInfo().username;

// oauth client
let emailOAuth2Client = null;
let redirectUri;

async function getAvailablePort() {
  const getPort = (await import('get-port')).default;
  return getPort();
}

async function getStoredEmailTokens() {
  try {
    const tokens = await keytar.getPassword(SERVICE, ACCOUNT);
    if (tokens) {
      console.log('[email] Loaded tokens from keytar');
      return JSON.parse(tokens);
    } else {
      console.log('[email] No tokens found in keytar');
      return null;
    }
  } catch (err) {
    console.error('[email] Error loading tokens:', err);
    return null;
  }
}

async function storeEmailTokens(tokens) {
  try {
    if (!tokens) {
      throw new Error('No tokens provided');
    }
    
    if (typeof tokens !== 'object') {
      throw new Error('Tokens must be an object');
    }
    
    // have one token, make sure it's an object
    if (!tokens.access_token) {
      throw new Error('Missing access_token in tokens object');
    }
    
    // expiry
    if (!tokens.expiry_date && tokens.expires_in) {
      tokens.expiry_date = Date.now() + (tokens.expires_in * 1000);
    }
    
    // store
    await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(tokens));
    console.log('[email] Tokens stored in keytar');
  } catch (err) {
    console.error('[email] Error storing tokens:', err);
    throw err;
  }
}

async function ensureEmailAuth(win) {
  try {
    // check if we have tokens
    let tokens = await getStoredEmailTokens();
    if (!tokens || !tokens.access_token) {
      console.error('[email] No valid access token');
      
      if (win) {
        const { clearTokensAndAuth } = require('./authHelper');
        await clearTokensAndAuth('shifted-google-email', shell);
      }
      
      throw new Error('auth required');
    }
    
    if (!emailOAuth2Client) {
      emailOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri || 'http://localhost:51739/oauth2callback'
      );
    }
    
    // set creds
    emailOAuth2Client.setCredentials(tokens);
    
    // refresh
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      console.log('[email] Token expired, refreshing...');
      try {
        const response = await emailOAuth2Client.refreshToken(tokens.refresh_token);
        const newTokens = response.tokens || response;
        if (!newTokens.refresh_token && tokens.refresh_token) {
          newTokens.refresh_token = tokens.refresh_token;
        }
        
        await storeEmailTokens(newTokens);
        emailOAuth2Client.setCredentials(newTokens);
        console.log('[email] Token refreshed successfully');
      } catch (err) {
        console.error('[email] Failed to refresh token:', err);
        
        if (win) {
          const { clearTokensAndAuth } = require('./authHelper');
          await clearTokensAndAuth('shifted-google-email', shell);
        }
        
        throw new Error('auth required');
      }
    }
    
    emailOAuth2Client.apiKey = process.env.GOOGLE_API_KEY;
    
    try {
      const gmail = google.gmail({ version: 'v1', auth: emailOAuth2Client });
      await gmail.users.getProfile({ userId: 'me' });
    } catch (err) {
      console.error('[email] Auth test failed:', err);
      
      const { isAuthError } = require('./authHelper');
      if (isAuthError(err) && win) {
        console.log('[email] Auth error detected, triggering re-auth');
        const { clearTokensAndAuth } = require('./authHelper');
        await clearTokensAndAuth('shifted-google-email', shell);
        throw new Error('auth required');
      }
      
    }
    
    return emailOAuth2Client;
  }
  catch(err){
    console.error('[email] Error in ensureEmailAuth:', err);
    throw err;
  }
}

async function getEmailAuthUrl() {
  try {
    const port = await getAvailablePort();
    redirectUri = `http://localhost:${port}/oauth2callback`;
    emailOAuth2Client = null;
    
    emailOAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
    
    emailOAuth2Client.apiKey = process.env.GOOGLE_API_KEY;
    
    const url = emailOAuth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/contacts.readonly'
      ]
    });
    
    const app = express();
    return new Promise((resolve) => {
      const server = app.listen(port);
      app.get('/oauth2callback', async (req, res) => {
        const code = req.query.code;
        if (code) {
          try {
            await handleEmailOAuthCallback(code);
            res.send('<h2>Email authentication successful! You may close this window and return to Shifted.</h2>');
          } catch (err) {
            res.send('<h2>Email authentication failed: ' + err.message + '</h2>');
          }
        } else {
          res.send('<h2>No code received.</h2>');
        }
        server.close();
      });
      resolve(url);
    });
  } catch (err) {
    console.error('[email] Error generating auth URL:', err);
    throw err;
  }
}

async function handleEmailOAuthCallback(code) {
  try {
    const response = await emailOAuth2Client.getToken(code);
    const tokens = response.tokens || response;
    
    console.log('[email] Received new tokens:', tokens ? 'Yes' : 'No');
    
    if (!tokens || !tokens.access_token) {
      throw new Error('Invalid token response');
    }
    
    if (!tokens.expiry_date && tokens.expires_in) {
      tokens.expiry_date = Date.now() + (tokens.expires_in * 1000);
    }
    
    await storeEmailTokens(tokens);
    emailOAuth2Client.setCredentials(tokens);
    return tokens;
  } catch (err) {
    console.error('[email] Error getting tokens:', err);
    throw err;
  }
}

async function getUnreadEmails(maxResults = 10) {
  try {
    console.log('[email] Getting unread emails, max:', maxResults);
    
    const auth = await ensureEmailAuth();
    console.log('[email] Auth obtained for Gmail API');
    
    const gmail = google.gmail({ version: 'v1', auth });
    
    // get unread
    console.log('[email] Listing unread messages');
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread in:inbox',
      maxResults
    });
    
    console.log('[email] Messages list response received');
    const messages = res.data.messages || [];
    console.log('[email] Found', messages.length, 'unread messages');
    
    if (messages.length === 0) {
      console.log('[email] No unread messages found');
      return { emails: [], count: 0 };
    }
    
    // get deets
    const emails = [];
    const batchSize = 5;
    
    for (let i = 0; i < messages.length; i += batchSize) {
      console.log(`[email] Processing batch ${i/batchSize + 1}`);
      const batch = messages.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (message) => {
          try {
            console.log(`[email] Getting details for message ${message.id}`);
            const details = await gmail.users.messages.get({
              userId: 'me',
              id: message.id,
              format: 'metadata',
              metadataHeaders: ['From', 'Subject', 'Date']
            });
            
            const headers = details.data.payload.headers;
            const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
            const from = headers.find(h => h.name === 'From')?.value || '';
            const date = headers.find(h => h.name === 'Date')?.value || '';
            
            console.log(`[email] Processed message: ${subject}`);
            
            return {
              id: message.id,
              threadId: message.threadId,
              subject,
              from,
              date: new Date(date).toLocaleString(),
              snippet: details.data.snippet
            };
          } catch (err) {
            console.error(`[email] Error fetching email ${message.id}:`, err);
            return null;
          }
        })
      );
      
      const validResults = batchResults.filter(email => email !== null);
      console.log(`[email] Got ${validResults.length} valid results from batch`);
      emails.push(...validResults);
    }
    
    console.log(`[email] Returning ${emails.length} emails`);
    
    return { 
      emails,
      count: res.data.resultSizeEstimate || emails.length
    };
  } catch (err) {
    console.error('[email] Error getting unread emails:', err);
    throw err;
  }
}

async function getEmailContent(messageId) {
  try {
    const auth = await ensureEmailAuth();
    const gmail = google.gmail({ version: 'v1', auth });
    
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });
    
    const message = res.data;
    const headers = message.payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
    const from = headers.find(h => h.name === 'From')?.value || '';
    const to = headers.find(h => h.name === 'To')?.value || '';
    const date = headers.find(h => h.name === 'Date')?.value || '';
    let body = '';
    
    function getBody(part) {
      if (part.mimeType === 'text/plain' && part.body.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf8');
      } else if (part.parts) {
        return part.parts.map(getBody).join('\n');
      }
      return '';
    }
    
    if (message.payload.body && message.payload.body.data) {
      body = Buffer.from(message.payload.body.data, 'base64').toString('utf8');
    } else if (message.payload.parts) {
      body = getBody(message.payload);
    }
    
    return {
      id: message.id,
      threadId: message.threadId,
      subject,
      from,
      to,
      date: new Date(date).toLocaleString(),
      body,
      snippet: message.snippet
    };
  } catch (err) {
    console.error('[email] Error getting email content:', err);
    throw err;
  }
}

async function sendEmail(options) {
  try {
    const auth = await ensureEmailAuth();
    const gmail = google.gmail({ version: 'v1', auth });
    
    const utf8Subject = `=?utf-8?B?${Buffer.from(options.subject).toString('base64')}?=`;
    const messageParts = [
      `From: ${options.from}`,
      `To: ${options.to}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      options.body
    ];
    const message = messageParts.join('\n');
    
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });
    
    return res.data;
  } catch (err) {
    console.error('[email] Error sending email:', err);
    throw err;
  }
}

async function getUserEmail() {
  try {
    const auth = await ensureEmailAuth();
    const gmail = google.gmail({ version: 'v1', auth });
    
    const profile = await gmail.users.getProfile({
      userId: 'me'
    });
    
    return profile.data.emailAddress;
  } catch (err) {
    console.error('[email] Error getting user email:', err);
    throw err;
  }
}

async function summarizeEmails(emails) {
  if (!process.env.GEMINI_API_KEY || emails.length === 0) {
    return emails;
  }
  
  try {
    const emailsText = emails.map((email, i) => 
      `Email ${i+1}:\nFrom: ${email.from}\nSubject: ${email.subject}\nSnippet: ${email.snippet}`
    ).join('\n\n');
    
    const prompt = `
    Summarize these unread emails in a concise, helpful way. Focus on the most important information:
    ${emailsText}
    
    For each email, provide a one-line summary that captures the key information.
    `;
    
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const body = {
      contents: [{ parts: [{ text: prompt }] }]
    };
    
    const resp = await axios.post(url, body, { timeout: 10000 });
    const text = resp.data.candidates[0].content.parts[0].text;
    
    return {
      emails,
      summary: text
    };
  } catch (err) {
    console.error('[email] Error summarizing emails:', err);
    return emails;
  }
}

// analyze
async function analyzeEmailForResponse(emailContent) {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }
  
  try {
    const prompt = `
    Analyze this email and suggest a response:
    
    From: ${emailContent.from}
    Subject: ${emailContent.subject}
    
    ${emailContent.body}
    
    Provide a draft response that is professional and addresses the key points in the email.
    `;
    
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const body = {
      contents: [{ parts: [{ text: prompt }] }]
    };
    
    const resp = await axios.post(url, body, { timeout: 10000 });
    return resp.data.candidates[0].content.parts[0].text;
  } catch (err) {
    console.error('[email] Error analyzing email for response:', err);
    return null;
  }
}

// validate
async function validateEmailAuth() {
  try {
    const tokens = await getStoredEmailTokens();
    if (!tokens || !tokens.refresh_token) {
      console.log('[email] No valid tokens found, need to re-authenticate');
      return false;
    }
    
    if (!emailOAuth2Client) {
      emailOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri || 'http://localhost:51739/oauth2callback'
      );
    }
    
    emailOAuth2Client.setCredentials(tokens);
    
    if (tokens.expiry_date && tokens.expiry_date < (Date.now() + 60000)) {
      console.log('[email] Token expired or expiring soon, refreshing...');
      try {
        const response = await emailOAuth2Client.refreshToken(tokens.refresh_token);
        const newTokens = response.tokens || response;
        
        if (!newTokens.refresh_token && tokens.refresh_token) {
          newTokens.refresh_token = tokens.refresh_token;
        }
        
        await storeEmailTokens(newTokens);
        emailOAuth2Client.setCredentials(newTokens);
        console.log('[email] Token refreshed successfully');
      } catch (err) {
        console.error('[email] Failed to refresh token:', err);
        return false;
      }
    }
    
    // Test the auth with a simple API call
    try {
      const gmail = google.gmail({ version: 'v1', auth: emailOAuth2Client });
      await gmail.users.getProfile({ userId: 'me' });
      console.log('[email] API test successful');
      return true;
    } catch (err) {
      console.error('[email] API test failed:', err);
      
      // Check if this is an auth error
      const { isAuthError } = require('./authHelper');
      if (isAuthError(err)) {
        console.log('[email] Auth error detected, tokens may be invalid');
        return false;
      }
      
      // For non-auth errors, we might still have valid auth
      return true;
    }
  } catch (err) {
    console.error('[email] Error validating auth:', err);
    return false;
  }
}

module.exports = {
  getUnreadEmails,
  getEmailContent,
  sendEmail,
  getUserEmail,
  getEmailAuthUrl,
  ensureEmailAuth,
  handleEmailOAuthCallback,
  summarizeEmails,
  analyzeEmailForResponse,
  validateEmailAuth
};