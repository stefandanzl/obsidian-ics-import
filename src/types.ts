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
	/** Decorative emoji prefix for this calendar's events. */
	emoji: string;
	/** Hex color (e.g. "#2962ff"); empty = no color set. */
	color: string;
}

export interface IcsImportSettings {
	calendars: CalendarConfig[];
	templates: OutputTemplate[];
}

/** How a template determines the date range it renders. */
export type TemplateDateMode = "today" | "restOfDay" | "relative" | "fixed";

/** Available sort orders for rendered events. */
export type TemplateSortMode =
	| "dateAsc"
	| "dateDesc"
	| "durationAsc"
	| "durationDesc"
	| "typeAsc"
	| "typeDesc";

/** Grouping mode for rendered events; "" = no grouping. */
export type TemplateGroupMode = "" | "calendar" | "day" | "hour" | "month";

/** A named, reusable event-list output template. */
export interface OutputTemplate {
	/** Programmatic identifier, unique across templates. */
	id: string;
	/** Pretty display name. */
	name: string;
	/** Date range selection. */
	dateMode: TemplateDateMode;
	/** relative: day offsets from today (negative = past); inclusive range. */
	fromDays: number;
	toDays: number;
	/** fixed: explicit dates as YYYY-MM-DD. */
	fromDate: string;
	toDate: string;
	sortMode: TemplateSortMode;
	/** Group events under per-group headers; "" disables grouping. */
	groupBy: TemplateGroupMode;
	/** Rendered once per group; placeholders from the calendar + {{count}}. */
	headerTemplate: string;
	/** Rendered once before all events; placeholder {{count}}. */
	outputHeaderTemplate: string;
	/** Rendered once after all events; placeholder {{count}}. */
	lastLineTemplate: string;
	/** Rendered once per event; placeholders from the event. */
	lineTemplate: string;
	/** Calendar ids to include; undefined/empty = all active calendars. */
	calendarIds?: string[];
	/** Offer an editor command that inserts the rendered list at the cursor. */
	exposeAsCommand: boolean;
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
	/** Emoji configured on the source calendar. */
	emoji: string;
	/** Hex color configured on the source calendar ("" if unset). */
	color: string;
	isAllDay: boolean;
	isRecurring: boolean;
	/** End of the occurrence, unix milliseconds. */
	endUtime: number;
	/** URL property of the event, if the feed provides one. */
	url: string;
}
