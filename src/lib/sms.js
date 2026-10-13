// Pluggable SMS sender. Configure SMS_API_URL + SMS_API_KEY for your gateway
// (e.g. Africa's Talking / Twilio). Without them it only logs, so nothing breaks in development.
async function sendSms(to, text) {
  if (!to) return false;
  if (!process.env.SMS_API_URL) {
    console.log(`[SMS stub] to=${to}: ${text}`);
    return true;
  }
  try {
    const r = await fetch(process.env.SMS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SMS_API_KEY || ''}` },
      body: JSON.stringify({ to, message: text }),
    });
    return r.ok;
  } catch (e) {
    console.error('SMS failed', e.message);
    return false;
  }
}
module.exports = { sendSms };
