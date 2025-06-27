const { 
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
  getUserPlaylists,
  getAvailableDevices
} = require('./spotify');

async function determineMusicType(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    if (/\b(playlist|from .+ playlist|my .+ playlist)\b/i.test(prompt)) return 'playlist';
    if (/\b(play .+ by |play the song|song called)\b/i.test(prompt)) return 'song';
    if (/\bplay\s+[a-zA-Z]/.test(prompt) && !/\bfrom\b/i.test(prompt)) return 'song';
    return 'song';
  }
  
  try {
    const axios = require('axios');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Determine if this music request is for a song/track or a playlist:
    "${prompt}"
    
    Key indicators:
    - Song requests: "play [song name]", "play the song [name]", "play [artist] - [song]"
    - Playlist requests: "play from [playlist]", "play my [name] playlist", "play [playlist name] playlist"
    
    Examples:
    - "play Bohemian Rhapsody" -> song
    - "play the song Bohemian Rhapsody" -> song  
    - "play from my chill playlist" -> playlist
    - "play nothing but the best of hindi" -> playlist (sounds like playlist name)
    - "play Shape of You by Ed Sheeran" -> song
    - "play some jazz music" -> song
    - "play my workout playlist" -> playlist
    
    IMPORTANT: Default to "song" unless it clearly mentions playlist, "from", or "my [name] playlist".
    
    Return only "song" or "playlist", nothing else.
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: { temperature: 0.0, topP: 1.0, topK: 1 }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim().toLowerCase();
    console.log('[spotify-handlers] Music type detection result:', text);
    return text.includes('playlist') ? 'playlist' : 'song';
  } catch (err) {
    console.error('[spotify-handlers] Error determining music type:', err);
    return 'song'; // Default to song on error
  }
}

async function extractPlaylistName(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    const match = prompt.match(/(?:play|from)\s+(?:the|my)?\s*(.+?)(?:\s+playlist|$)/i);
    return match ? match[1].trim() : null;
  }
  
  try {
    const axios = require('axios');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Extract the playlist name from this request:
    "${prompt}"
    
    Examples:
    - "play from my chill playlist" -> chill
    - "play nothing but the best of hindi" -> nothing but the best of hindi
    - "play my workout playlist" -> workout
    
    Return only the playlist name, nothing else.
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: { temperature: 0.0, topP: 1.0, topK: 1 }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    return resp.data.candidates[0].content.parts[0].text.trim();
  } catch (err) {
    console.error('[spotify-handlers] Error extracting playlist name:', err);
    return null;
  }
}

async function extractSongQuery(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    let query = prompt.toLowerCase();
    query = query.replace(/^(play|listen to|start|the song)\s+/gi, '').trim();
    query = query.replace(/\s+(on spotify|with spotify|music|song|track)$/gi, '').trim();
    return query;
  }
  
  try {
    const axios = require('axios');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Extract the song, artist, or search term from this music request:
    "${prompt}"
    
    Examples:
    - "play Bohemian Rhapsody" -> Bohemian Rhapsody
    - "play the song Bohemian Rhapsody" -> Bohemian Rhapsody
    - "play Shape of You by Ed Sheeran" -> Shape of You Ed Sheeran
    - "play some jazz music" -> jazz
    - "play Taylor Swift" -> Taylor Swift
    - "play rock music" -> rock
    
    Remove command words like "play", "the song", "listen to" but keep the actual song/artist name.
    Return only the clean search term, nothing else.
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: { temperature: 0.0, topP: 1.0, topK: 1 }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    const result = resp.data.candidates[0].content.parts[0].text.trim();
    console.log('[spotify-handlers] Extracted song query:', result);
    return result;
  } catch (err) {
    console.error('[spotify-handlers] Error extracting song query:', err);
    let query = prompt.toLowerCase();
    query = query.replace(/^(play|listen to|start|the song)\s+/gi, '').trim();
    query = query.replace(/\s+(on spotify|with spotify|music|song|track)$/gi, '').trim();
    return query;
  }
}

async function handlePlayMusic(prompt, shell, win) {
  try {
    console.log('[spotify-handlers] Starting play music request:', prompt);
    
    try {
      await ensureAuth(win);
      console.log('[spotify-handlers] Authentication successful');
    } catch (authErr) {
      console.error('[spotify-handlers] Authentication failed:', authErr.message);
      if (authErr.message === 'auth required' || authErr.message.includes('auth')) {
        console.log('[spotify-handlers] Opening Spotify auth page');
        try {
          const authUrl = await getAuthUrl();
          shell.openExternal(authUrl);
          return { 
            type: 'spotify-auth-required',
            response: 'Spotify authentication required. I\'ve opened the login page in your browser. Please complete the sign-in process and try your request again.' 
          };
        } catch (urlErr) {
          console.error('[spotify-handlers] Error getting auth URL:', urlErr);
          return { 
            type: 'error',
            error: 'Failed to start Spotify authentication. Please check your Spotify credentials in settings.' 
          };
        }
      } else {
        throw authErr;
      }
    }
    
    const musicType = await determineMusicType(prompt);
    console.log('[spotify-handlers] Music type detected:', musicType);
    
    if (musicType === 'playlist') {
      const playlistName = await extractPlaylistName(prompt);
      if (playlistName) {
        console.log('[spotify-handlers] Extracted playlist name:', playlistName);
        return await handlePlayFromPlaylist(playlistName, shell, win);
      }
    }
    
    console.log('[spotify-handlers] Proceeding with song search');
    
    const query = await extractSongQuery(prompt);
    console.log('[spotify-handlers] Extracted song query:', query);
    if (!query || query.length < 2) {
      return { 
        type: 'spotify-play',
        response: "I need to know what you'd like to play. Try asking for a specific song, artist, or genre." 
      };
    }
    
    const devices = await getAvailableDevices();
    if (!devices || devices.length === 0) {
      return { 
        type: 'spotify-play',
        success: false, 
        error: 'No active Spotify device found. Please open Spotify on your device, play any song first, then try again. This allows Rift to control your Spotify playback.' 
      };
    }
    
    console.log(`[spotify-handlers] Searching Spotify for: "${query}"`);
    const searchResults = await searchSpotify(query, 'track,artist,album');
    
    if (!searchResults || (!searchResults.tracks?.items?.length && !searchResults.artists?.items?.length && !searchResults.albums?.items?.length)) {
      return { 
        type: 'spotify-play',
        response: `No results found for "${query}". Try a different search term.` 
      };
    }
    
    if (searchResults.tracks && searchResults.tracks.items.length > 0) {
      const topTrack = searchResults.tracks.items[0];
      console.log(`[spotify-handlers] Found track: ${topTrack.name} by ${topTrack.artists.map(a => a.name).join(', ')}`);
      
      try {
        await playMusic(topTrack.uri);
        console.log('[spotify-handlers] Successfully started playback');
        
        return { 
          type: 'spotify-play',
          response: `🎵 Now playing "${topTrack.name}" by ${topTrack.artists.map(a => a.name).join(', ')} on Spotify.`,
          success: true
        };
      } catch (playErr) {
        console.error('[spotify-handlers] Error playing track:', playErr);
        return {
          type: 'error',
          error: `Found the song but couldn't play it: ${playErr.message}`
        };
      }
    }
    
    if (searchResults.artists && searchResults.artists.items.length > 0) {
      const topArtist = searchResults.artists.items[0];
      console.log(`[spotify-handlers] Found artist: ${topArtist.name}`);
      
      try {
        await playMusic(topArtist.uri);
        console.log('[spotify-handlers] Successfully started artist playback');
        
        return { 
          type: 'spotify-play',
          response: `🎵 Now playing music by ${topArtist.name} on Spotify.`,
          success: true
        };
      } catch (playErr) {
        console.error('[spotify-handlers] Error playing artist:', playErr);
        return {
          type: 'error',
          error: `Found the artist but couldn't play: ${playErr.message}`
        };
      }
    }
    
    if (searchResults.albums && searchResults.albums.items.length > 0) {
      const topAlbum = searchResults.albums.items[0];
      console.log(`[spotify-handlers] Found album: ${topAlbum.name} by ${topAlbum.artists.map(a => a.name).join(', ')}`);
      
      try {
        await playMusic(topAlbum.uri);
        console.log('[spotify-handlers] Successfully started album playback');
        
        return { 
          type: 'spotify-play',
          response: `🎵 Now playing album "${topAlbum.name}" by ${topAlbum.artists.map(a => a.name).join(', ')} on Spotify.`,
          success: true
        };
      } catch (playErr) {
        console.error('[spotify-handlers] Error playing album:', playErr);
        return {
          type: 'error',
          error: `Found the album but couldn't play: ${playErr.message}`
        };
      }
    }
    
    return { 
      type: 'spotify-play',
      response: `Found search results for "${query}" but no playable content.` 
    };
  } catch (err) {
    console.error('[spotify-handlers] Error in handlePlayMusic:', err);
    
    if (err.message === 'auth required' || err.message.includes('auth')) {
      try {
        console.log('[spotify-handlers] Opening Spotify auth page (error fallback)');
        const authUrl = await getAuthUrl();
        shell.openExternal(authUrl);
        return { 
          type: 'spotify-auth-required',
          response: 'Spotify authentication required. I\'ve opened the login page in your browser. Please complete the sign-in process and try your request again.' 
        };
      } catch (authErr) {
        console.error('[spotify-handlers] Error getting auth URL:', authErr);
        return { 
          type: 'error',
          error: 'Failed to start Spotify authentication: ' + authErr.message 
        };
      }
    }
    
    if (err.message.includes('No active device found')) {
      return { 
        type: 'spotify-play',
        success: false, 
        error: 'No active Spotify device found. Please open Spotify on your device and start playing something first, then try again. This allows Rift to control your Spotify playback.' 
      };
    }
    
    return { 
      type: 'error',
      error: 'Error playing music: ' + err.message 
    };
  }
}

async function handleSearchMusic(prompt, shell, win) {
  try {
    try {
      await ensureAuth(win);
    } catch (authErr) {
      if (authErr.message === 'auth required') {
        console.log('[spotify-handlers] Auth required, opening auth page');
        try {
          const authUrl = await getAuthUrl();
          shell.openExternal(authUrl);
          return { 
            type: 'spotify-search',
            success: false, 
            error: 'Spotify authentication required. I\'ve opened the login page in your browser. Please complete the sign-in process and try again.' 
          };
        } catch (urlErr) {
          console.error('[spotify-handlers] Error getting auth URL:', urlErr);
          return { 
            type: 'spotify-search',
            success: false, 
            error: 'Failed to start Spotify authentication. Please check your Spotify credentials.' 
          };
        }
      } else {
        throw authErr;
      }
    }
    
    let query = prompt.toLowerCase();
    query = query.replace(/search|find|look for|on spotify|with spotify|music|song|track|artist|album/gi, '').trim();
    if (!query || query.length < 2) {
      return { 
        type: 'spotify-search',
        success: true, 
        result: "What would you like to search for on Spotify? Please provide a song, artist, or album name." 
      };
    }
    
    const searchResults = await searchSpotify(query);
    let formattedResults = 'Here\'s what I found on Spotify:\n\n';
    
    if (searchResults.tracks && searchResults.tracks.items && searchResults.tracks.items.length > 0) {
      formattedResults += '**Songs:**\n';
      searchResults.tracks.items.slice(0, 5).forEach((track, index) => {
        formattedResults += `${index + 1}. "${track.name}" by ${track.artists.map(a => a.name).join(', ')}\n`;
      });
      formattedResults += '\n';
    }
    
    if (searchResults.artists && searchResults.artists.items && searchResults.artists.items.length > 0) {
      formattedResults += '**Artists:**\n';
      searchResults.artists.items.slice(0, 3).forEach((artist, index) => {
        formattedResults += `${index + 1}. ${artist.name}\n`;
      });
      formattedResults += '\n';
    }
    
    if (searchResults.albums && searchResults.albums.items && searchResults.albums.items.length > 0) {
      formattedResults += '**Albums:**\n';
      searchResults.albums.items.slice(0, 3).forEach((album, index) => {
        formattedResults += `${index + 1}. "${album.name}" by ${album.artists.map(a => a.name).join(', ')}\n`;
      });
    }
    
    if (!formattedResults.includes('Songs:') && !formattedResults.includes('Artists:') && !formattedResults.includes('Albums:')) {
      return { 
        type: 'spotify-search',
        success: false, 
        error: `I couldn't find any music matching "${query}" on Spotify.` 
      };
    }
    
    formattedResults += '\nYou can say "Play [song name]" to start listening.';
    
    return { 
      type: 'spotify-search',
      success: true, 
      result: formattedResults,
      context: {
        type: 'spotify-search',
        results: searchResults
      }
    };
  }
  catch (err) {
    console.error('[spotify-handlers] Error in handleSearchMusic:', err);
    
    if (err.message === 'auth required') {
      try {
        console.log('[spotify-handlers] Opening Spotify auth page automatically');
        const authUrl = await getAuthUrl();
        shell.openExternal(authUrl);
        return { 
          type: 'spotify-search',
          success: false, 
          error: 'Spotify authentication required. I\'ve opened the login page in your browser. Please complete the sign-in process and try again.' 
        };
      } catch (authErr) {
        console.error('[spotify-handlers] Error getting auth URL:', authErr);
        return { 
          type: 'spotify-search',
          success: false, 
          error: 'Failed to start Spotify authentication: ' + authErr.message 
        };
      }
    }
    
    return { 
      type: 'spotify-search',
      success: false, 
      error: 'Error searching music: ' + err.message 
    };
  }
}

async function handleControlPlayback(prompt, shell, win) {
  try {
    console.log('[spotify-handlers] Starting playback control:', prompt);
    
    try {
      await ensureAuth(win);
      console.log('[spotify-handlers] Authentication successful for control');
    } catch (authErr) {
      console.error('[spotify-handlers] Control auth failed:', authErr.message);
      if (authErr.message === 'auth required' || authErr.message.includes('auth')) {
        console.log('[spotify-handlers] Opening Spotify auth page for control');
        try {
          const authUrl = await getAuthUrl();
          shell.openExternal(authUrl);
          return { 
            type: 'spotify-auth-required',
            response: 'Spotify authentication required. I\'ve opened the login page in your browser. Please complete the sign-in process and try your request again.' 
          };
        } catch (urlErr) {
          console.error('[spotify-handlers] Error getting auth URL:', urlErr);
          return { 
            type: 'error',
            error: 'Failed to start Spotify authentication. Please check your Spotify credentials.' 
          };
        }
      } else {
        throw authErr;
      }
    }
    
    const lowerPrompt = prompt.toLowerCase();
    const devices = await getAvailableDevices();
    if (!devices || devices.length === 0) {
      return { 
        type: 'spotify-control',
        success: false, 
        error: 'No active Spotify device found. Please open Spotify on your device and start playing something first, then try again.' 
      };
    }
    
    try {
      if (lowerPrompt.includes('pause') || lowerPrompt.includes('stop')) {
        await pausePlayback();
        return { 
          type: 'spotify-control',
          response: '⏸️ Paused Spotify playback.',
          success: true
        };
      } else if (lowerPrompt.includes('resume') || lowerPrompt.includes('unpause') || (lowerPrompt.includes('play') && !lowerPrompt.includes('start'))) {
        await resumePlayback();
        return { 
          type: 'spotify-control',
          response: '▶️ Resumed Spotify playback.',
          success: true
        };
      } else if (lowerPrompt.includes('next') || lowerPrompt.includes('skip')) {
        await skipToNext();
        return { 
          type: 'spotify-control',
          response: '⏭️ Skipped to the next track.',
          success: true
        };
      } else if (lowerPrompt.includes('previous') || lowerPrompt.includes('back')) {
        await skipToPrevious();
        return { 
          type: 'spotify-control',
          response: '⏮️ Skipped to the previous track.',
          success: true
        };
      } else {
        const playback = await getCurrentPlayback();
        if (!playback) {
          return { 
            type: 'spotify-control',
            success: true, 
            result: 'No active Spotify playback detected.' 
          };
        }
        
        const trackName = playback.item ? playback.item.name : 'Unknown';
        const artistName = playback.item && playback.item.artists ? 
          playback.item.artists.map(a => a.name).join(', ') : 'Unknown';
        const isPlaying = playback.is_playing;
        
        return { 
          type: 'spotify-control',
          response: `🎵 Currently ${isPlaying ? 'playing' : 'paused'}: "${trackName}" by ${artistName}`,
          success: true,
          context: {
            type: 'spotify-playback-status',
            playback
          }
        };
      }
    } catch (controlErr) {
      console.error('[spotify-handlers] Error controlling playback:', controlErr);
      
      if (controlErr.response && controlErr.response.status === 403) {
        return { 
          type: 'spotify-control',
          success: false, 
          error: 'Spotify Premium is required for playback control. Please upgrade your Spotify account or start playback directly in the Spotify app.' 
        };
      }
      
      return { 
        type: 'spotify-control',
        success: false, 
        error: 'Error controlling Spotify playback. Please make sure Spotify is open and playing on your device.' 
      };
    }
  } catch (err) {
    console.error('[spotify-handlers] Error in handleControlPlayback:', err);
    
    if (err.message === 'auth required') {
      try {
        console.log('[spotify-handlers] Opening Spotify auth page automatically');
        const authUrl = await getAuthUrl();
        shell.openExternal(authUrl);
        return { 
          type: 'spotify-control',
          success: false, 
          error: 'Spotify authentication required. I\'ve opened the login page in your browser. Please complete the sign-in process and try again.' 
        };
      } catch (authErr) {
        console.error('[spotify-handlers] Error getting auth URL:', authErr);
        return { 
          type: 'spotify-control',
          success: false, 
          error: 'Failed to start Spotify authentication: ' + authErr.message 
        };
      }
    }
    
    if (err.message.includes('No active device found')) {
      return { 
        type: 'spotify-control',
        success: false, 
        error: 'No active Spotify device found. Please open Spotify on your device and start playing something first, then try again.' 
      };
    }
    
    return { 
      type: 'spotify-control',
      success: false, 
      error: 'Error controlling playback: ' + err.message 
    };
  }
}

async function handlePlaylistOperations(prompt, shell, win) {
  try {
    try {
      await ensureAuth(win);
    } catch (authErr) {
      if (authErr.message === 'auth required') {
        console.log('[spotify-handlers] Auth required, opening auth page');
        try {
          const authUrl = await getAuthUrl();
          shell.openExternal(authUrl);
          return { 
            type: 'spotify-playlist',
            success: false, 
            error: 'Spotify authentication required. I\'ve opened the login page in your browser. Please complete the sign-in process and try again.' 
          };
        } catch (urlErr) {
          console.error('[spotify-handlers] Error getting auth URL:', urlErr);
          return { 
            type: 'spotify-playlist',
            success: false, 
            error: 'Failed to start Spotify authentication. Please check your Spotify credentials.' 
          };
        }
      } else {
        throw authErr;
      }
    }
    
    const lowerPrompt = prompt.toLowerCase();
    if (lowerPrompt.includes('create') || lowerPrompt.includes('make') || lowerPrompt.includes('new')) {
      let playlistName = '';
      const nameMatch = prompt.match(/(?:create|make|new)\s+(?:a\s+)?(?:spotify\s+)?playlist\s+(?:called|named)\s+"([^"]+)"/i);
      if (nameMatch && nameMatch[1]) {
        playlistName = nameMatch[1];
      }
      else {
        const altMatch = prompt.match(/(?:create|make|new)\s+(?:a\s+)?(?:spotify\s+)?playlist\s+(?:called|named)\s+(.+?)(?:\s+with|$)/i);
        if (altMatch && altMatch[1]) {
          playlistName = altMatch[1];
        } else {
          playlistName = 'My Playlist ' + new Date().toLocaleDateString();
        }
      }
      
      const playlist = await createPlaylist(playlistName);
      return { 
        type: 'spotify-playlist',
        success: true, 
        result: `Created a new playlist called "${playlist.name}". You can now add songs to it.`,
        context: {
          type: 'spotify-playlist',
          playlist
        }
      };
    } 
    else if (lowerPrompt.includes('list') || lowerPrompt.includes('show') || lowerPrompt.includes('my')) {
      const playlists = await getUserPlaylists();
      
      if (!playlists || !playlists.items || playlists.items.length === 0) {
        return { 
          type: 'spotify-playlist',
          success: true, 
          result: "You don't have any playlists on Spotify yet. You can create one by saying 'Create a new playlist called [name]'." 
        };
      }
      
      let formattedResults = 'Here are your Spotify playlists:\n\n';
      playlists.items.slice(0, 10).forEach((playlist, index) => {
        formattedResults += `${index + 1}. ${playlist.name} (${playlist.tracks.total} tracks)\n`;
      });
      
      if (playlists.items.length > 10) {
        formattedResults += `\n...and ${playlists.items.length - 10} more playlists.`;
      }
      
      formattedResults += '\n\nYou can say "Play from [playlist name]" to start listening.';
      
      return { 
        type: 'spotify-playlist',
        success: true, 
        result: formattedResults,
        context: {
          type: 'spotify-playlists',
          playlists
        },
        followUpMode: true,
        followUpType: 'spotify-playlist-selection'
      };
    } else {
      return { 
        type: 'spotify-playlist',
        success: true, 
        result: "I can help you with Spotify playlists. Try saying 'Create a new playlist called [name]' or 'Show my playlists'." 
      };
    }
  } catch (err) {
    console.error('[spotify-handlers] Error in handlePlaylistOperations:', err);
    
    if (err.message === 'auth required') {
      try {
        console.log('[spotify-handlers] Opening Spotify auth page automatically');
        const authUrl = await getAuthUrl();
        shell.openExternal(authUrl);
        return { 
          type: 'spotify-playlist',
          success: false, 
          error: 'Spotify authentication required. I\'ve opened the login page in your browser. Please complete the sign-in process and try again.' 
        };
      } catch (authErr) {
        console.error('[spotify-handlers] Error getting auth URL:', authErr);
        return { 
          type: 'spotify-playlist',
          success: false, 
          error: 'Failed to start Spotify authentication: ' + authErr.message 
        };
      }
    }
    
    return { 
      type: 'spotify-playlist',
      success: false, 
      error: 'Error with playlist operation: ' + err.message 
    };
  }
}

async function handlePlayFromPlaylist(playlistName, shell, win) {
  try {
    const playlists = await getUserPlaylists();
    
    if (!playlists || !playlists.items || playlists.items.length === 0) {
      return { 
        type: 'spotify-play',
        success: false, 
        error: "You don't have any playlists on Spotify yet." 
      };
    }
    
    const playlistNameLower = playlistName.toLowerCase();
    let matchedPlaylist = null;
    
    console.log(`[spotify-handlers] Looking for playlist matching: "${playlistNameLower}"`);
    console.log(`[spotify-handlers] Available playlists: ${playlists.items.map(p => p.name).join(', ')}`);
    
    if (/^\d+$/.test(playlistName) && parseInt(playlistName) > 0 && parseInt(playlistName) <= playlists.items.length) {
      const index = parseInt(playlistName) - 1;
      matchedPlaylist = playlists.items[index];
      console.log(`[spotify-handlers] Matched playlist by number: ${matchedPlaylist.name}`);
    }
    
    if (!matchedPlaylist) {
      matchedPlaylist = playlists.items.find(p => 
        p.name.toLowerCase() === playlistNameLower);
      
      if (matchedPlaylist) {
        console.log(`[spotify-handlers] Matched playlist by exact name: ${matchedPlaylist.name}`);
      }
    }
    
    if (!matchedPlaylist) {
      matchedPlaylist = playlists.items.find(p => 
        p.name.toLowerCase().includes(playlistNameLower) || 
        playlistNameLower.includes(p.name.toLowerCase()));
      
      if (matchedPlaylist) {
        console.log(`[spotify-handlers] Matched playlist by partial name: ${matchedPlaylist.name}`);
      }
    }
    
    if (!matchedPlaylist) {
      let formattedResults = 'I couldn\'t find a playlist matching "' + playlistName + '". Here are your playlists:\n\n';
      
      playlists.items.slice(0, 10).forEach((playlist, index) => {
        formattedResults += `${index + 1}. "${playlist.name}" (${playlist.tracks.total} tracks)\n`;
      });
      
      if (playlists.items.length > 10) {
        formattedResults += `\n...and ${playlists.items.length - 10} more playlists.`;
      }
      
      formattedResults += '\n\nYou can say "Play from [playlist name]" to start listening.';
      
      return { 
        type: 'spotify-play',
        success: false, 
        error: formattedResults,
        followUpMode: true,
        followUpType: 'spotify-playlist-selection'
      };
    }
    
    const devices = await getAvailableDevices();
    if (!devices || devices.length === 0) {
      return { 
        type: 'spotify-play',
        success: false, 
        error: 'No active Spotify device found. Please open Spotify on your device, play any song first, then try again. This allows Rift to control your Spotify playback.' 
      };
    }
    
    console.log(`[spotify-handlers] Playing playlist: ${matchedPlaylist.name} (${matchedPlaylist.uri})`);
    await playMusic(matchedPlaylist.uri);
    
    return { 
      type: 'spotify-play',
      success: true, 
      result: `Now playing from your "${matchedPlaylist.name}" playlist on Spotify.`,
      context: {
        type: 'spotify-playlist-playback',
        playlist: matchedPlaylist
      }
    };
  } catch (err) {
    console.error('[spotify-handlers] Error playing from playlist:', err);
    
    if (err.message === 'auth required') {
      try {
        console.log('[spotify-handlers] Opening Spotify auth page automatically');
        const authUrl = await getAuthUrl();
        shell.openExternal(authUrl);
        return { 
          type: 'spotify-play',
          success: false, 
          error: 'Spotify authentication required. I\'ve opened the login page in your browser. Please complete the sign-in process and try again.' 
        };
      } catch (authErr) {
        console.error('[spotify-handlers] Error getting auth URL:', authErr);
        return { 
          type: 'spotify-play',
          success: false, 
          error: 'Failed to start Spotify authentication: ' + authErr.message 
        };
      }
    }
    
    if (err.message.includes('No active device found')) {
      return { 
        type: 'spotify-play',
        success: false, 
        error: 'No active Spotify device found. Please open Spotify on your device and start playing something first, then try again.' 
      };
    }
    
    return { 
      type: 'spotify-play',
      success: false, 
      error: 'Error playing from playlist: ' + err.message 
    };
  }
}

module.exports = {
  handlePlayMusic,
  handleSearchMusic,
  handleControlPlayback,
  handlePlaylistOperations,
  handlePlayFromPlaylist
};