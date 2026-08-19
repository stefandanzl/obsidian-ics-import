import { moment } from "obsidian";
import type { CalendarConfig, IcsEvent, OutputTemplate, TemplateSortMode } from "./types";

/** Upper bound so a typo in a fixed/relative range can't hang the renderer. */
const MAX_DAYS = 366;

/**
 * Resolve a template's date range to the list of days it covers (each a
 * moment at local midnight). "today" (the default) and "restOfDay" are a
 * single day; today's 00:00–24:00 (restOfDay additionally drops events
 * that already ended — see renderTemplateOutput). Empty or invalid fixed
 * dates fall back to today.
 */
export function resolveTemplateDays(template: OutputTemplate): moment.Moment[] {
	const today = moment().startOf("day");
	let from = today.clone();
	let to = today.clone();

	if (template.dateMode === "relative") {
		from = today.clone().add(template.fromDays || 0, "day");
		to = today.clone().add(template.toDays || 0, "day");
	} else if (template.dateMode === "fixed") {
		const fromDate = moment(template.fromDate ?? "", "YYYY-MM-DD");
		const toDate = moment(template.toDate ?? "", "YYYY-MM-DD");
		if (fromDate.isValid()) {
			from = fromDate.startOf("day");
		}
		if (toDate.isValid()) {
			to = toDate.startOf("day");
		}
	}

	if (to.isBefore(from)) {
		[from, to] = [to, from];
	}

	const days: moment.Moment[] = [];
	for (let day = from.clone(); day.isSameOrBefore(to) && days.length < MAX_DAYS; day.add(1, "day")) {
		days.push(day.clone());
	}
	return days;
}

/** Sort a copy of `events` according to the template's sort mode. */
export function sortEvents(events: IcsEvent[], mode: TemplateSortMode): IcsEvent[] {
	const duration = (event: IcsEvent): number => event.endUtime - event.utime;
	const byType = (a: IcsEvent, b: IcsEvent): number =>
		Number(b.isAllDay) - Number(a.isAllDay) || a.utime - b.utime;

	const comparators: Record<TemplateSortMode, (a: IcsEvent, b: IcsEvent) => number> = {
		dateAsc: (a, b) => a.utime - b.utime,
		dateDesc: (a, b) => b.utime - a.utime,
		durationAsc: (a, b) => duration(a) - duration(b) || a.utime - b.utime,
		durationDesc: (a, b) => duration(b) - duration(a) || a.utime - b.utime,
		typeAsc: byType,
		typeDesc: (a, b) => byType(b, a),
	};

	return [...events].sort(comparators[mode] ?? comparators.dateAsc);
}

/**
 * Render a template's events into the accumulated output string: one line
 * block per event (and one header per calendar when grouping is enabled).
 */
export function renderTemplateOutput(
	template: OutputTemplate,
	events: IcsEvent[],
	calendars: CalendarConfig[],
): string {
	const included = events.filter(
		(event) => !template.calendarIds?.length || template.calendarIds.includes(event.calendarId),
	);
	let sorted = sortEvents(included, template.sortMode);
	if (template.dateMode === "restOfDay") {
		// Keep only events that haven't ended yet (ongoing ones included).
		const now = moment().valueOf();
		sorted = sorted.filter((event) => event.endUtime > now);
	}
	const frameContext = { count: sorted.length };

	let body: string;
	if (!template.groupBy) {
		body = sorted.map((event) => renderPlaceholders(template.lineTemplate, event)).join("\n");
	} else {
		const blocks: string[] = [];
		// An empty header template adds no separator line between groups —
		// the groups' event lines simply follow each other.
		const pushGroup = (context: Record<string, unknown>, group: IcsEvent[]): void => {
			const header = renderPlaceholders(template.headerTemplate ?? "", context);
			if (header.trim() !== "") {
				blocks.push(header);
			}
			blocks.push(...group.map((event) => renderPlaceholders(template.lineTemplate, event)));
		};

		if (template.groupBy === "calendar") {
			for (const calendar of calendars) {
				const group = sorted.filter((event) => event.calendarId === calendar.id);
				if (group.length) {
					pushGroup(
						{
							icsName: calendar.name,
							emoji: calendar.emoji,
							color: calendar.color,
							count: group.length,
						},
						group,
					);
				}
			}
		} else {
			// day/hour/month buckets, always ordered chronologically; the
			// template's sort mode still applies within each bucket.
			const buckets = new Map<string, { startMs: number; events: IcsEvent[] }>();
			for (const event of sorted) {
				const start = moment(event.utime);
				if (template.groupBy === "day") {
					start.startOf("day");
				} else if (template.groupBy === "month") {
					start.startOf("month");
				} else {
					start.startOf("hour");
				}
				const key = String(start.valueOf());
				const bucket = buckets.get(key) ?? { startMs: start.valueOf(), events: [] };
				bucket.events.push(event);
				buckets.set(key, bucket);
			}
			for (const bucket of [...buckets.values()].sort((a, b) => a.startMs - b.startMs)) {
				pushGroup(
					{
						utime: bucket.startMs,
						day: moment(bucket.startMs).format("YYYY-MM-DD"),
						count: bucket.events.length,
					},
					bucket.events,
				);
			}
		}
		body = blocks.join("\n");
	}

	// Frame blocks are joined with the body by single newlines; an empty
	// template contributes nothing. A last line of just "\n" therefore adds
	// one blank line after the events, "\n\n" two.
	const parts: string[] = [];
	const outputHeader = renderPlaceholders(template.outputHeaderTemplate ?? "", frameContext);
	if (outputHeader !== "") {
		parts.push(outputHeader);
	}
	parts.push(body);
	if ((template.lastLineTemplate ?? "") !== "") {
		parts.push(renderPlaceholders(template.lastLineTemplate, frameContext));
	}
	return parts.join("\n");
}

/**
 * Replace `{{field}}` placeholders; unknown fields render as empty strings.
 * `{{date:FORMAT}}` / `{{endDate:FORMAT}}` render the occurrence's start/end
 * with any moment.js format tokens (`{{date}}` defaults to YYYY-MM-DD).
 */
function renderPlaceholders(template: string, context: object): string {
	const fields = context as Record<string, unknown>;
	return template.replace(
		/\{\{\s*(\w+)(?::([^{}]*))?\s*\}\}/g,
		(_, key: string, format?: string) => {
			if (key === "date" || key === "endDate") {
				const ms = key === "date" ? fields.utime : fields.endUtime;
				return typeof ms === "number" ? moment(ms).format(format ?? "YYYY-MM-DD") : "";
			}
			const value = fields[key];
			return value === undefined || value === null ? "" : String(value);
		},
	);
}
