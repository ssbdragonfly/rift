const keytar = require('keytar');
const os = require('os');

function isAuthError(err) {
  if (!err){
    return false;
  }
  
  if (err.message && (
    err.message.includes('Login Required') || 
    err.message.includes('invalid_grant') ||
    err.message.includes('auth required') ||
    err.message.includes('Invalid Credentials')
  )) {
    return true;
  }
  
  if (err.status === 401 || (err.response && err.response.status === 401)) {
    return true;
  }
  if (err.code === 401 || 
      (err.errors && err.errors.some(e => e.reason === 'authError' || e.reason === 'required'))) {
    return true;
  }
  
  return false;
}

async function clearTokensAndAuth(service, shell) {
  try {
    console.log(`[authHelper] Clearing tokens for ${service}`);
    const account = os.userInfo().username;
    await keytar.deletePassword(service, account);
    
    if (service === 'rift-google-calendar') {
      const { getAuthUrl } = require('../calendar/google');
      const authUrl = await getAuthUrl();
      if (shell) {
        shell.openExternal(authUrl);
        return true;
      }
    } 
    else if (service === 'rift-google-email') {
      const { getEmailAuthUrl } = require('../email/email');
      const authUrl = await getEmailAuthUrl();
      if (shell) {
        shell.openExternal(authUrl);
        return true;
      }
    }
    
    return false;
  }
  catch (err) {
    console.error(`[authHelper] Error clearing tokens for ${service}:`, err);
    return false;
  }
}

module.exports = {
  isAuthError,
  clearTokensAndAuth
};