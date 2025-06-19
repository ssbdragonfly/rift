const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let viewerWindow = null;
let currentEmail = null;

function createEmailViewerWindow() {
  if (viewerWindow && !viewerWindow.isDestroyed()) {
    viewerWindow.focus();
    return viewerWindow;
  }

  viewerWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'emailViewerPreload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    title: 'Email Viewer'
  });

  viewerWindow.loadFile(path.join(__dirname, '../ui/emailViewer.html'));
  
  viewerWindow.on('closed', () => {
    viewerWindow = null;
  });

  return viewerWindow;
}

function setupEmailViewerHandlers(emailFunctions) {
  ipcMain.handle('get-current-email', () => {
    return currentEmail;
  });

  ipcMain.handle('reply-to-email', async (event, replyData) => {
    try {
      if (!currentEmail) {
        return { success: false, error: 'No email to reply to' };
      }

      const userEmail = await emailFunctions.getUserEmail();
      const draft = {
        from: userEmail,
        to: currentEmail.from.replace(/.*<(.*)>/, '$1').trim(),
        subject: currentEmail.subject.startsWith('Re:') ? currentEmail.subject : `Re: ${currentEmail.subject}`,
        body: replyData.body,
        inReplyTo: currentEmail.id,
        references: currentEmail.threadId
      };

      await emailFunctions.sendEmail(draft);
      return { success: true };
    } catch (err) {
      console.error('[emailViewer] Error sending reply:', err);
      return { success: false, error: err.message };
    }
  });
}

function showEmail(email) {
  currentEmail = email;
  
  if (!viewerWindow || viewerWindow.isDestroyed()) {
    createEmailViewerWindow();
  }
  else {
    viewerWindow.focus();
  }
  
  viewerWindow.webContents.once('did-finish-load', () => {
    viewerWindow.webContents.send('display-email', email);
  });
}

module.exports = {
  createEmailViewerWindow,
  setupEmailViewerHandlers,
  showEmail
};