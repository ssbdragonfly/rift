require('dotenv').config();
const { google } = require('googleapis');
const { ensureDriveAuth } = require('../drive/google');

const DOCS_MIME_TYPE = 'application/vnd.google-apps.document';

async function createGoogleDoc(title, content = '') {
  try {
    const auth = await ensureDriveAuth();
    const drive = google.drive({ version: 'v3', auth });
    const docs = google.docs({ version: 'v1', auth });
    const fileMetadata = {
      name: title,
      mimeType: DOCS_MIME_TYPE
    };
    
    const file = await drive.files.create({
      resource: fileMetadata,
      fields: 'id'
    });
    
    const documentId = file.data.id;
    if (content) {
      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: {
                  index: 1
                },
                text: content
              }
            }
          ]
        }
      });
    }
    
    const document = await docs.documents.get({
      documentId
    });
    const fileDetails = await drive.files.get({
      fileId: documentId,
      fields: 'webViewLink'
    });
    
    return {
      id: documentId,
      title: document.data.title,
      webViewLink: fileDetails.data.webViewLink
    };
  } catch (err) {
    console.error('[docs] Error creating Google Doc:', err);
    throw err;
  }
}

async function getGoogleDoc(documentId) {
  try {
    const auth = await ensureDriveAuth();
    const docs = google.docs({ version: 'v1', auth });
    const drive = google.drive({ version: 'v3', auth });
    const document = await docs.documents.get({
      documentId
    });
    
    const fileDetails = await drive.files.get({
      fileId: documentId,
      fields: 'webViewLink'
    });
    
    return {
      id: documentId,
      title: document.data.title,
      content: document.data.body.content,
      webViewLink: fileDetails.data.webViewLink
    };
  } catch (err) {
    console.error('[docs] Error getting Google Doc:', err);
    throw err;
  }
}

async function updateGoogleDoc(documentId, content) {
  try {
    const auth = await ensureDriveAuth();
    const docs = google.docs({ version: 'v1', auth });
    const document = await docs.documents.get({
      documentId
    });
    
    const response = await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: {
                index: document.data.body.content[document.data.body.content.length - 1].endIndex - 1
              },
              text: '\n' + content
            }
          }
        ]
      }
    });
    
    return response.data;
  } catch (err) {
    console.error('[docs] Error updating Google Doc:', err);
    throw err;
  }
}

async function searchGoogleDocs(query, maxResults = 10) {
  try {
    const auth = await ensureDriveAuth();
    const drive = google.drive({ version: 'v3', auth });
    
    const q = `name contains '${query}' and mimeType = '${DOCS_MIME_TYPE}' and trashed = false`;
    
    const response = await drive.files.list({
      q,
      fields: 'files(id, name, webViewLink, createdTime, modifiedTime)',
      spaces: 'drive',
      pageSize: maxResults
    });
    
    return response.data.files;
  } catch (err) {
    console.error('[docs] Error searching Google Docs:', err);
    throw err;
  }
}

async function shareGoogleDoc(documentId, emailAddress, role = 'reader') {
  try {
    const auth = await ensureDriveAuth();
    const drive = google.drive({ version: 'v3', auth });
    
    const response = await drive.permissions.create({
      fileId: documentId,
      requestBody: {
        type: 'user',
        role,
        emailAddress
      },
      fields: 'id'
    });
    
    return response.data;
  } catch (err) {
    console.error('[docs] Error sharing Google Doc:', err);
    throw err;
  }
}

module.exports = {
  createGoogleDoc,
  getGoogleDoc,
  updateGoogleDoc,
  searchGoogleDocs,
  shareGoogleDoc
};