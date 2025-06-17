const axios = require('axios');

async function formatEmailProfessionally(subject, body, tone = 'professional') {
  if (!process.env.GEMINI_API_KEY) {
    return { subject, body };
  }

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    
    const prompt = `
    Format this email content professionally:
    
    Subject: ${subject || '[No subject]'}
    Body: ${body || '[No body]'}
    
    Please provide a properly formatted email with:
    1. An appropriate subject line if none is provided or improve the existing one
    2. A professional greeting
    3. A clear, concise body text that conveys the message
    4. A professional closing (like "Sincerely," or "Best regards,")
    5. Tone should be: ${tone}
    
    Return as a single JSON with "subject" and "body" fields for example:
    {
      "subject": "Formatted Subject Line",
      "body": "Formatted Body Text"
    }
    `;
    
    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }]
    };
    
    const response = await axios.post(url, requestBody, { timeout: 10000 });
    const text = response.data.candidates[0].content.parts[0].text;
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const formatted = JSON.parse(jsonMatch[0]);
      return {
        subject: formatted.subject || subject,
        body: formatted.body || body
      };
    }
    
    return { subject, body };
  } catch (err) {
    console.error('[emailFormatter] Error formatting email:', err);
    return { subject, body };
  }
}

module.exports = { formatEmailProfessionally };