// Fixture C4: fetch POSTing kidFirstName to non-allowlisted host
async function trackKidEvent(kidFirstName: string, eventType: string) {
  await fetch('https://analytics.third-party.com/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kidFirstName,
      event: eventType,
      timestamp: Date.now(),
    }),
  });
}
