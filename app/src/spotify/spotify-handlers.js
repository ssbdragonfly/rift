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
  getUserPlaylists
} = require('./spotify');

async function handlePlayMusic(prompt, shell, win) {
  try {
    await ensureAuth(win);
    let query = prompt.toLowerCase();
    query = query.replace(/play|listen to|start|on spotify|with spotify|music|song|track|artist|album/gi, '').trim();
    if (!query || query.length < 2) {
      return { 
        success: true, 
        result: "I need to know what you'd like to play. Try asking for a specific song, artist, or genre." 
      };
    }
    
    const searchResults = await searchSpotify(query);
      if (!searchResults.tracks || !searchResults.tracks.items || searchResults.tracks.items.length === 0) {
      return { 
        success: false, 
        error: `I couldn't find any music matching "${query}" on Spotify.` 
      };
    }
    
    const topTrack = searchResults.tracks.items[0];
    await playMusic(topTrack.uri);
    
    return { 
      success: true, 
      result: `Now playing "${topTrack.name}" by ${topTrack.artists.map(a => a.name).join(', ')} on Spotify.`,
      context: {
        type: 'spotify-playback',
        track: topTrack
      }
    };
  } catch (err) {
    console.error('[spotify-handlers] Error in handlePlayMusic:', err);
    
    if (err.message === 'auth required') {
      try {
        const authUrl = await getAuthUrl();
        shell.openExternal(authUrl);
        return { 
          success: false, 
          error: 'Authentication required. Please check your browser to complete the sign-in process.' 
        };
      } catch (authErr) {
        console.error('[spotify-handlers] Error getting auth URL:', authErr);
        return { 
          success: false, 
          error: 'Failed to start authentication: ' + authErr.message 
        };
      }
    }
    
    if (err.message.includes('No active device found')) {
      return { 
        success: false, 
        error: 'No active Spotify device found. Please open Spotify on your device first.' 
      };
    }
    
    return { 
      success: false, 
      error: 'Error playing music: ' + err.message 
    };
  }
}

async function handleSearchMusic(prompt, shell, win) {
  try {
    await ensureAuth(win);
    let query = prompt.toLowerCase();
    query = query.replace(/search|find|look for|on spotify|with spotify|music|song|track|artist|album/gi, '').trim();
    if (!query || query.length < 2) {
      return { 
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
        success: false, 
        error: `I couldn't find any music matching "${query}" on Spotify.` 
      };
    }
    
    formattedResults += '\nYou can say "Play [song name]" to start listening.';
    
    return { 
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
        const authUrl = await getAuthUrl();
        shell.openExternal(authUrl);
        return { 
          success: false, 
          error: 'Authentication required. Please check your browser to complete the sign-in process.' 
        };
      } catch (authErr) {
        console.error('[spotify-handlers] Error getting auth URL:', authErr);
        return { 
          success: false, 
          error: 'Failed to start authentication: ' + authErr.message 
        };
      }
    }
    
    return { 
      success: false, 
      error: 'Error searching music: ' + err.message 
    };
  }
}

async function handleControlPlayback(prompt, shell, win) {
  try {
    await ensureAuth(win);
    
    const lowerPrompt = prompt.toLowerCase();
    if (lowerPrompt.includes('pause') || lowerPrompt.includes('stop')) {
      await pausePlayback();
      return { 
        success: true, 
        result: 'Paused Spotify playback.' 
      };
    } else if (lowerPrompt.includes('resume') || lowerPrompt.includes('play') || lowerPrompt.includes('start')) {
      await resumePlayback();
      return { 
        success: true, 
        result: 'Resumed Spotify playback.' 
      };
    } else if (lowerPrompt.includes('next') || lowerPrompt.includes('skip')) {
      await skipToNext();
      return { 
        success: true, 
        result: 'Skipped to the next track.' 
      };
    } else if (lowerPrompt.includes('previous') || lowerPrompt.includes('back')) {
      await skipToPrevious();
      return { 
        success: true, 
        result: 'Skipped to the previous track.' 
      };
    } else {
      const playback = await getCurrentPlayback();
      if (!playback) {
        return { 
          success: true, 
          result: 'No active Spotify playback detected.' 
        };
      }
      
      const trackName = playback.item ? playback.item.name : 'Unknown';
      const artistName = playback.item && playback.item.artists ? 
        playback.item.artists.map(a => a.name).join(', ') : 'Unknown';
      const isPlaying = playback.is_playing;
      
      return { 
        success: true, 
        result: `Currently ${isPlaying ? 'playing' : 'paused'}: "${trackName}" by ${artistName}`,
        context: {
          type: 'spotify-playback-status',
          playback
        }
      };
    }
  } catch (err) {
    console.error('[spotify-handlers] Error in handleControlPlayback:', err);
    
    if (err.message === 'auth required') {
      try {
        const authUrl = await getAuthUrl();
        shell.openExternal(authUrl);
        return { 
          success: false, 
          error: 'Authentication required. Please check your browser to complete the sign-in process.' 
        };
      } catch (authErr) {
        console.error('[spotify-handlers] Error getting auth URL:', authErr);
        return { 
          success: false, 
          error: 'Failed to start authentication: ' + authErr.message 
        };
      }
    }
    
    if (err.message.includes('No active device found')) {
      return { 
        success: false, 
        error: 'No active Spotify device found. Please open Spotify on your device first.' 
      };
    }
    
    return { 
      success: false, 
      error: 'Error controlling playback: ' + err.message 
    };
  }
}

async function handlePlaylistOperations(prompt, shell, win) {
  try {
    await ensureAuth(win);
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
      
      return { 
        success: true, 
        result: formattedResults,
        context: {
          type: 'spotify-playlists',
          playlists
        }
      };
    } else {
      return { 
        success: true, 
        result: "I can help you with Spotify playlists. Try saying 'Create a new playlist called [name]' or 'Show my playlists'." 
      };
    }
  } catch (err) {
    console.error('[spotify-handlers] Error in handlePlaylistOperations:', err);
    
    if (err.message === 'auth required') {
      try {
        const authUrl = await getAuthUrl();
        shell.openExternal(authUrl);
        return { 
          success: false, 
          error: 'Authentication required. Please check your browser to complete the sign-in process.' 
        };
      } catch (authErr) {
        console.error('[spotify-handlers] Error getting auth URL:', authErr);
        return { 
          success: false, 
          error: 'Failed to start authentication: ' + authErr.message 
        };
      }
    }
    
    return { 
      success: false, 
      error: 'Error with playlist operation: ' + err.message 
    };
  }
}

module.exports = {
  handlePlayMusic,
  handleSearchMusic,
  handleControlPlayback,
  handlePlaylistOperations
};