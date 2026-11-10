/** The clinic's calendar day, never the browser's day or a UTC fallback. */
export function clinicToday(timezone?: string): string {
  if (!timezone) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)?.value).join('-');
  } catch { return ''; }
}

export function readableDate(value: string): string {
  // A LocalDate is not an instant: explicit UTC formatting preserves its calendar day.
  return new Intl.DateTimeFormat('es', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${value}T12:00:00Z`));
}
