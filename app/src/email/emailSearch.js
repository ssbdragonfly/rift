const { google } = require('googleapis');

async function findEmailsBySubjectOrSender(auth, searchTerm) {
  try {
    const gmail = google.gmail({ version: 'v1', auth });
    const query = `is:unread in:inbox (subject:${searchTerm} OR from:${searchTerm})`;
    
    console.log(`[emailSearch] Searching for emails with query: ${query}`);
    
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 10
    });
    
    const messages = res.data.messages || [];
    console.log(`[emailSearch] Found ${messages.length} matching emails`);
    
    if (messages.length === 0) {
      return { emails: [], count: 0 };
    }
    
    const emails = [];
    const batchSize = 5;
    
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
            console.error(`[emailSearch] Error fetching email ${message.id}:`, err);
            return null;
          }
        })
      );
      
      const validResults = batchResults.filter(email => email !== null);
      emails.push(...validResults);
    }
    
    return { 
      emails,
      count: emails.length
    };
  } catch (err) {
    console.error('[emailSearch] Error searching emails:', err);
    throw err;
  }
}

module.exports = {
  findEmailsBySubjectOrSender
};