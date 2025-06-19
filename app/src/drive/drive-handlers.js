const driveFunctions = require('./google');
const { shell } = require('electron');
const { clearTokensAndAuth } = require('../utils/authHelper');
const axios = require('axios');

async function handleDriveSearch(prompt, shell, win) {
  try {
    const isValid = await driveFunctions.validateDriveAuth();
    if (!isValid) {
      const authUrl = await driveFunctions.getDriveAuthUrl();
      shell.openExternal(authUrl);
      return { 
        type: 'error', 
        error: 'Google Drive authentication required. Please check your browser to complete the sign-in process.' 
      };
    }
    
    await driveFunctions.ensureDriveAuth(win);
    const searchQuery = await extractSearchQueryWithGemini(prompt);
    if (!searchQuery) {
      return { 
        type: 'drive-search', 
        response: 'Please specify what you want to search for in Google Drive.' 
      };
    }
    
    const fileType = await determineFileTypeWithGemini(prompt);
    let mimeType = null;
    
    if (fileType === 'document' || fileType === 'doc') {
      mimeType = 'application/vnd.google-apps.document';
    } else if (fileType === 'spreadsheet' || fileType === 'sheet') {
      mimeType = 'application/vnd.google-apps.spreadsheet';
    } else if (fileType === 'presentation' || fileType === 'slides') {
      mimeType = 'application/vnd.google-apps.presentation';
    }
    
    const files = await driveFunctions.searchDriveFiles(searchQuery, mimeType);
    
    if (files.length === 0) {
      return { 
        type: 'drive-search', 
        response: `No files found matching "${searchQuery}".` 
      };
    }
    
    // Store search results for follow-up actions
    global.lastDriveSearchResults = files;
    
    const fileList = files.map((file, index) => {
      const date = new Date(file.modifiedTime).toLocaleString();
      return `${index + 1}. ${file.name} (${getFileTypeLabel(file.mimeType)})
   Modified: ${date}
   ${file.webViewLink}`;
    }).join('\n\n');
    
    return { 
      type: 'drive-search', 
      response: `Found ${files.length} files matching "${searchQuery}":\n\n${fileList}\n\nYou can open a file by saying "open file #[number]" or "open [filename]".`,
      followUpMode: true,
      followUpType: 'drive-search'
    };
  } catch (err) {
    console.error('[drive-handlers] Error handling drive search:', err);
    if (err.message === 'auth required') {
      const authUrl = await driveFunctions.getDriveAuthUrl();
      shell.openExternal(authUrl);
      return { 
        type: 'error', 
        error: 'Authentication required. Please check your browser to complete the sign-in process.' 
      };
    }
    return { type: 'error', error: `Failed to search Drive: ${err.message}` };
  }
}

async function handleDriveFileOpen(prompt, shell, win) {
  try {
    await driveFunctions.ensureDriveAuth(win);
    const fileInfo = await identifyFileWithGemini(prompt);
    let fileId = null;
    if (fileInfo && fileInfo.useNumber && global.lastDriveSearchResults) {
      const fileNumber = fileInfo.number;
      if (fileNumber > 0 && fileNumber <= global.lastDriveSearchResults.length) {
        const file = global.lastDriveSearchResults[fileNumber - 1];
        fileId = file.id;
        shell.openExternal(file.webViewLink);
        
        return { 
          type: 'drive-open', 
          response: `Opening "${file.name}" in your browser.`,
          file: file
        };
      }
    }
    
    if (!fileId && fileInfo && fileInfo.name && global.lastDriveSearchResults) {
      const file = global.lastDriveSearchResults.find(f => 
        f.name.toLowerCase().includes(fileInfo.name.toLowerCase()));
      if (file) {
        fileId = file.id;
        shell.openExternal(file.webViewLink);
        
        return { 
          type: 'drive-open', 
          response: `Opening "${file.name}" in your browser.`,
          file: file
        };
      }
    }
    
    if (!fileId && fileInfo && fileInfo.name) {
      const files = await driveFunctions.searchDriveFiles(fileInfo.name);
      if (files.length === 0) {
        return { 
          type: 'drive-open', 
          response: `No files found matching "${fileInfo.name}".` 
        };
      }
      
      if (files.length === 1) {
        shell.openExternal(files[0].webViewLink);
        
        return { 
          type: 'drive-open', 
          response: `Opening "${files[0].name}" in your browser.`,
          file: files[0]
        };
      }
      
      global.lastDriveSearchResults = files;
      
      const fileList = files.map((file, index) => {
        return `${index + 1}. ${file.name} (${getFileTypeLabel(file.mimeType)})`;
      }).join('\n');
      
      return { 
        type: 'drive-search', 
        response: `Found multiple files matching "${fileInfo.name}":\n\n${fileList}\n\nPlease specify which file to open by number (e.g., "open file #2").`,
        followUpMode: true,
        followUpType: 'drive-search'
      };
    }
    
    return { 
      type: 'drive-open', 
      response: 'Please specify which file you want to open from Google Drive.' 
    };
  } catch (err) {
    console.error('[drive-handlers] Error handling drive file open:', err);
    if (err.message === 'auth required') {
      const authUrl = await driveFunctions.getDriveAuthUrl();
      shell.openExternal(authUrl);
      return { 
        type: 'error', 
        error: 'Authentication required. Please check your browser to complete the sign-in process.' 
      };
    }
    return { type: 'error', error: `Failed to open file: ${err.message}` };
  }
}

async function handleDriveFileShare(prompt, shell, win) {
  try {
    await driveFunctions.ensureDriveAuth(win);
    const { fileReference, emails } = await extractShareDetailsWithGemini(prompt);
    
    if (!fileReference || emails.length === 0) {
      return { 
        type: 'drive-share', 
        response: 'Please specify which file to share and with whom (email addresses).' 
      };
    }
    
    let fileId = null;
    let fileName = '';
    if (fileReference.match(/^\d+$/) && global.lastDriveSearchResults) {
      const fileNumber = parseInt(fileReference);
      if (fileNumber > 0 && fileNumber <= global.lastDriveSearchResults.length) {
        const file = global.lastDriveSearchResults[fileNumber - 1];
        fileId = file.id;
        fileName = file.name;
      }
    }
    
    if (!fileId && global.lastDriveSearchResults) {
      const file = global.lastDriveSearchResults.find(f => 
        f.name.toLowerCase().includes(fileReference.toLowerCase()));
      
      if (file) {
        fileId = file.id;
        fileName = file.name;
      }
    }
    
    if (!fileId) {
      const files = await driveFunctions.searchDriveFiles(fileReference);
      
      if (files.length === 0) {
        return { 
          type: 'drive-share', 
          response: `No files found matching "${fileReference}".` 
        };
      }
      
      if (files.length === 1) {
        fileId = files[0].id;
        fileName = files[0].name;
      } else {
        global.lastDriveSearchResults = files;
        
        const fileList = files.map((file, index) => {
          return `${index + 1}. ${file.name} (${getFileTypeLabel(file.mimeType)})`;
        }).join('\n');
        
        return { 
          type: 'drive-search', 
          response: `Found multiple files matching "${fileReference}":\n\n${fileList}\n\nPlease specify which file to share by number (e.g., "share file #2 with example@email.com").`,
          followUpMode: true,
          followUpType: 'drive-search'
        };
      }
    }
    
    const results = [];
    for (const email of emails) {
      try {
        await driveFunctions.shareDriveFile(fileId, email);
        results.push(`✓ ${email}`);
      } catch (err) {
        results.push(`✗ ${email} (${err.message})`);
      }
    }
    
    return { 
      type: 'drive-share', 
      response: `Shared "${fileName}" with:\n${results.join('\n')}` 
    };
  } catch (err) {
    console.error('[drive-handlers] Error handling drive file share:', err);
    if (err.message === 'auth required') {
      const authUrl = await driveFunctions.getDriveAuthUrl();
      shell.openExternal(authUrl);
      return { 
        type: 'error', 
        error: 'Authentication required. Please check your browser to complete the sign-in process.' 
      };
    }
    return { type: 'error', error: `Failed to share file: ${err.message}` };
  }
}

async function extractSearchQueryWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return extractSearchQuery(prompt);
  }
  
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Extract the search query for Google Drive from this request:
    "${prompt}"
    
    Return ONLY the search term or phrase the user wants to find in their Google Drive, nothing else.
    
    Examples:
    Request: "Search for notes in my Google Drive"
    Response: notes
    
    Request: "Find files about project planning"
    Response: project planning
    
    Request: "Look for presentation from last week"
    Response: presentation
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: {
        temperature: 0.0,
        topP: 1.0,
        topK: 1
      }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    const searchQuery = resp.data.candidates[0].content.parts[0].text.trim();
    
    return searchQuery || extractSearchQuery(prompt);
  } catch (err) {
    console.error('[drive-handlers] Error using Gemini for search query extraction:', err);
    return extractSearchQuery(prompt);
  }
}

async function determineFileTypeWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return determineFileType(prompt);
  }
  
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Determine what type of file the user is looking for in Google Drive from this request:
    "${prompt}"
    
    Return ONLY one of these file types if specified, or "any" if not specified:
    - document (for Google Docs)
    - spreadsheet (for Google Sheets)
    - presentation (for Google Slides)
    - any (if no specific file type is mentioned)
    
    Examples:
    Request: "Search for budget spreadsheet"
    Response: spreadsheet
    
    Request: "Find my presentation about marketing"
    Response: presentation
    
    Request: "Look for files about project planning"
    Response: any
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: {
        temperature: 0.0,
        topP: 1.0,
        topK: 1
      }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    const fileType = resp.data.candidates[0].content.parts[0].text.trim().toLowerCase();
    
    if (['document', 'spreadsheet', 'presentation'].includes(fileType)) {
      return fileType;
    }
    
    return null;
  } catch (err) {
    console.error('[drive-handlers] Error using Gemini for file type determination:', err);
    return determineFileType(prompt);
  }
}

async function identifyFileWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }
  
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Identify which file the user wants to open from this request:
    "${prompt}"
    
    Return a JSON object with these fields:
    - useNumber: true if the user is referring to a file by number (e.g., "open file #2"), false otherwise
    - number: the file number if useNumber is true, null otherwise
    - name: the name or search term for the file if useNumber is false, null otherwise
    
    Examples:
    Request: "open file #3"
    Response: {"useNumber": true, "number": 3, "name": null}
    
    Request: "show me the budget spreadsheet"
    Response: {"useNumber": false, "number": null, "name": "budget spreadsheet"}
    
    Only return the JSON object, nothing else.
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: {
        temperature: 0.0,
        topP: 1.0,
        topK: 1
      }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim();
    
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.error('[drive-handlers] Error parsing Gemini response:', err);
    }
    
    return null;
  } catch (err) {
    console.error('[drive-handlers] Error using Gemini for file identification:', err);
    return null;
  }
}

async function extractShareDetailsWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return extractShareDetails(prompt);
  }
  
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Extract the file reference and email addresses from this sharing request:
    "${prompt}"
    
    Return a JSON object with these fields:
    - fileReference: The file name or number reference
    - emails: An array of email addresses to share with
    
    Example:
    Request: "Share the budget spreadsheet with john@example.com and sarah@example.com"
    Response: {"fileReference": "budget spreadsheet", "emails": ["john@example.com", "sarah@example.com"]}
    
    Only return the JSON object, nothing else.
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: {
        temperature: 0.0,
        topP: 1.0,
        topK: 1
      }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim();
    
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.error('[drive-handlers] Error parsing Gemini response:', err);
    }
    
    return extractShareDetails(prompt);
  } catch (err) {
    console.error('[drive-handlers] Error using Gemini for share details extraction:', err);
    return extractShareDetails(prompt);
  }
}

function getFileTypeLabel(mimeType) {
  if (mimeType === 'application/vnd.google-apps.document') {
    return 'Google Doc';
  } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return 'Google Sheet';
  } else if (mimeType === 'application/vnd.google-apps.presentation') {
    return 'Google Slides';
  } else if (mimeType === 'application/pdf') {
    return 'PDF';
  } else if (mimeType.includes('image/')) {
    return 'Image';
  } else if (mimeType.includes('video/')) {
    return 'Video';
  } else if (mimeType.includes('audio/')) {
    return 'Audio';
  }
  return 'File';
}

function extractSearchQuery(prompt) {
  const patterns = [
    /\b(?:search|find|look\s+for)\s+(?:for\s+)?(?:files?|documents?|spreadsheets?|presentations?|slides?)\s+(?:with|containing|about|related\s+to|on|named)\s+"?([^"]+)"?/i,/\b(?:search|find|look\s+for)\s+"?([^"]+)"?\s+(?:in|on|from)\s+(?:google\s+)?drive/i,/\b(?:search|find|look\s+for)\s+"?([^"]+)"?/i
  ];
  
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return null;
}

function determineFileType(prompt) {
  if (/\b(?:docs?|documents?|text)\b/i.test(prompt)) {
    return 'document';
  } else if (/\b(?:sheets?|spreadsheets?|excel)\b/i.test(prompt)) {
    return 'spreadsheet';
  } else if (/\b(?:slides?|presentations?|powerpoint)\b/i.test(prompt)) {
    return 'presentation';
  }
  return null;
}

function extractFileNameToOpen(prompt) {
  const patterns = [
    /\b(?:open|view|show|get|display)\s+(?:file|document|spreadsheet|presentation)\s+"?([^"]+)"?/i,
    /\b(?:open|view|show|get|display)\s+"?([^"]+)"?\s+(?:file|document|spreadsheet|presentation)/i,
    /\b(?:open|view|show|get|display)\s+"?([^"]+)"?/i
  ];
  
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return null;
}

function extractShareDetails(prompt) {
  const filePatterns = [
    /\b(?:share|send)\s+(?:file|document|spreadsheet|presentation)\s+(?:number\s+)?#?(\d+)/i,
    /\b(?:share|send)\s+(?:file|document|spreadsheet|presentation)\s+"?([^"]+)"?/i,
    /\b(?:share|send)\s+"?([^"]+)"?\s+(?:file|document|spreadsheet|presentation)/i
  ];
  
  let fileReference = null;
  for (const pattern of filePatterns) {
    const match = prompt.match(pattern);
    if (match) {
      fileReference = match[1].trim();
      break;
    }
  }
  
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emails = prompt.match(emailRegex) || [];
  
  return { fileReference, emails };
}

module.exports = {
  handleDriveSearch,
  handleDriveFileOpen,
  handleDriveFileShare
};