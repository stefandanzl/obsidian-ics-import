import ICAL from "ical.js";
import { moment, requestUrl } from "obsidian";
import type { IcsEvent } from "./types";
import type { CalendarConfig } from "./types";

/** Safety cap when walking a recurring series to reach the requested day. */
const MAX_OCCURRENCES = 10_000;

export async function fetchIcsText(url: string): Promise<string> {
	const response = await requestUrl({ url, method: "GET" });
	if (response.status >= 400) {
		throw new Error(`Request for calendar feed failed with status ${response.status}`);
	}
	return response.text;
}

/**
 * Parse an .ics payload and return every occurrence overlapping the given day
 * (00:00–24:00 local time), with RRULE/RDATE occurrences expanded via ical.js.
 * Multi-day events already underway on that day are included.
 */
export function parseIcsEvents(
	icsText: string,
	calendar: CalendarConfig,
	day: moment.Moment,
): IcsEvent[] {
	const root = new ICAL.Component(ICAL.parse(icsText));
	registerTimezones(root);

	const dayStart = day.clone().startOf("day");
	const dayStartMs = dayStart.valueOf();
	const dayEndMs = dayStart.clone().add(1, "day").valueOf();

	const timeFormat = moment.localeData().longDateFormat("LT");
	const events: IcsEvent[] = [];

	const vevents = root.getAllSubcomponents("vevent");
	const masterUids = new Set(
		vevents
			.filter((component) => component.getFirstProperty("recurrence-id") === null)
			.map((component) => String(component.getFirstPropertyValue("uid"))),
	);

	for (const vevent of vevents) {
		const event = new ICAL.Event(vevent as never);
		// Exceptions are covered while iterating their master; only pick up
		// orphans whose master is missing from the feed.
		if (event.isRecurrenceException() && masterUids.has(event.uid)) {
			continue;
		}
		if (String(vevent.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") {
			continue;
		}

		const push = (start: ICAL.Time, end: ICAL.Time, item: ICAL.Event, isRecurring: boolean) => {
			const range = toLocalRange(start, end);
			if (range.startMs >= dayEndMs || range.endMs <= dayStartMs) {
				return;
			}
			const startMoment = moment(range.startMs);
			const endMoment = moment(range.endMs);
			const uid = item.uid ?? "";
			events.push({
				day: dayStart.format("YYYY-MM-DD"),
				utime: range.startMs,
				time: range.isAllDay ? "" : startMoment.format(timeFormat),
				endTime: range.isAllDay ? "" : endMoment.format(timeFormat),
				icsName: calendar.name,
				summary: item.summary ?? "",
				location: item.location ?? "",
				description: item.description ?? "",
				id: isRecurring ? `${uid}@${startMoment.format("YYYY-MM-DDTHH:mm")}` : uid,
				uid,
				calendarId: calendar.id,
				isAllDay: range.isAllDay,
				isRecurring,
				endUtime: range.endMs,
				url: String(vevent.getFirstPropertyValue("url") ?? ""),
			});
		};

		if (event.isRecurring()) {
			const iterator = event.iterator(event.startDate);
			let occurrence: ICAL.Time | null;
			let count = 0;
			while ((occurrence = iterator.next()) !== null && count < MAX_OCCURRENCES) {
				const details = event.getOccurrenceDetails(occurrence);
				// Occurrences are yielded in ascending order — once one starts
				// after the requested day, no later one can overlap it.
				if (details.startDate.toJSDate().getTime() >= dayEndMs) {
					break;
				}
				if (
					String(details.item.component.getFirstPropertyValue("status") ?? "").toUpperCase() ===
					"CANCELLED"
				) {
					continue;
				}
				push(details.startDate, details.endDate, details.item, true);
				count++;
			}
		} else {
			push(event.startDate, event.endDate, event, false);
		}
	}

	return events;
}

/** Register the feed's own VTIMEZONEs so TZID references resolve correctly. */
function registerTimezones(root: ICAL.Component): void {
	for (const vtimezone of root.getAllSubcomponents("vtimezone")) {
		const tzid = String(vtimezone.getFirstPropertyValue("tzid") ?? "");
		if (tzid && !ICAL.TimezoneService.has(tzid)) {
			ICAL.TimezoneService.register(vtimezone as never, tzid);
		}
	}
}

/**
 * Convert an ICAL.Time range to local milliseconds. All-day (DATE) values are
 * interpreted as calendar dates in the user's timezone, with the RFC-5545
 * exclusive-end convention (DTEND missing or equal to DTSTART → one full day).
 */
function toLocalRange(start: ICAL.Time, end: ICAL.Time): {
	startMs: number;
	endMs: number;
	isAllDay: boolean;
} {
	if (start.isDate) {
		const startMs = moment([start.year, start.month - 1, start.day]).valueOf();
		const exclusiveEnd =
			end.isDate && end.compare(start) > 0
				? moment([end.year, end.month - 1, end.day]).valueOf()
				: startMs + 24 * 60 * 60 * 1000;
		return { startMs, endMs: exclusiveEnd, isAllDay: true };
	}
	return {
		startMs: start.toJSDate().getTime(),
		endMs: end.toJSDate().getTime(),
		isAllDay: false,
	};
}
