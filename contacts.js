const { google } = require('googleapis');

let contactsCache = null;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getContacts(auth) {
  try {
    if (contactsCache && (Date.now() - lastFetchTime < CACHE_TTL)) {
      console.log('[contacts] Using cached contacts');
      return contactsCache;
    }

    console.log('[contacts] Fetching contacts from Google');
    const people = google.people({ version: 'v1', auth });
    
    const response = await people.people.connections.list({
      resourceName: 'people/me',
      pageSize: 1000,
      personFields: 'names,emailAddresses',
    });
    
    const contacts = response.data.connections || [];
    console.log(`[contacts] Found ${contacts.length} contacts`);
    
    const processedContacts = contacts.map(contact => {
      const name = contact.names && contact.names[0] ? contact.names[0].displayName : 'Unknown';
      const emails = contact.emailAddresses ? contact.emailAddresses.map(email => email.value) : [];
      return { name, emails };
    }).filter(contact => contact.emails.length > 0);
    
    contactsCache = processedContacts;
    lastFetchTime = Date.now();
    
    return processedContacts;
  } catch (err) {
    console.error('[contacts] Error fetching contacts:', err);
    return [];
  }
}

async function findContactByName(auth, name) {
  try {
    const contacts = await getContacts(auth);
    
    const searchName = name.toLowerCase();
    
    const matchingContacts = contacts.filter(contact => 
      contact.name.toLowerCase().includes(searchName)
    );
    
    return matchingContacts;
  } catch (err) {
    console.error('[contacts] Error finding contact by name:', err);
    return [];
  }
}

async function resolveContactToEmail(auth, nameOrEmail) {
  try {
    if (nameOrEmail.includes('@')) {
      return nameOrEmail;
    }
    
    const matchingContacts = await findContactByName(auth, nameOrEmail);
    
    if (matchingContacts.length === 0) {
      console.log(`[contacts] No contact found for "${nameOrEmail}", using placeholder`);
      return `${nameOrEmail.toLowerCase()}@example.com`;
    }
    
    if (matchingContacts.length > 1) {
      console.log(`[contacts] Multiple contacts found for "${nameOrEmail}", using ${matchingContacts[0].name} (${matchingContacts[0].emails[0]})`);
    }
    
    return matchingContacts[0].emails[0];
  } catch (err) {
    console.error('[contacts] Error resolving contact to email:', err);
    return `${nameOrEmail.toLowerCase()}@example.com`;
  }
}

module.exports = {
  getContacts,
  findContactByName,
  resolveContactToEmail
};