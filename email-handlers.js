let currentDraft = null;
let promptHistory = [];
const MAX_HISTORY = 10;
let sendEmailCallback = null;

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

function isEmailQuery(prompt) {
  const isQuery = /\b(email|emails|mail|inbox|unread|message|messages)\b/i.test(prompt) && 
                 (/\b(show|list|get|check|view|read|any|new|unread|recent)\b/i.test(prompt) || 
                  prompt.toLowerCase().includes('unread email'));
  
  console.log('[email-handlers] isEmailQuery check:', prompt, '->', isQuery);
  return isQuery;
}

function isEmailViewRequest(prompt) {
  return /\b(view|read|open|show)\s+(email|mail|message)\b/i.test(prompt) && 
         /\b(id|number|#)\b/i.test(prompt);
}

function isEmailDraftRequest(prompt) {
  return /\b(draft|write|compose|create|send)\s+(email|mail|message)\b/i.test(prompt) ||
         /\b(email|mail|message)\s+(to|for)\b/i.test(prompt);
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
    
    console.log('[email-handlers] Getting unread emails');
    const result = await emailFunctions.getUnreadEmails(10);
    
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
          response: `You have ${result.count} unread email(s):\n\n${summarized.summary}` 
        };
      }
    } catch (err) {
      console.error('[email] Error summarizing emails:', err);
    }
    
    console.log('[email-handlers] Using standard email format');
    
    return { 
      type: 'email-unread', 
      response: `You have ${result.count} unread email(s):\n\n${emailList}` 
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
    
    const match = prompt.match(/\b(id|number|#)\s*(\d+)\b/i);
    if (!match) {
      return { type: 'chat', response: 'Please specify which email you want to view by number (e.g., "view email #2").' };
    }
    
    const emailNumber = parseInt(match[2]);
    
    await emailFunctions.ensureEmailAuth(win);
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
    
    const formattedEmail = `
Subject: ${emailContent.subject}
From: ${emailContent.from}
To: ${emailContent.to}
Date: ${emailContent.date}

${emailContent.body}${responseAnalysis}
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

function isEmailEditRequest(prompt) {
  return /\b(edit|update|change|modify)\s+(email|draft|message)\b/i.test(prompt) ||
         /\b(add|change|update|set)\s+(recipient|to|subject|body|content)\b/i.test(prompt);
}

async function updateDraftEmail(prompt) {
  if (!currentDraft) {
    return { 
      type: 'error', 
      error: 'No draft email to edit. Create a draft first with "write an email to someone@example.com"' 
    };
  }
  
  const toMatch = prompt.match(/\b(?:to|recipient|address)\s+([^\s@]+@[^\s@]+\.[^\s@]+)/i);
  if (toMatch) {
    currentDraft.to = toMatch[1];
  }
  
  const subjectMatch = prompt.match(/\b(?:subject|about|regarding|titled)\s+["']([^"']+)["']/i);
  if (subjectMatch) {
    currentDraft.subject = subjectMatch[1];
  } else {
    const altSubjectMatch = prompt.match(/\b(?:subject|about|regarding|titled)\s+([^,.]+?)(?:\s+saying|\s+with|,|\.|$)/i);
    if (altSubjectMatch) {
      currentDraft.subject = altSubjectMatch[1].trim();
    }
  }
  
  const bodyMatch = prompt.match(/\b(?:body|content|message|saying)\s+["']([^"']+)["']/i);
  if (bodyMatch) {
    currentDraft.body = bodyMatch[1];
  } else if (prompt.includes('saying')) {
    const sayingMatch = prompt.match(/\b(?:saying|that says)\s+(.+?)(?:\.|\s+to\s+|\s+with\s+|$)/i);
    if (sayingMatch) {
      currentDraft.body = sayingMatch[1].trim();
    }
  }
  
  let response = '**Email draft updated.** Press Cmd+Y to send it.\n\n';
  response += `**From:** ${currentDraft.from}\n`;
  response += `**To:** ${currentDraft.to || '[Please specify recipient]'}\n`;
  response += `**Subject:** ${currentDraft.subject || '[Please specify subject]'}\n\n`;
  response += currentDraft.body || '[Please specify email content]';
  
  return { 
    type: 'email-draft', 
    response, 
    draft: currentDraft,
    showSendButton: true
  };
}

async function handleEmailDraftRequest(prompt, emailFunctions, shell, win) {
  try {
    if (currentDraft && isEmailEditRequest(prompt)) {
      return await updateDraftEmail(prompt);
    }
    
    const isValid = await emailFunctions.validateEmailAuth();
    if (!isValid) {
      const authUrl = await emailFunctions.getEmailAuthUrl();
      shell.openExternal(authUrl);
      return { type: 'error', error: 'Email authentication required. Please check your browser to complete the sign-in process.' };
    }
    
    await emailFunctions.ensureEmailAuth(win);
    const userEmail = await emailFunctions.getUserEmail();
    
    let recipient = '';
    const toMatch = prompt.match(/\b(?:to|for)\s+([^\s@]+@[^\s@]+\.[^\s@]+)/i);
    if (toMatch) {
      recipient = toMatch[1];
    }
    let subject = '';
    const subjectMatch = prompt.match(/\b(?:subject|about|regarding|titled)\s+["']([^"']+)["']/i);
    if (subjectMatch) {
      subject = subjectMatch[1];
    } else {
      const altSubjectMatch = prompt.match(/\b(?:subject|about|regarding|titled)\s+([^,.]+?)(?:\s+saying|\s+with|,|\.|$)/i);
      if (altSubjectMatch) {
        subject = altSubjectMatch[1].trim();
      }
    }
    
    let body = '';
    const bodyMatch = prompt.match(/\b(?:body|content|message|saying)\s+["']([^"']+)["']/i);
    if (bodyMatch) {
      body = bodyMatch[1];
    } else if (prompt.includes('saying')) {
      const sayingMatch = prompt.match(/\b(?:saying|that says)\s+(.+?)(?:\.|\s+to\s+|\s+with\s+|$)/i);
      if (sayingMatch) {
        body = sayingMatch[1].trim();
      }
    }
    
    // create draft
    const draft = {
      from: userEmail,
      to: recipient || '',
      subject: subject || '',
      body: body || ''
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
      return { type: 'error', error: 'Draft email is missing subject' };
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
  currentDraft,
  promptHistory,
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