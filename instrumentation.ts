export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'development') {
    const globalForCron = globalThis as unknown as { __localSavingsCronStarted?: boolean };
    if (globalForCron.__localSavingsCronStarted) return;
    globalForCron.__localSavingsCronStarted = true;

    console.log('⏰ [Local Development] Automated Savings Reminder Cron Scheduler initialized (Interval: 60s)');

    setInterval(async () => {
      try {
        const port = process.env.PORT || 3000;
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${port}`;
        
        const response = await fetch(`${baseUrl}/api/cron/savings-reminder`, {
          headers: {
            'x-local-dev-cron': 'true'
          }
        });

        if (!response.ok) {
          console.error(`❌ [Local Dev Cron] Response error status: ${response.status}`);
          return;
        }

        const result = (await response.json()) as { count?: number; dispatched?: any[] };
        if (result && typeof result.count === 'number' && result.count > 0) {
          console.log(`⏰ [Local Dev Cron] Dispatched ${result.count} WhatsApp reminders at ${new Date().toLocaleTimeString('id-ID')}`);
        }
      } catch (err) {
        console.error('❌ [Local Dev Cron] Network or internal error during reminder execution:', err);
      }
    }, 60000);
  }
}
