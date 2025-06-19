const docsFunctions = require('./google');
const { shell } = require('electron');
const { ensureDriveAuth } = require('../drive/google');
const axios = require('axios');

async function handleCreateDoc(prompt, shell, win) {
  try {
    await ensureDriveAuth(win);
    
    const { title, content } = await extractDocDetailsWithGemini(prompt);
    
    if (!title) {
      return { 
        type: 'docs-create', 
        response: 'Please specify a title for the new document.' 
      };
    }
    
    const doc = await docsFunctions.createGoogleDoc(title, content || '');
    shell.openExternal(doc.webViewLink);
    
    return { 
      type: 'docs-create', 
      response: `Created new Google Doc "${doc.title}". Opening in your browser.`,
      doc: doc
    };
  }
  
  catch (err) {
    console.error('[docs-handlers] Error creating document:', err);
    if (err.message === 'auth required') {
      const { getDriveAuthUrl } = require('../drive/google');
      const authUrl = await getDriveAuthUrl();
      shell.openExternal(authUrl);
      return { 
        type: 'error', 
        error: 'Authentication required. Please check your browser to complete the sign-in process.' 
      };
    }
    return { type: 'error', error: `Failed to create document: ${err.message}` };
  }
}

async function handleSearchDocs(prompt, shell, win) {
  try {
    await ensureDriveAuth(win);
    
    const searchQuery = await extractSearchQueryWithGemini(prompt);
    
    if (!searchQuery) {
      return { 
        type: 'docs-search', 
        response: 'Please specify what you want to search for in Google Docs.' 
      };
    }
    
    const docs = await docsFunctions.searchGoogleDocs(searchQuery);
    if (docs.length === 0) {
      return { 
        type: 'docs-search', 
        response: `No documents found matching "${searchQuery}".` 
      };
    }
    
    global.lastDocsSearchResults = docs;
    
    const docsList = docs.map((doc, index) => {
      const date = new Date(doc.modifiedTime).toLocaleString();
      return `${index + 1}. ${doc.name}
   Modified: ${date}
   ${doc.webViewLink}`;
    }).join('\n\n');
    
    return { 
      type: 'docs-search', 
      response: `Found ${docs.length} documents matching "${searchQuery}":\n\n${docsList}\n\nYou can open a document by saying "open doc #[number]" or "open [document name]".`,
      followUpMode: true,
      followUpType: 'docs-search'
    };
  } catch (err) {
    console.error('[docs-handlers] Error searching documents:', err);
    if (err.message === 'auth required') {
      const { getDriveAuthUrl } = require('../drive/google');
      const authUrl = await getDriveAuthUrl();
      shell.openExternal(authUrl);
      return { 
        type: 'error', 
        error: 'Authentication required. Please check your browser to complete the sign-in process.' 
      };
    }
    return { type: 'error', error: `Failed to search documents: ${err.message}` };
  }
}

async function handleOpenDoc(prompt, shell, win) {
  try {
    await ensureDriveAuth(win);
    
    let docId = null;
    let docName = '';
    const docInfo = await identifyDocumentWithGemini(prompt);
    
    if (docInfo && docInfo.useNumber && global.lastDocsSearchResults) {
      const docNumber = docInfo.number;
      if (docNumber > 0 && docNumber <= global.lastDocsSearchResults.length) {
        const doc = global.lastDocsSearchResults[docNumber - 1];
        docId = doc.id;
        docName = doc.name;
        shell.openExternal(doc.webViewLink);
        
        return { 
          type: 'docs-open', 
          response: `Opening "${docName}" in your browser.`,
          doc: doc
        };
      }
    }
    
    if (!docId && global.lastDocsSearchResults && docInfo && docInfo.name) {
      const doc = global.lastDocsSearchResults.find(d => 
        d.name.toLowerCase().includes(docInfo.name.toLowerCase()));
      
      if (doc) {
        docId = doc.id;
        docName = doc.name;
        shell.openExternal(doc.webViewLink);
        
        return { 
          type: 'docs-open', 
          response: `Opening "${docName}" in your browser.`,
          doc: doc
        };
      }
    }
    
    if (!docId && docInfo && docInfo.name) {
      const docs = await docsFunctions.searchGoogleDocs(docInfo.name);
      if (docs.length === 0) {
        return { 
          type: 'docs-open', 
          response: `No documents found matching "${docInfo.name}".` 
        };
      }
      
      if (docs.length === 1) {
        shell.openExternal(docs[0].webViewLink);
        
        return { 
          type: 'docs-open', 
          response: `Opening "${docs[0].name}" in your browser.`,
          doc: docs[0]
        };
      }
      global.lastDocsSearchResults = docs;
      const docsList = docs.map((doc, index) => {
        return `${index + 1}. ${doc.name}`;
      }).join('\n');
      
      return { 
        type: 'docs-search', 
        response: `Found multiple documents matching "${docInfo.name}":\n\n${docsList}\n\nPlease specify which document to open by number (e.g., "open doc #2").`,
        followUpMode: true,
        followUpType: 'docs-search'
      };
    }
    
    return { 
      type: 'docs-open', 
      response: 'Please specify which document you want to open.' 
    };
  } catch (err) {
    console.error('[docs-handlers] Error opening document:', err);
    if (err.message === 'auth required') {
      const { getDriveAuthUrl } = require('../drive/google');
      const authUrl = await getDriveAuthUrl();
      shell.openExternal(authUrl);
      return { 
        type: 'error', 
        error: 'Authentication required. Please check your browser to complete the sign-in process.' 
      };
    }
    return { type: 'error', error: `Failed to open document: ${err.message}` };
  }
}

async function handleShareDoc(prompt, shell, win) {
  try {
    await ensureDriveAuth(win);
    const { docReference, emails } = await extractShareDetailsWithGemini(prompt);
    
    if (!docReference || emails.length === 0) {
      return { 
        type: 'docs-share', 
        response: 'Please specify which document to share and with whom (email addresses).' 
      };
    }
    
    let docId = null;
    let docName = '';
    if (docReference.match(/^\d+$/) && global.lastDocsSearchResults) {
      const docNumber = parseInt(docReference);
      if (docNumber > 0 && docNumber <= global.lastDocsSearchResults.length) {
        const doc = global.lastDocsSearchResults[docNumber - 1];
        docId = doc.id;
        docName = doc.name;
      }
    }
    
    if (!docId && global.lastDocsSearchResults) {
      const doc = global.lastDocsSearchResults.find(d => 
        d.name.toLowerCase().includes(docReference.toLowerCase()));
      
      if (doc) {
        docId = doc.id;
        docName = doc.name;
      }
    }
    
    if (!docId) {
      const docs = await docsFunctions.searchGoogleDocs(docReference);
      if (docs.length === 0) {
        return { 
          type: 'docs-share', 
          response: `No documents found matching "${docReference}".` 
        };
      }
      
      if (docs.length === 1) {
        docId = docs[0].id;
        docName = docs[0].name;
      }
      else {
        global.lastDocsSearchResults = docs;
        
        const docsList = docs.map((doc, index) => {
          return `${index + 1}. ${doc.name}`;
        }).join('\n');
        
        return { 
          type: 'docs-search', 
          response: `Found multiple documents matching "${docReference}":\n\n${docsList}\n\nPlease specify which document to share by number (e.g., "share doc #2 with example@email.com").`,
          followUpMode: true,
          followUpType: 'docs-search'
        };
      }
    }
    
    const results = [];
    for (const email of emails) {
      try {
        await docsFunctions.shareGoogleDoc(docId, email);
        results.push(`✓ ${email}`);
      } catch (err) {
        results.push(`✗ ${email} (${err.message})`);
      }
    }
    
    return { 
      type: 'docs-share', 
      response: `Shared "${docName}" with:\n${results.join('\n')}` 
    };
  } catch (err) {
    console.error('[docs-handlers] Error sharing document:', err);
    if (err.message === 'auth required') {
      const { getDriveAuthUrl } = require('../drive/google');
      const authUrl = await getDriveAuthUrl();
      shell.openExternal(authUrl);
      return { 
        type: 'error', 
        error: 'Authentication required. Please check your browser to complete the sign-in process.' 
      };
    }
    return { type: 'error', error: `Failed to share document: ${err.message}` };
  }
}

async function handleUpdateDoc(prompt, shell, win) {
  try {
    await ensureDriveAuth(win);
    const { docReference, content } = await extractUpdateDetailsWithGemini(prompt);
    
    if (!docReference || !content) {
      return { 
        type: 'docs-update', 
        response: 'Please specify which document to update and what content to add.' 
      };
    }
    
    let docId = null;
    let docName = '';
    if (docReference.match(/^\d+$/) && global.lastDocsSearchResults) {
      const docNumber = parseInt(docReference);
      if (docNumber > 0 && docNumber <= global.lastDocsSearchResults.length) {
        const doc = global.lastDocsSearchResults[docNumber - 1];
        docId = doc.id;
        docName = doc.name;
      }
    }
    
    if (!docId && global.lastDocsSearchResults) {
      const doc = global.lastDocsSearchResults.find(d => 
        d.name.toLowerCase().includes(docReference.toLowerCase()));
      if (doc) {
        docId = doc.id;
        docName = doc.name;
      }
    }
    
    if (!docId) {
      const docs = await docsFunctions.searchGoogleDocs(docReference);
      
      if (docs.length === 0) {
        return { 
          type: 'docs-update', 
          response: `No documents found matching "${docReference}".` 
        };
      }
      
      if (docs.length === 1) {
        docId = docs[0].id;
        docName = docs[0].name;
      } else {
        global.lastDocsSearchResults = docs;
        
        const docsList = docs.map((doc, index) => {
          return `${index + 1}. ${doc.name}`;
        }).join('\n');
        
        return { 
          type: 'docs-search', 
          response: `Found multiple documents matching "${docReference}":\n\n${docsList}\n\nPlease specify which document to update by number (e.g., "add to doc #2: new content").`,
          followUpMode: true,
          followUpType: 'docs-search'
        };
      }
    }
    await docsFunctions.updateGoogleDoc(docId, content);
    
    return { 
      type: 'docs-update', 
      response: `Updated "${docName}" with your content.` 
    };
  } catch (err) {
    console.error('[docs-handlers] Error updating document:', err);
    if (err.message === 'auth required') {
      const { getDriveAuthUrl } = require('../drive/google');
      const authUrl = await getDriveAuthUrl();
      shell.openExternal(authUrl);
      return { 
        type: 'error', 
        error: 'Authentication required. Please check your browser to complete the sign-in process.' 
      };
    }
    return { type: 'error', error: `Failed to update document: ${err.message}` };
  }
}

async function extractDocDetailsWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return extractDocDetails(prompt);
  }
  
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Extract the document title and content from this request:
    "${prompt}"
    
    Return a JSON object with these fields:
    - title: The title for the Google Doc
    - content: The content to include in the document (or null if not specified)
    
    Example:
    Request: "Create a Google Doc called Meeting Notes with content: Agenda items for next week"
    Response: {"title": "Meeting Notes", "content": "Agenda items for next week"}
    
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
      console.error('[docs-handlers] Error parsing Gemini response:', err);
    }
    
    // Fallback to regex if parsing fails
    return extractDocDetails(prompt);
  } catch (err) {
    console.error('[docs-handlers] Error using Gemini for doc details extraction:', err);
    return extractDocDetails(prompt);
  }
}

async function extractSearchQueryWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return extractSearchQuery(prompt);
  }
  
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Extract the search query for Google Docs from this request:
    "${prompt}"
    
    Return ONLY the search term or phrase the user wants to find in their Google Docs, nothing else.
    
    Examples:
    Request: "Search for notes in my Google Docs"
    Response: notes
    
    Request: "Find documents about project planning"
    Response: project planning
    
    Request: "Look for meeting minutes from last week"
    Response: meeting minutes
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
    console.error('[docs-handlers] Error using Gemini for search query extraction:', err);
    return extractSearchQuery(prompt);
  }
}

async function identifyDocumentWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }
  
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Identify which document the user wants to open from this request:
    "${prompt}"
    
    Return a JSON object with these fields:
    - useNumber: true if the user is referring to a document by number (e.g., "open doc #2"), false otherwise
    - number: the document number if useNumber is true, null otherwise
    - name: the name or search term for the document if useNumber is false, null otherwise
    
    Examples:
    Request: "open document #3"
    Response: {"useNumber": true, "number": 3, "name": null}
    
    Request: "show me the project plan doc"
    Response: {"useNumber": false, "number": null, "name": "project plan"}
    
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
      console.error('[docs-handlers] Error parsing Gemini response:', err);
    }
    
    return null;
  } catch (err) {
    console.error('[docs-handlers] Error using Gemini for document identification:', err);
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
    Extract the document reference and email addresses from this sharing request:
    "${prompt}"
    
    Return a JSON object with these fields:
    - docReference: The document name or number reference
    - emails: An array of email addresses to share with
    
    Example:
    Request: "Share the project plan doc with john@example.com and sarah@example.com"
    Response: {"docReference": "project plan", "emails": ["john@example.com", "sarah@example.com"]}
    
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
      console.error('[docs-handlers] Error parsing Gemini response:', err);
    }
    
    return extractShareDetails(prompt);
  } catch (err) {
    console.error('[docs-handlers] Error using Gemini for share details extraction:', err);
    return extractShareDetails(prompt);
  }
}

async function extractUpdateDetailsWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return extractUpdateDetails(prompt);
  }
  
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Extract the document reference and content to add from this update request:
    "${prompt}"
    
    Return a JSON object with these fields:
    - docReference: The document name or number reference
    - content: The content to add to the document
    
    Example:
    Request: "Add to my meeting notes doc: Action items for next week"
    Response: {"docReference": "meeting notes", "content": "Action items for next week"}
    
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
      console.error('[docs-handlers] Error parsing Gemini response:', err);
    }
    
    return extractUpdateDetails(prompt);
  }
  
  catch (err) {
    console.error('[docs-handlers] Error using Gemini for update details extraction:', err);
    return extractUpdateDetails(prompt);
  }
}

//regex backup
function extractDocDetails(prompt) {
  let title = null;
  const titlePatterns = [
    /\b(?:create|make|new)\s+(?:a\s+)?(?:google\s+)?(?:doc|document)\s+(?:called|titled|named)\s+"?([^"]+)"?/i, /\b(?:create|make|new)\s+(?:a\s+)?(?:google\s+)?(?:doc|document)\s+"?([^"]+)"?/i
  ];
  
  for (const pattern of titlePatterns) {
    const match = prompt.match(pattern);
    if (match) {
      title = match[1].trim();
      break;
    }
  }
  
  let content = null;
  const contentPatterns = [
    /\b(?:with|containing|that\s+says)\s+(?:content|text)?\s*[:;]\s*"?([^"]+)"?$/i, /\b(?:with|containing|that\s+says)\s+(?:content|text)?\s+"?([^"]+)"?$/i
  ];
  
  for (const pattern of contentPatterns) {
    const match = prompt.match(pattern);
    if (match) {
      content = match[1].trim();
      break;
    }
  }
  
  return { title, content };
}

function extractSearchQuery(prompt) {
  const patterns = [
    /\b(?:search|find|look\s+for)\s+(?:for\s+)?(?:google\s+)?(?:docs|documents)\s+(?:with|containing|about|related\s+to|on|named)\s+"?([^"]+)"?/i,/\b(?:search|find|look\s+for)\s+"?([^"]+)"?\s+(?:in|on|from)\s+(?:google\s+)?docs/i,/\b(?:search|find|look\s+for)\s+(?:google\s+)?docs?\s+"?([^"]+)"?/i
  ];
  
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return null;
}

function extractDocNameToOpen(prompt) {
  const patterns = [
    /\b(?:open|view|show|get|display)\s+(?:google\s+)?(?:doc|document)\s+"?([^"]+)"?/i,
    /\b(?:open|view|show|get|display)\s+"?([^"]+)"?\s+(?:google\s+)?(?:doc|document)/i,
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
  const docPatterns = [
    /\b(?:share|send)\s+(?:google\s+)?(?:doc|document)\s+(?:number\s+)?#?(\d+)/i,
    /\b(?:share|send)\s+(?:google\s+)?(?:doc|document)\s+"?([^"]+)"?/i,
    /\b(?:share|send)\s+"?([^"]+)"?\s+(?:google\s+)?(?:doc|document)/i
  ];
  
  let docReference = null;
  for (const pattern of docPatterns) {
    const match = prompt.match(pattern);
    if (match) {
      docReference = match[1].trim();
      break;
    }
  }
  
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emails = prompt.match(emailRegex) || [];
  
  return { docReference, emails };
}

function extractUpdateDetails(prompt) {
  let docReference = null;
  const docPatterns = [
    /\b(?:add|update|append|write)\s+(?:to|in)\s+(?:google\s+)?(?:doc|document)\s+(?:number\s+)?#?(\d+)/i,/\b(?:add|update|append|write)\s+(?:to|in)\s+(?:google\s+)?(?:doc|document)\s+"?([^"]+)"?/i,/\b(?:add|update|append|write)\s+(?:to|in)\s+"?([^"]+)"?/i
  ];
  
  for (const pattern of docPatterns) {
    const match = prompt.match(pattern);
    if (match) {
      docReference = match[1].trim();
      break;
    }
  }
  
  let content = null;
  const contentPatterns = [
    /\b(?:with|:)\s*"?([^"]+)"?$/i,
    /\b(?:content|text)\s*:\s*"?([^"]+)"?$/i
  ];
  
  for (const pattern of contentPatterns) {
    const match = prompt.match(pattern);
    if (match) {
      content = match[1].trim();
      break;
    }
  }
  
  if (!content) {
    const colonMatch = prompt.match(/(?::|with)\s+(.+)$/i);
    if (colonMatch) {
      content = colonMatch[1].trim();
    }
  }
  
  return { docReference, content };
}

module.exports = {
  handleCreateDoc,
  handleSearchDocs,
  handleOpenDoc,
  handleShareDoc,
  handleUpdateDoc
};