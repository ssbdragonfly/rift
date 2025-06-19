require('dotenv').config();
const { google } = require('googleapis');
const keytar = require('keytar');
const os = require('os');
const express = require('express');
const { shell } = require('electron');

const SERVICE = 'rift-google-drive';
const ACCOUNT = os.userInfo().username;
let driveOAuth2Client = null;
let redirectUri;

async function getAvailablePort() {
  const getPort = (await import('get-port')).default;
  return getPort();
}

async function getStoredDriveTokens() {
  try {
    const tokens = await keytar.getPassword(SERVICE, ACCOUNT);
    if (tokens) {
      console.log('[drive] Loaded tokens from keytar');
      return JSON.parse(tokens);
    } else {
      console.log('[drive] No tokens found in keytar');
      return null;
    }
  } catch (err) {
    console.error('[drive] Error loading tokens:', err);
    return null;
  }
}

async function storeDriveTokens(tokens) {
  try {
    if (!tokens) {
      throw new Error('No tokens provided');
    }
    
    if (typeof tokens !== 'object') {
      throw new Error('Tokens must be an object');
    }
    
    if (!tokens.access_token) {
      throw new Error('Missing access_token in tokens object');
    }
    
    if (!tokens.expiry_date && tokens.expires_in) {
      tokens.expiry_date = Date.now() + (tokens.expires_in * 1000);
    }
    
    await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(tokens));
    console.log('[drive] Tokens stored in keytar');
  } catch (err) {
    console.error('[drive] Error storing tokens:', err);
    throw err;
  }
}

async function ensureDriveAuth(win) {
  try {
    let tokens = await getStoredDriveTokens();
    if (!tokens || !tokens.access_token) {
      console.error('[drive] No valid access token');
      
      if (win) {
        const { clearTokensAndAuth } = require('../utils/authHelper');
        await clearTokensAndAuth(SERVICE, shell);
      }
      
      throw new Error('auth required');
    }
    
    if (!driveOAuth2Client) {
      driveOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri || 'http://localhost:51739/oauth2callback'
      );
    }
    
    driveOAuth2Client.setCredentials(tokens);
    
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      console.log('[drive] Token expired, refreshing...');
      try {
        const response = await driveOAuth2Client.refreshToken(tokens.refresh_token);
        const newTokens = response.tokens || response;
        if (!newTokens.refresh_token && tokens.refresh_token) {
          newTokens.refresh_token = tokens.refresh_token;
        }
        
        await storeDriveTokens(newTokens);
        driveOAuth2Client.setCredentials(newTokens);
        console.log('[drive] Token refreshed successfully');
      } catch (err) {
        console.error('[drive] Failed to refresh token:', err);
        throw err;
      }
    }
    
    return driveOAuth2Client;
  } catch (err) {
    console.error('[drive] Auth error:', err);
    throw err;
  }
}

async function validateDriveAuth() {
  try {
    const tokens = await getStoredDriveTokens();
    if (!tokens || !tokens.access_token) {
      return false;
    }
    
    if (!driveOAuth2Client) {
      driveOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri || 'http://localhost:51739/oauth2callback'
      );
    }
    
    driveOAuth2Client.setCredentials(tokens);
    
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      if (!tokens.refresh_token) {
        return false;
      }
      
      try {
        const response = await driveOAuth2Client.refreshToken(tokens.refresh_token);
        const newTokens = response.tokens || response;
        if (!newTokens.refresh_token && tokens.refresh_token) {
          newTokens.refresh_token = tokens.refresh_token;
        }
        
        await storeDriveTokens(newTokens);
        driveOAuth2Client.setCredentials(newTokens);
      } catch (err) {
        console.error('[drive] Failed to refresh token during validation:', err);
        return false;
      }
    }
    
    return true;
  } catch (err) {
    console.error('[drive] Error validating auth:', err);
    return false;
  }
}

async function getDriveAuthUrl() {
  try {
    const port = await getAvailablePort();
    redirectUri = `http://localhost:${port}/oauth2callback`;
    
    if (!driveOAuth2Client) {
      driveOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri
      );
    }
    
    const scopes = [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.metadata.readonly'
    ];
    
    const authUrl = driveOAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
    
    startDriveAuthServer(port);
    return authUrl;
  } catch (err) {
    console.error('[drive] Error generating auth URL:', err);
    throw err;
  }
}

let driveAuthServer = null;

function startDriveAuthServer(port) {
  if (driveAuthServer) {
    try {
      driveAuthServer.close();
    } catch (e) {
      console.error('[drive] Error closing existing auth server:', e);
    }
  }
  
  const app = express();
  app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
      res.send('Error: No authorization code received');
      return;
    }
    
    try {
      const { tokens } = await driveOAuth2Client.getToken(code);
      await storeDriveTokens(tokens);
      driveOAuth2Client.setCredentials(tokens);
      
      res.send(`
        <html>
          <body>
            <h1>Authentication successful!</h1>
            <p>You can now close this window and return to the app.</p>
            <script>window.close();</script>
          </body>
        </html>
      `);
      
      setTimeout(() => {
        if (driveAuthServer) {
          driveAuthServer.close();
          driveAuthServer = null;
        }
      }, 1000);
    } catch (err) {
      console.error('[drive] Error getting tokens:', err);
      res.send(`Error: ${err.message}`);
    }
  });
  
  driveAuthServer = app.listen(port, () => {
    console.log(`[drive] Auth server listening on port ${port}`);
  });
}

async function searchDriveFiles(query, mimeType = null, maxResults = 10) {
  try {
    const auth = await ensureDriveAuth();
    const drive = google.drive({ version: 'v3', auth });
    
    let q = `name contains '${query}' and trashed = false`;
    if (mimeType) {
      q += ` and mimeType = '${mimeType}'`;
    }
    
    const response = await drive.files.list({
      q,
      fields: 'files(id, name, mimeType, webViewLink, createdTime, modifiedTime, owners, size)',
      spaces: 'drive',
      pageSize: maxResults
    });
    
    return response.data.files;
  } catch (err) {
    console.error('[drive] Error searching files:', err);
    throw err;
  }
}

async function getDriveFileContent(fileId) {
  try {
    const auth = await ensureDriveAuth();
    const drive = google.drive({ version: 'v3', auth });
    
    const fileMetadata = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, webViewLink, createdTime, modifiedTime, owners, size'
    });
    
    if (fileMetadata.data.mimeType.includes('text/') || 
        fileMetadata.data.mimeType.includes('application/json')) {
      const response = await drive.files.get({
        fileId,
        alt: 'media'
      });
      
      return {
        metadata: fileMetadata.data,
        content: response.data
      };
    }
    
    return {
      metadata: fileMetadata.data,
      content: null
    };
  } catch (err) {
    console.error('[drive] Error getting file content:', err);
    throw err;
  }
}

async function shareDriveFile(fileId, emailAddress, role = 'reader') {
  try {
    const auth = await ensureDriveAuth();
    const drive = google.drive({ version: 'v3', auth });
    
    const response = await drive.permissions.create({
      fileId,
      requestBody: {
        type: 'user',
        role,
        emailAddress
      },
      fields: 'id'
    });
    
    return response.data;
  } catch (err) {
    console.error('[drive] Error sharing file:', err);
    throw err;
  }
}

module.exports = {
  ensureDriveAuth,
  validateDriveAuth,
  getDriveAuthUrl,
  searchDriveFiles,
  getDriveFileContent,
  shareDriveFile
};