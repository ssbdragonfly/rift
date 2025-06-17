const emailSearchGemini = require('./emailSearchGemini');

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
    let emailContent;
    
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
      emailContent = await emailFunctions.getEmailContent(email.id);
    } 
    else {
      console.log(`[emailViewHandler] Searching for email with prompt: "${prompt}"`);
      const auth = await emailFunctions.ensureEmailAuth();
      const searchResult = await emailSearchGemini.findEmailsByIntent(auth, prompt);
      
      if (searchResult.count === 0) {
        return { type: 'email-view', response: `No emails found matching your request.` };
      }
      
      if (searchResult.count > 1) {
        const emailList = searchResult.emails.map((email, index) => {
          return `${index + 1}. ${email.subject}\nFrom: ${email.from}\nDate: ${email.date}\n${email.snippet}\n`;
        }).join('\n');
        
        // Store the search results in a global context for follow-up
        global.lastEmailSearchResults = searchResult.emails;
        global.lastEmailSearchPrompt = prompt;
        
        return { 
          type: 'email-search-results', 
          response: `Found ${searchResult.count} emails that might match your request:\n\n${emailList}\n\nPlease specify which email to view by number (e.g., "view email #1").`,
          followUpMode: true,
          followUpType: 'email-search'
        };
      }
      
      const email = searchResult.emails[0];
      emailContent = await emailFunctions.getEmailContent(email.id);
    }
    
    if (emailContent.error) {
      return { type: 'error', error: emailContent.error };
    }
    
    let responseAnalysis = '';
    try {
      const analysis = await emailFunctions.analyzeEmailForResponse(emailContent);
      if (analysis) {
        responseAnalysis = analysis;
      }
    }
    catch (err) {
      console.error('[emailViewHandler] Error analyzing email for response:', err);
    }
    
    const emailViewer = require('./emailViewer');
    
    if (responseAnalysis) {
      emailContent.suggestedResponse = responseAnalysis;
    }
    
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
  catch (err) {
    console.error('[emailViewHandler] Error handling email view request:', err);
    if (err.message === 'auth required') {
      const authUrl = await emailFunctions.getEmailAuthUrl();
      shell.openExternal(authUrl);
      return { type: 'error', error: 'Authentication required. Please check your browser to complete the sign-in process.' };
    }
    return { type: 'error', error: `Failed to view email: ${err.message}` };
  }
}

module.exports = {
  handleEmailViewRequest
};