require('dotenv').config();
const keytar = require('keytar');
const os = require('os');
const express = require('express');
const axios = require('axios');
const { shell } = require('electron');

const SERVICE = 'rift-spotify';
const ACCOUNT = os.userInfo().username;
let redirectUri;

async function getAvailablePort() {
  const getPort = (await import('get-port')).default;
  return getPort();
}

async function getStoredTokens() {
  try {
    const tokens = await keytar.getPassword(SERVICE, ACCOUNT);
    if (tokens) {
      console.log('[spotify] Loaded tokens from keytar');
      return JSON.parse(tokens);
    } else {
      console.log('[spotify] No tokens found in keytar');
      return null;
    }
  } catch (err) {
    console.error('[spotify] Error loading tokens:', err);
    return null;
  }
}

async function storeTokens(tokens) {
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
    console.log('[spotify] Tokens stored in keytar');
    return tokens;
  } catch (err) {
    console.error('[spotify] Error storing tokens:', err);
    throw err;
  }
}

let globalServer = null;
let isServerRunning = false;

async function getAuthUrl() {
  try {
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
      throw new Error('Spotify client credentials not configured');
    }
    
    console.log('[spotify] Getting auth URL with client ID:', process.env.SPOTIFY_CLIENT_ID);
    
    const port = 51739;
    
    redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
    
    console.log('[spotify] Using redirect URI:', redirectUri);
    
    const scopes = [
      'user-read-private',
      'user-read-email',
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'playlist-read-private',
      'playlist-modify-private',
      'playlist-modify-public'
    ];
    
    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.searchParams.append('client_id', process.env.SPOTIFY_CLIENT_ID);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('scope', scopes.join(' '));
    
    if (!isServerRunning) {
      const app = express();
      if (globalServer) {
        try {
          globalServer.close();
        } catch (e) {
          console.log('[spotify] Error closing existing server:', e);
        }
      }
      
      try {
        globalServer = app.listen(port, () => {
          console.log(`[spotify] Server listening on port ${port}`);
          isServerRunning = true;
        });
        
        app.get('/oauth2callback', async (req, res) => {
          const code = req.query.code;
          if (code) {
            try {
              console.log('[spotify] Received auth code, handling callback');
              await handleOAuthCallback(code);
              res.send('<h2>Authentication successful! You may close this window and return to Rift.</h2>');
            }
            catch (err) {
              console.error('[spotify] Auth callback error:', err);
              res.send('<h2>Authentication failed: ' + err.message + '</h2>');
            }
          }
          else {
            res.send('<h2>No code received.</h2>');
          }
        });
      } catch (err) {
        console.log(`[spotify] Port ${port} already in use, assuming server is running`);
        isServerRunning = true;
      }
    } else {
      console.log('[spotify] Server already running, reusing');
    }
    
    const finalUrl = authUrl.toString();
    console.log('[spotify] Generated auth URL');
    return finalUrl;
  }
  catch (err) {
    console.error('[spotify] Error generating auth URL:', err);
    throw err;
  }
}

async function handleOAuthCallback(code) {
  try {
    console.log('[spotify] Handling OAuth callback with code');
    
    const callbackUri = 'http://127.0.0.1:51739/oauth2callback';
    console.log('[spotify] Using redirect URI:', callbackUri);
    console.log('[spotify] Token request params:', {
      grant_type: 'authorization_code',
      code: code ? 'present' : 'missing',
      redirect_uri: callbackUri
    });
    
    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      data: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUri
      }).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
        ).toString('base64')
      }
    });
    
    const tokens = response.data;
    console.log('[spotify] Received new tokens:', tokens ? 'Yes' : 'No');
    
    if (!tokens || !tokens.access_token) {
      throw new Error('Invalid token response');
    }
    
    tokens.expiry_date = Date.now() + (tokens.expires_in * 1000);
    
    const storedTokens = await storeTokens(tokens);
    console.log('[spotify] Successfully stored tokens');
    return storedTokens;
  }
  catch (err) {
    console.error('[spotify] Error getting tokens:', err);
    if (err.response && err.response.data) {
      console.error('[spotify] API error details:', err.response.data);
    }
    throw err;
  }
}

async function refreshAccessToken(refreshToken) {
  try {
    console.log('[spotify] Refreshing access token');
    
    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      data: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
        ).toString('base64')
      }
    });
    
    const tokens = response.data;
    console.log('[spotify] Refresh token response received');
    
    if (!tokens || !tokens.access_token) {
      throw new Error('Invalid token response during refresh');
    }
    if (!tokens.refresh_token) {
      tokens.refresh_token = refreshToken;
    }
    
    tokens.expiry_date = Date.now() + (tokens.expires_in * 1000);
    
    const storedTokens = await storeTokens(tokens);
    console.log('[spotify] Refreshed tokens stored successfully');
    return storedTokens;
  }
  catch (err) {
    console.error('[spotify] Error refreshing token:', err);
    throw err;
  }
}

let authWindowOpened = false;
async function ensureAuth(win) {
  try {
    let tokens = await getStoredTokens();
    if (!tokens || !tokens.access_token) {
      console.error('[spotify] No valid access token');
      
      if (win && !authWindowOpened) {
        console.log('[spotify] Opening Spotify auth page automatically');
        try {
          const authUrl = await getAuthUrl();
          shell.openExternal(authUrl);
          authWindowOpened = true;
          setTimeout(() => {
            authWindowOpened = false;
            console.log('[spotify] Auth window flag reset');
          }, 30000);
        } catch (authErr) {
          console.error('[spotify] Error opening auth URL:', authErr);
        }
      } else if (authWindowOpened) {
        console.log('[spotify] Auth window already opened, not opening another');
      }
      
      throw new Error('auth required');
    }
    
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      console.log('[spotify] Token expired, refreshing...');
      try {
        tokens = await refreshAccessToken(tokens.refresh_token);
        console.log('[spotify] Token refreshed successfully');
      }
      catch (err) {
        console.error('[spotify] Failed to refresh token:', err);
        
        if (win && !authWindowOpened) {
          console.log('[spotify] Opening Spotify auth page automatically after refresh failure');
          try {
            const authUrl = await getAuthUrl();
            shell.openExternal(authUrl);
            authWindowOpened = true;
            
            setTimeout(() => {
              authWindowOpened = false;
              console.log('[spotify] Auth window flag reset');
            }, 30000);
          } catch (authErr) {
            console.error('[spotify] Error opening auth URL:', authErr);
          }
        } else if (authWindowOpened) {
          console.log('[spotify] Auth window already opened, not opening another');
        }
        
        throw new Error('auth required');
      }
    }
    
    return tokens.access_token;
  }
  catch (err) {
    if (err.message === 'auth required') {
      throw err;
    }
    console.error('[spotify] Error in ensureAuth:', err);
    throw new Error('Failed to authenticate with Spotify');
  }
}

async function searchSpotify(query, type = 'track,artist,album,playlist') {
  try {
    const accessToken = await ensureAuth();
    
    const response = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/search',
      params: {
        q: query,
        type,
        limit: 10
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    return response.data;
  }
  catch (err) {
    console.error('[spotify] Error searching Spotify:', err);
    if (err.response && err.response.status === 401) {
      throw new Error('auth required');
    }
    throw err;
  }
}

async function playMusic(uri, deviceId = null) {
  try {
    const accessToken = await ensureAuth();
    
    const endpoint = 'https://api.spotify.com/v1/me/player/play';
    const url = deviceId ? `${endpoint}?device_id=${deviceId}` : endpoint;
    
    let body = {};
    if (uri) {
      if (uri.includes('spotify:track:')) {
        body = { uris: [uri] };
      } else {
        body = { context_uri: uri };
      }
    }
    
    await axios({
      method: 'put',
      url,
      data: body,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    return { success: true };
  }
  catch (err) {
    console.error('[spotify] Error playing music:', err);
    if (err.response && err.response.status === 401) {
      throw new Error('auth required');
    }
    if (err.response && err.response.status === 404) {
      throw new Error('No active device found. Please open Spotify on a device first.');
    }
    throw err;
  }
}

async function pausePlayback() {
  try {
    const accessToken = await ensureAuth();
    
    await axios({
      method: 'put',
      url: 'https://api.spotify.com/v1/me/player/pause',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    return { success: true };
  }
  catch (err) {
    console.error('[spotify] Error pausing playback:', err);
    if (err.response && err.response.status === 401) {
      throw new Error('auth required');
    }
    throw err;
  }
}

async function resumePlayback() {
  try {
    const accessToken = await ensureAuth();
    
    await axios({
      method: 'put',
      url: 'https://api.spotify.com/v1/me/player/play',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    return { success: true };
  }
  catch (err) {
    console.error('[spotify] Error resuming playback:', err);
    if (err.response && err.response.status === 401) {
      throw new Error('auth required');
    }
    throw err;
  }
}

async function skipToNext() {
  try {
    const accessToken = await ensureAuth();
    
    await axios({
      method: 'post',
      url: 'https://api.spotify.com/v1/me/player/next',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    return { success: true };
  }
  catch (err) {
    console.error('[spotify] Error skipping to next track:', err);
    if (err.response && err.response.status === 401) {
      throw new Error('auth required');
    }
    throw err;
  }
}

async function skipToPrevious() {
  try {
    const accessToken = await ensureAuth();
    
    await axios({
      method: 'post',
      url: 'https://api.spotify.com/v1/me/player/previous',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    return { success: true };
  }
  catch (err) {
    console.error('[spotify] Error skipping to previous track:', err);
    if (err.response && err.response.status === 401) {
      throw new Error('auth required');
    }
    throw err;
  }
}

async function getAvailableDevices() {
  try {
    const accessToken = await ensureAuth();
    
    const response = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/me/player/devices',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    return response.data.devices || [];
  } catch (err) {
    console.error('[spotify] Error getting available devices:', err);
    if (err.response && err.response.status === 401) {
      throw new Error('auth required');
    }
    throw err;
  }
}

async function getCurrentPlayback() {
  try {
    const accessToken = await ensureAuth();
    
    const response = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/me/player',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    return response.data;
  }
  catch (err) {
    console.error('[spotify] Error getting current playback:', err);
    if (err.response && err.response.status === 401) {
      throw new Error('auth required');
    }
    if (err.response && err.response.status === 204) {
      return null;
    }
    throw err;
  }
}

async function createPlaylist(name, description = '') {
  try {
    const accessToken = await ensureAuth();
    const userResponse = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/me',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    const userId = userResponse.data.id;
    const response = await axios({
      method: 'post',
      url: `https://api.spotify.com/v1/users/${userId}/playlists`,
      data: {
        name,
        description,
        public: false
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  }
  catch (err) {
    console.error('[spotify] Error creating playlist:', err);
    if (err.response && err.response.status === 401) {
      throw new Error('auth required');
    }
    throw err;
  }
}

async function addTracksToPlaylist(playlistId, trackUris) {
  try {
    const accessToken = await ensureAuth();
    
    const response = await axios({
      method: 'post',
      url: `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
      data: {
        uris: trackUris
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  }
  catch (err) {
    console.error('[spotify] Error adding tracks to playlist:', err);
    if (err.response && err.response.status === 401) {
      throw new Error('auth required');
    }
    throw err;
  }
}

async function getUserPlaylists() {
  try {
    const accessToken = await ensureAuth();
    
    const response = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/me/playlists',
      params: {
        limit: 50
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    return response.data;
  }
  catch (err) {
    console.error('[spotify] Error getting user playlists:', err);
    if (err.response && err.response.status === 401) { 
      throw new Error('auth required');
    }
    throw err;
  }
}

async function validateAndRefreshAuth() {
  try {
    const tokens = await getStoredTokens();
    if (!tokens || !tokens.refresh_token) {
      console.log('[spotify] No valid tokens found, need to re-authenticate');
      return false;
    }
    
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      console.log('[spotify] Token expired, refreshing...');
      try {
        const refreshedTokens = await refreshAccessToken(tokens.refresh_token);
        console.log('[spotify] Token refreshed successfully');
        return !!refreshedTokens;
      }
      catch (err) {
        console.error('[spotify] Failed to refresh token:', err);
        return false;
      }
    }
    
    return true;
  }
  catch (err) {
    console.error('[spotify] Error validating auth:', err);
    return false;
  }
}


module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  ensureAuth,
  searchSpotify,
  playMusic,
  pausePlayback,
  resumePlayback,
  skipToNext,
  skipToPrevious,
  getCurrentPlayback,
  createPlaylist,
  addTracksToPlaylist,
  getUserPlaylists,
  getAvailableDevices,
  validateAndRefreshAuth
};