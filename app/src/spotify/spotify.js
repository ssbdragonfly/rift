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
  } catch (err) {
    console.error('[spotify] Error storing tokens:', err);
    throw err;
  }
}

async function getAuthUrl() {
  try {
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
      throw new Error('Spotify client credentials not configured');
    }
    
    const port = await getAvailablePort();
    redirectUri = `http://localhost:${port}/oauth2callback`;
    
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
    
    const app = express();
    
    return new Promise((resolve) => {
      const server = app.listen(port);
      app.get('/oauth2callback', async (req, res) => {
        const code = req.query.code;
        if (code) {
          try {
            await handleOAuthCallback(code);
            res.send('<h2>Authentication successful! You may close this window and return to Rift.</h2>');
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
      resolve(authUrl.toString());
    });
  }
  catch (err) {
    console.error('[spotify] Error generating auth URL:', err);
    throw err;
  }
}

async function handleOAuthCallback(code) {
  try {
    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      params: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      },
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
    
    await storeTokens(tokens);
    return tokens;
  }
  catch (err) {
    console.error('[spotify] Error getting tokens:', err);
    throw err;
  }
}

async function refreshAccessToken(refreshToken) {
  try {
    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      params: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
        ).toString('base64')
      }
    });
    
    const tokens = response.data;
    
    if (!tokens || !tokens.access_token) {
      throw new Error('Invalid token response during refresh');
    }
    if (!tokens.refresh_token) {
      tokens.refresh_token = refreshToken;
    }
    
    tokens.expiry_date = Date.now() + (tokens.expires_in * 1000);
    
    await storeTokens(tokens);
    return tokens;
  }
  catch (err) {
    console.error('[spotify] Error refreshing token:', err);
    throw err;
  }
}

async function ensureAuth(win) {
  try {
    let tokens = await getStoredTokens();
    if (!tokens || !tokens.access_token) {
      console.error('[spotify] No valid access token');
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
        await refreshAccessToken(tokens.refresh_token);
        console.log('[spotify] Token refreshed successfully');
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
  validateAndRefreshAuth
};