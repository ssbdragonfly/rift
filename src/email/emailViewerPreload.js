const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('emailViewer', {
  getCurrentEmail: () => ipcRenderer.invoke('get-current-email'),
  replyToEmail: (replyData) => ipcRenderer.invoke('reply-to-email', replyData),
  onDisplayEmail: (callback) => {
    ipcRenderer.on('display-email', (event, email) => callback(email));
  },
  openExternal: (url) => shell.openExternal(url)
});