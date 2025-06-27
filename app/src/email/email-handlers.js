let currentDraft = null;
let promptHistory = [];
const MAX_HISTORY = 10;
let sendEmailCallback = null;

async function extractEmailCount(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return 10;
  }
  
  try {
    const axios = require('axios');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Extract the number of emails requested from this prompt: "${prompt}"
    
    Examples:
    - "show me the last 20 emails" -> 20
    - "check my 15 unread emails" -> 15
    - "do I have any emails" -> 10
    - "show me emails" -> 10
    
    Return ONLY the number, nothing else. If no specific number is mentioned, return 10.
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
    const number = parseInt(text);
    return isNaN(number) ? 10 : Math.min(number, 50);
  } catch (err) {
    console.error('[email-handlers] Error extracting email count:', err);
    return 10;
  }
}

function setupSendEmailShortcut(callback) {
  sendEmailCallback = callback;
}

function storePromptInHistory(prompt, response) {
  promptHistory.unshift({ prompt, response });
  if (promptHistory.length > MAX_HISTORY) {
    promptHistory.pop();
  }
}

function getPromptHistory(count = 2) {
  return promptHistory.slice(0, count);
}

async function isEmailQuery(prompt) {
  if (!process.env.GEMINI_API_KEY) return false;
  
  try {
    const axios = require('axios');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Is this request asking to query/check/list emails? "${prompt}"
    
    Examples of email queries:
    - "do I have any unread emails"
    - "show me my emails"
    - "check my inbox"
    - "list my last 20 emails"
    
    Return only "true" or "false".
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: { temperature: 0.0, topP: 1.0, topK: 1 }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim().toLowerCase();
    return text.includes('true');
  } catch (err) {
    console.error('[email-handlers] Error in isEmailQuery:', err);
    return false;
  }
}

async function isEmailViewRequest(prompt) {
  if (/\b(view|read|open|show)\s+(email|mail|message)\b/i.test(prompt) && /\b(id|number|#)\b/i.test(prompt)) {
    return true;
  }
  
  if (process.env.GEMINI_API_KEY) {
    try {
      const axios = require('axios');
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
      
      const geminiPrompt = `
      Determine if this request is asking to view a specific email: "${prompt}"
      
      Examples of viewing specific emails:
      - "show me the email from Wall Street Journal"
      - "open the amazon prime email"
      - "read the email about meeting tomorrow"
      - "show me the helpbnk email"
      
      Examples that are NOT viewing specific emails:
      - "do I have any unread emails"
      - "check my inbox"
      - "show me my emails"
      
      Return only "true" if the request is asking to view a specific email, or "false" otherwise.
      `;
      
      const body = {
        contents: [{ parts: [{ text: geminiPrompt }] }],
        generationConfig: {
          temperature: 0.0,
          topP: 1.0,
          topK: 1
        }
      };
      
      const resp = await axios.post(url, body, { timeout: 5000 });
      const text = resp.data.candidates[0].content.parts[0].text.trim().toLowerCase();
      
      return text.includes('true');
    }
    catch (err) {
      console.error('[email-handlers] Error using Gemini for intent detection:', err);
      
      return /\b(view|read|open|show)\s+(email|mail|message)\s+(about|from|containing|with|regarding)\s+(.+)/i.test(prompt) ||/\b(view|read|open|show)\s+.{1,20}\s+(email|mail|message)\b/i.test(prompt);
    }
  }
  
  return /\b(view|read|open|show)\s+(email|mail|message)\s+(about|from|containing|with|regarding)\s+(.+)/i.test(prompt) ||/\b(view|read|open|show)\s+.{1,20}\s+(email|mail|message)\b/i.test(prompt);
}

async function isEmailDraftRequest(prompt) {
  if (!process.env.GEMINI_API_KEY) return false;
  
  try {
    const axios = require('axios');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Is this request asking to create/draft/compose an email? "${prompt}"
    
    Examples of email draft requests:
    - "write an email to john@example.com"
    - "compose a message about the meeting"
    - "draft an email saying hello"
    - "send an email to my boss"
    
    Return only "true" or "false".
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: { temperature: 0.0, topP: 1.0, topK: 1 }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim().toLowerCase();
    return text.includes('true');
  } catch (err) {
    console.error('[email-handlers] Error in isEmailDraftRequest:', err);
    return false;
  }
}

async function handleEmailQuery(prompt, emailFunctions, shell, win) {
  try {
    console.log('[email-handlers] Starting email query handler');
    
    const isValid = await emailFunctions.validateEmailAuth();
    if (!isValid) {
      console.log('[email-handlers] Email auth not valid, requesting authentication');
      const authUrl = await emailFunctions.getEmailAuthUrl();
      shell.openExternal(authUrl);
      return { type: 'error', error: 'Email authentication required. Please check your browser to complete the sign-in process.' };
    }
    
    console.log('[email-handlers] Email auth valid, ensuring auth');
    
    await emailFunctions.ensureEmailAuth(win);
    
    const maxResults = await extractEmailCount(prompt);
    console.log(`[email-handlers] Getting ${maxResults} unread emails`);
    const result = await emailFunctions.getUnreadEmails(maxResults);
    
    console.log('[email-handlers] Got unread emails result:', result ? 'yes' : 'no');
    
    if (result.error) {
      console.error('[email-handlers] Error in result:', result.error);
      return { type: 'error', error: result.error };
    }
    
    if (!result.emails || result.count === 0) {
      console.log('[email-handlers] No unread emails found');
      return { type: 'email-unread', response: 'You have no unread emails.' };
    }
    
    console.log('[email-handlers] Found', result.count, 'unread emails');
    
    const emailList = result.emails.map((email, index) => {
      return `${index + 1}. ${email.subject}\nFrom: ${email.from}\nDate: ${email.date}\n${email.snippet}\n`;
    }).join('\n');
    
    try {
      const summarized = await emailFunctions.summarizeEmails(result.emails);
      if (summarized && summarized.summary) {
        console.log('[email-handlers] Using summarized emails');
        return { 
          type: 'email-unread', 
          response: `You have ${result.count} unread email(s) in total. Here are summaries of the ${result.displayCount || result.emails.length} most recent:\n\n${summarized.summary}` 
        };
      }
    } catch (err) {
      console.error('[email] Error summarizing emails:', err);
    }
    
    console.log('[email-handlers] Using standard email format');
    
    return { 
      type: 'email-unread', 
      response: `You have ${result.count} unread email(s) in total. Here are the ${result.displayCount || result.emails.length} most recent:\n\n${emailList}` 
    };
  } catch (err) {
    console.error('[email] Error handling email query:', err);
    if (err.message === 'auth required') {
      const authUrl = await emailFunctions.getEmailAuthUrl();
      shell.openExternal(authUrl);
      return { type: 'error', error: 'Authentication required. Please check your browser to complete the sign-in process.' };
    }
    return { type: 'error', error: `Failed to query emails: ${err.message}` };
  }
}

async function handleEmailViewRequest(prompt, emailFunctions, shell, win) {
  try {
    const isValid = await emailFunctions.validateEmailAuth();
    if (!isValid) {
      const authUrl = await emailFunctions.getEmailAuthUrl();
      shell.openExternal(authUrl);
      return { type: 'error', error: 'Email authentication required. Please check your browser to complete the sign-in process.' };
    }
    
    await emailFunctions.ensureEmailAuth(win);
    const numberMatch = prompt.match(/\b(id|number|#)\s*(\d+)\b/i);
    const searchMatch = prompt.match(/\b(view|read|open|show)\s+(email|mail|message)\s+(about|from|containing|with)\s+(.+)/i);
    
    if (numberMatch) {
      const emailNumber = parseInt(numberMatch[2]);
      const unreadResult = await emailFunctions.getUnreadEmails(10); 
      
      if (unreadResult.error) {
        return { type: 'error', error: unreadResult.error };
      }
      
      if (unreadResult.count === 0) {
        return { type: 'email-view', response: 'You have no unread emails to view.' };
      }
      
      if (emailNumber < 1 || emailNumber > unreadResult.emails.length) {
        return { type: 'email-view', response: `Invalid email number. You have ${unreadResult.count} unread email(s).` };
      }
      
      const email = unreadResult.emails[emailNumber - 1];
      const emailContent = await emailFunctions.getEmailContent(email.id);
      
      if (emailContent.error) {
        return { type: 'error', error: emailContent.error };
      }
      
      let responseAnalysis = '';
      try {
        const analysis = await emailFunctions.analyzeEmailForResponse(emailContent);
        if (analysis) {
          responseAnalysis = `\n\nSuggested response:\n${analysis}`;
        }
      } catch (err) {
        console.error('[email] Error analyzing email for response:', err);
      }
      
      const emailViewer = require('./emailViewer');
      emailViewer.showEmail(emailContent);
      
      const formattedEmail = `
Subject: ${emailContent.subject}
From: ${emailContent.from}
To: ${emailContent.to}
Date: ${emailContent.date}

Email opened in viewer window. You can reply directly from there.
${responseAnalysis ? "\n\nSuggested response available in the viewer." : ""}
      `.trim();
      
      return { type: 'email-view', response: formattedEmail };
    } 
    else if (searchMatch) {
      const searchTerm = searchMatch[4].trim();
      console.log(`[email-handlers] Searching for email with term: "${searchTerm}"`);
      
      const emailSearch = require('./emailSearch');
      const auth = await emailFunctions.ensureEmailAuth();
      const searchResult = await emailSearch.findEmailsBySubjectOrSender(auth, searchTerm);
      
      if (searchResult.count === 0) {
        return { type: 'email-view', response: `No emails found matching "${searchTerm}".` };
      }
      
      if (searchResult.count > 1) {
        const emailList = searchResult.emails.map((email, index) => {
          return `${index + 1}. ${email.subject}\nFrom: ${email.from}\nDate: ${email.date}\n${email.snippet}\n`;
        }).join('\n');
        
        return { 
          type: 'email-unread', 
          response: `Found ${searchResult.count} emails matching "${searchTerm}":\n\n${emailList}\n\nPlease specify which email to view by number (e.g., "view email #1").` 
        };
      }
      
      const email = searchResult.emails[0];
      const emailContent = await emailFunctions.getEmailContent(email.id);
      
      if (emailContent.error) {
        return { type: 'error', error: emailContent.error };
      }
      
      let responseAnalysis = '';
      try {
        const analysis = await emailFunctions.analyzeEmailForResponse(emailContent);
        if (analysis) {
          responseAnalysis = `\n\nSuggested response:\n${analysis}`;
        }
      } catch (err) {
        console.error('[email] Error analyzing email for response:', err);
      }
      
      const emailViewer = require('./emailViewer');
      emailViewer.showEmail(emailContent);
      
      const formattedEmail = `
Subject: ${emailContent.subject}
From: ${emailContent.from}
To: ${emailContent.to}
Date: ${emailContent.date}

Email opened in viewer window. You can reply directly from there.
${responseAnalysis ? "\n\nSuggested response available in the viewer." : ""}
      `.trim();
      
      return { type: 'email-view', response: formattedEmail };
    }
    else {
      return { type: 'chat', response: 'Please specify which email you want to view by number (e.g., "view email #2") or by content (e.g., "show email about meeting").' };
    }
    
    if (emailContent.error) {
      return { type: 'error', error: emailContent.error };
    }
    
    let responseAnalysis = '';
    try {
      const analysis = await emailFunctions.analyzeEmailForResponse(emailContent);
      if (analysis) {
        responseAnalysis = `\n\nSuggested response:\n${analysis}`;
      }
    } catch (err) {
      console.error('[email] Error analyzing email for response:', err);
    }
    
    const emailViewer = require('./emailViewer');
    emailViewer.showEmail(emailContent);
    
    const formattedEmail = `
Subject: ${emailContent.subject}
From: ${emailContent.from}
To: ${emailContent.to}
Date: ${emailContent.date}

Email opened in viewer window. You can reply directly from there.
${responseAnalysis ? "\n\nSuggested response available in the viewer." : ""}
    `.trim();
    
    return { type: 'email-view', response: formattedEmail };
  } catch (err) {
    console.error('[email] Error handling email view request:', err);
    if (err.message === 'auth required') {
      const authUrl = await emailFunctions.getEmailAuthUrl();
      shell.openExternal(authUrl);
      return { type: 'error', error: 'Authentication required. Please check your browser to complete the sign-in process.' };
    }
    return { type: 'error', error: `Failed to view email: ${err.message}` };
  }
}

async function isEmailEditRequest(prompt) {
  if (!process.env.GEMINI_API_KEY) return false;
  
  try {
    const axios = require('axios');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiPrompt = `
    Is this request asking to edit/modify/update an existing email draft? "${prompt}"
    
    Examples of email edit requests:
    - "change the subject to Paris"
    - "update the recipient"
    - "modify the email body"
    - "make it more professional"
    
    Return only "true" or "false".
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: { temperature: 0.0, topP: 1.0, topK: 1 }
    };
    
    const resp = await axios.post(url, body, { timeout: 3000 });
    const text = resp.data.candidates[0].content.parts[0].text.trim().toLowerCase();
    return text.includes('true');
  } catch (err) {
    console.error('[email-handlers] Error in isEmailEditRequest:', err);
    return false;
  }
}

async function updateDraftEmail(prompt, previousContext = null) {
  if (!currentDraft) {
    return { 
      type: 'error', 
      error: 'No draft email to edit. Create a draft first with "write an email to someone@example.com"' 
    };
  }
  
  if (!process.env.GEMINI_API_KEY) {
    return { type: 'error', error: 'Gemini API key required for email editing' };
  }
  
  try {
    const axios = require('axios');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    
    const geminiPrompt = `
    I have an email draft that needs to be updated based on this request: "${prompt}"
    
    Current draft:
    To: ${currentDraft.to || '[No recipient specified]'}
    Subject: ${currentDraft.subject || '[No subject specified]'}
    Body: ${currentDraft.body || '[No body specified]'}
    
    Please update the draft according to the request. Extract any new recipient, subject, or body content.
    Preserve proper capitalization for subjects (e.g., "Paris" not "paris").
    
    Return a JSON object with the updated fields:
    {
      "to": "updated recipient or keep existing",
      "subject": "updated subject or keep existing", 
      "body": "updated body or keep existing"
    }
    
    Only return the JSON, nothing else.
    `;
    
    const body = {
      contents: [{ parts: [{ text: geminiPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        topP: 0.9,
        topK: 40
      }
    };
    
    const resp = await axios.post(url, body, { timeout: 10000 });
    const text = resp.data.candidates[0].content.parts[0].text;
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const updates = JSON.parse(jsonMatch[0]);
      if (updates.to && updates.to !== '[No recipient specified]') currentDraft.to = updates.to;
      if (updates.subject && updates.subject !== '[No subject specified]') currentDraft.subject = updates.subject;
      if (updates.body && updates.body !== '[No body specified]') currentDraft.body = updates.body;
      
      let response = '**Email draft updated.** Press Cmd+Y to send it.\n\n';
      response += `**From:** ${currentDraft.from}\n`;
      response += `**To:** ${currentDraft.to || '[Please specify recipient]'}\n`;
      response += `**Subject:** ${currentDraft.subject || '[Please specify subject]'}\n\n`;
      response += currentDraft.body || '[Please specify email content]';
      
      return { 
        type: 'email-draft', 
        response, 
        draft: currentDraft,
        showSendButton: true,
        followUpMode: true,
        followUpType: 'email-edit'
      };
    }
  } catch (err) {
    console.error('[email-handlers] Error updating draft:', err);
  }
  
  return { type: 'error', error: 'Failed to update email draft' };
}

async function handleEmailDraftRequest(prompt, emailFunctions, shell, win) {
  try {
    let originalPrompt = prompt;
    let previousContext = null;
    
    if (prompt.startsWith('FOLLOW_UP_CONTEXT:')) {
      const parts = prompt.split('NEW_PROMPT:');
      if (parts.length >= 2) {
        const contextParts = parts[0].split('PREVIOUS_RESPONSE:');
        const contextPrompt = contextParts[0].replace('FOLLOW_UP_CONTEXT:', '').trim();
        const previousResponse = contextParts.length > 1 ? contextParts[1].trim() : '';
        const newPrompt = parts[1].trim();
        
        console.log('[email-handlers] Processing follow-up. Original prompt:', contextPrompt);
        console.log('[email-handlers] New prompt:', newPrompt);
        
        previousContext = {
          prompt: contextPrompt,
          response: previousResponse
        };
        
        originalPrompt = newPrompt;
      }
    }
    
    if (currentDraft && (await isEmailEditRequest(originalPrompt) || previousContext)) {
      return await updateDraftEmail(originalPrompt, previousContext);
    }
    
    try {
      const isValid = await emailFunctions.validateEmailAuth();
      if (!isValid) {
        console.log('[email-handlers] Email auth not valid, triggering re-auth');
        const { clearTokensAndAuth } = require('../utils/authHelper');
        await clearTokensAndAuth('rift-google-email', shell);
        return { type: 'error', error: 'Email authentication required. Please check your browser to complete the sign-in process.' };
      }
    } catch (err) {
      console.error('[email-handlers] Error validating email auth:', err);
      const { isAuthError } = require('../utils/authHelper');
      if (isAuthError(err)) {
        console.log('[email-handlers] Auth error detected, triggering re-auth');
        const { clearTokensAndAuth } = require('../utils/authHelper');
        await clearTokensAndAuth('rift-google-email', shell);
      }
      return { type: 'error', error: 'Email authentication required. Please check your browser to complete the sign-in process.' };
    }
    
    await emailFunctions.ensureEmailAuth(win);
    const userEmail = await emailFunctions.getUserEmail();
    const auth = await emailFunctions.ensureEmailAuth();
    const contacts = require('../utils/contacts');
    
    let recipient = '';
    let subject = '';
    let body = '';
    
    if (process.env.GEMINI_API_KEY) {
      try {
        const axios = require('axios');
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
        const geminiPrompt = `
        Extract email details from this request: "${originalPrompt}"
        
        Return JSON with these fields (use empty string if not specified):
        {
          "recipient": "email address or contact name",
          "subject": "email subject (preserve capitalization)",
          "body": "email body content"
        }
        
        Examples:
        - "email john@example.com about Paris" -> {"recipient": "john@example.com", "subject": "Paris", "body": ""}
        - "write to Sarah saying hello" -> {"recipient": "Sarah", "subject": "", "body": "hello"}
        
        Return only the JSON.
        `;
        
        const body = {
          contents: [{ parts: [{ text: geminiPrompt }] }],
          generationConfig: {
            temperature: 0.1,
            topP: 0.9,
            topK: 40
          }
        };
        
        const resp = await axios.post(url, body, { timeout: 5000 });
        const text = resp.data.candidates[0].content.parts[0].text;
        
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const extracted = JSON.parse(jsonMatch[0]);
          recipient = extracted.recipient || '';
          subject = extracted.subject || '';
          body = extracted.body || '';
        }
      } catch (err) {
        console.error('[email-handlers] Error extracting email details with Gemini:', err);
      }
    }
    
    if (recipient && !recipient.includes('@')) {
      try {
        const resolvedEmail = await contacts.resolveContactToEmail(auth, recipient);
        console.log(`[email-handlers] Resolved contact "${recipient}" to "${resolvedEmail}"`);
        recipient = resolvedEmail;
      } catch (err) {
        console.error(`[email-handlers] Failed to resolve contact "${recipient}":`, err);
      }
    }
    

    
    const { formatEmailProfessionally } = require('./emailFormatter');
    const formattedEmail = await formatEmailProfessionally(subject, body);
    
    const draft = {
      from: userEmail,
      to: recipient || '',
      subject: formattedEmail.subject || subject || '',
      body: formattedEmail.body || body || ''
    };
    
    currentDraft = draft;
    
    let response = '**Email draft created.** Press Cmd+Y to send it.\n\n';
    response += `**From:** ${draft.from}\n`;
    response += `**To:** ${draft.to || '[Please specify recipient]'}\n`;
    response += `**Subject:** ${draft.subject || '[Please specify subject]'}\n\n`;
    response += draft.body || '[Please specify email content]';
    
    return { 
      type: 'email-draft', 
      response, 
      draft,
      showSendButton: true
    };
  } catch (err) {
    console.error('[email] Error handling email draft request:', err);
    if (err.message === 'auth required') {
      const authUrl = await emailFunctions.getEmailAuthUrl();
      shell.openExternal(authUrl);
      return { type: 'error', error: 'Authentication required. Please check your browser to complete the sign-in process.' };
    }
    return { type: 'error', error: `Failed to create email draft: ${err.message}` };
  }
}

// draft
async function sendCurrentDraft(emailFunctions) {
  try {
    if (!currentDraft) {
      return { type: 'error', error: 'No draft email to send' };
    }
    
    // validate
    if (!currentDraft.to) {
      return { type: 'error', error: 'Draft email is missing recipient' };
    }
    
    if (!currentDraft.subject) {
      try {
        const axios = require('axios');
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
        
        const prompt = `
        Generate a concise, professional subject line for this email:
        
        ${currentDraft.body}
        
        Respond with ONLY the subject line text, nothing else.
        `;
        
        const body = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            topP: 0.9,
            topK: 40
          }
        };
        
        const resp = await axios.post(url, body, { timeout: 5000 });
        const subject = resp.data.candidates[0].content.parts[0].text.trim();
        
        if (subject) {
          currentDraft.subject = subject;
        } else {
          return { type: 'error', error: 'Draft email is missing subject' };
        }
      } catch (err) {
        console.error('[email-handlers] Error generating subject:', err);
        return { type: 'error', error: 'Draft email is missing subject' };
      }
    }
    
    if (!currentDraft.body || currentDraft.body.trim() === '') {
      return { type: 'error', error: 'Draft email is missing content' };
    }
    
    // send
    await emailFunctions.sendEmail(currentDraft);
    
    // clear
    const sentDraft = {...currentDraft};
    currentDraft = null;
    
    return { 
      type: 'email-sent', 
      response: `Email sent successfully to ${sentDraft.to}`,
      email: sentDraft
    };
  } catch (err) {
    console.error('[email] Error sending draft email:', err);
    return { type: 'error', error: `Failed to send email: ${err.message}` };
  }
}

module.exports = {
  get currentDraft() { return currentDraft; },
  set currentDraft(value) { currentDraft = value; },
  get promptHistory() { return promptHistory; },
  storePromptInHistory,
  getPromptHistory,
  isEmailQuery,
  isEmailViewRequest,
  isEmailDraftRequest,
  isEmailEditRequest,
  handleEmailQuery,
  handleEmailViewRequest,
  handleEmailDraftRequest,
  updateDraftEmail,
  sendCurrentDraft,
  setupSendEmailShortcut
};