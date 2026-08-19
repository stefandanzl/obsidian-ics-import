/** A single remote iCalendar source. */
export interface CalendarConfig {
	/** Programmatic identifier, unique across calendars. */
	id: string;
	/** Pretty display name — surfaced to templates as `icsName`. */
	name: string;
	/** Remote .ics feed URL. */
	url: string;
	/** Whether the calendar is included when events are fetched. */
	active: boolean;
}

export interface IcsImportSettings {
	calendars: CalendarConfig[];
}

/**
 * A single calendar occurrence returned by `getEvents()`.
 *
 * The first block of fields keeps the old "ics" plugin's shape so existing
 * Templater snippets keep working; the rest are extras for richer templates.
 */
export interface IcsEvent {
	// --- drop-in compatible fields (old "ics" plugin) ---
	/** Requested day, formatted `YYYY-MM-DD`. */
	day: string;
	/** Start of the occurrence, unix milliseconds. */
	utime: number;
	/** Start time in the user's locale (e.g. "14:30"); empty for all-day events. */
	time: string;
	/** End time in the user's locale; empty for all-day events. */
	endTime: string;
	/** Display name of the calendar the event came from. */
	icsName: string;
	summary: string;
	location: string;
	description: string;

	// --- extras ---
	/** Stable id: event UID plus occurrence date for recurring events. */
	id: string;
	uid: string;
	calendarId: string;
	isAllDay: boolean;
	isRecurring: boolean;
	/** End of the occurrence, unix milliseconds. */
	endUtime: number;
	/** URL property of the event, if the feed provides one. */
	url: string;
}
