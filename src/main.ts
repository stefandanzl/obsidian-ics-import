import { Plugin, moment } from "obsidian";
import { fetchIcsText, parseIcsEvents } from "./ical";
import IcsImportSettingTab from "./settings";
import type { IcsEvent, IcsImportSettings } from "./types";

/** Global API exposed as `window.icsImport` while the plugin is loaded. */
export interface IcsImportGlobalApi {
	/** All events overlapping the given day across all active calendars. */
	getEvents: (day?: string | number | Date | moment.Moment) => Promise<IcsEvent[]>;
}

export default class IcsImportPlugin extends Plugin {
	declare settings: IcsImportSettings;

	async onload(): Promise<void> {
		this.settings = Object.assign({}, await this.loadData());
		if (!Array.isArray(this.settings.calendars)) {
			this.settings.calendars = [];
		}

		this.addSettingTab(new IcsImportSettingTab(this.app, this));

		const api: IcsImportGlobalApi = {
			getEvents: (day) => this.getEvents(day),
		};
		const globalScope = globalThis as unknown as Record<string, unknown>;
		// globalThis === window in the app's main context, but going through
		// globalThis also covers sandboxed evaluation environments where
		// `window` may resolve to a different realm.
		globalScope.icsImport = api;
		this.register(() => {
			delete globalScope.icsImport;
		});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * All events overlapping the given day, sorted ascending by start time.
	 *
	 * Drop-in replacement for the old "ics" plugin's `getEvents(date)` — the
	 * returned events keep the legacy field names (`time`, `utime`, `icsName`,
	 * `summary`, `location`). An empty/invalid argument defaults to today.
	 */
	async getEvents(day?: string | number | Date | moment.Moment): Promise<IcsEvent[]> {
		const requested = day ? moment(day) : moment();
		if (!requested.isValid()) {
			console.warn(`[ics-import] getEvents received an invalid date (${day}), defaulting to today`);
		}
		const targetDay = requested.isValid() ? requested : moment();

		const activeCalendars = this.settings.calendars.filter((calendar) => calendar.active && calendar.url);
		const results = await Promise.all(
			activeCalendars.map(async (calendar) => {
				try {
					const icsText = await fetchIcsText(calendar.url);
					return parseIcsEvents(icsText, calendar, targetDay);
				} catch (error) {
					console.warn(`[ics-import] failed to load calendar "${calendar.name}" (${calendar.url})`, error);
					return [] as IcsEvent[];
				}
			}),
		);

		return results.flat().sort((a, b) => a.utime - b.utime);
	}
}
