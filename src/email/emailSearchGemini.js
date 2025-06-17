const { google } = require('googleapis');
const axios = require('axios');

async function findEmailsByIntent(auth, prompt) {
  try {
    console.log(`[emailSearchGemini] Processing search intent: "${prompt}"`);
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread in:inbox',
      maxResults: 50
    });
    
    const messages = res.data.messages || [];
    console.log(`[emailSearchGemini] Found ${messages.length} unread messages to search through`);
    
    if (messages.length === 0) {
      return { emails: [], count: 0 };
    }
    
    const emails = [];
    const batchSize = 10;
    
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (message) => {
          try {
            const details = await gmail.users.messages.get({
              userId: 'me',
              id: message.id,
              format: 'metadata',
              metadataHeaders: ['From', 'Subject', 'Date']
            });
            
            const headers = details.data.payload.headers;
            const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
            const from = headers.find(h => h.name === 'From')?.value || '';
            const date = headers.find(h => h.name === 'Date')?.value || '';
            
            return {
              id: message.id,
              threadId: message.threadId,
              subject,
              from,
              date: new Date(date).toLocaleString(),
              snippet: details.data.snippet
            };
          } catch (err) {
            console.error(`[emailSearchGemini] Error fetching email ${message.id}:`, err);
            return null;
          }
        })
      );
      
      const validResults = batchResults.filter(email => email !== null);
      emails.push(...validResults);
    }
    
    if (emails.length > 0 && process.env.GEMINI_API_KEY) {
      const emailsText = emails.map((email, i) => 
        `Email ${i+1}:\nFrom: ${email.from}\nSubject: ${email.subject}\nSnippet: ${email.snippet}`
      ).join('\n\n');
      
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
      
      const geminiPrompt = `
      Based on the user's request: "${prompt}"
      
      Find the most relevant email(s) from this list:
      ${emailsText}
      
      Return a JSON array with the indices of the relevant emails (starting from 1).
      For example: [1, 3] means the 1st and 3rd emails are relevant.
      If no emails match, return an empty array: []
      Only return the JSON array, nothing else.
      `;
      
      const body = {
        contents: [{ parts: [{ text: geminiPrompt }] }]
      };
      
      const resp = await axios.post(url, body, { timeout: 10000 });
      const text = resp.data.candidates[0].content.parts[0].text.trim();
      
      try {
        const jsonMatch = text.match(/\[.*\]/);
        if (jsonMatch) {
          const indices = JSON.parse(jsonMatch[0]);
          
          if (indices.length === 0) {
            return { emails: [], count: 0 };
          }
          
          const relevantEmails = indices
            .map(idx => emails[idx - 1])
            .filter(email => email !== undefined);
          
          return { 
            emails: relevantEmails,
            count: relevantEmails.length
          };
        }
      }
      catch (err) {
        console.error('[emailSearchGemini] Error parsing Gemini response:', err);
      }
    }
    
    return { 
      emails,
      count: emails.length
    };
  }
  catch (err) {
    console.error('[emailSearchGemini] Error searching emails:', err);
    throw err;
  }
}

module.exports = {
  findEmailsByIntent
};