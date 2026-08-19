import { PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";
import type IcsImportPlugin from "./main";
import type { CalendarConfig, IcsImportSettings } from "./types";

export const DEFAULT_SETTINGS: IcsImportSettings = {
	calendars: [],
};

/** Composite control keys inside calendar subpages: `calendar.<id>.<field>`. */
const CALENDAR_KEY = /^calendar\.([^.]*)\.(\w+)$/;

export default class IcsImportSettingTab extends PluginSettingTab {
	declare plugin: IcsImportPlugin;

	getSettingDefinitions(): SettingDefinitionItem[] {
		const calendars = this.plugin.settings.calendars;

		return [
			{
				type: "list",
				heading: "Calendars",
				emptyState: "No calendars configured yet — add your first .ics feed to get started.",
				addItem: {
					name: "Add calendar",
					action: async () => {
						calendars.push(createCalendar(calendars));
						await this.plugin.saveSettings();
						this.update();
					},
				},
				onDelete: async (index) => {
					calendars.splice(index, 1);
					await this.plugin.saveSettings();
					this.update();
				},
				onReorder: async (oldIndex, newIndex) => {
					const [moved] = calendars.splice(oldIndex, 1);
					calendars.splice(newIndex, 0, moved);
					await this.plugin.saveSettings();
					this.update();
				},
				items: calendars.map((calendar): SettingGroupItem => ({
					type: "page",
					name: calendar.name || "Untitled calendar",
					desc: calendar.url || "No URL set",
					displayValue: () => (calendar.active ? "Active" : "Inactive"),
					items: calendarPageItems(calendar, calendars),
				})),
			},
		];
	}

	override getControlValue(key: string): unknown {
		const match = CALENDAR_KEY.exec(key);
		if (match) {
			const calendar = this.plugin.settings.calendars.find((entry) => entry.id === match[1]);
			if (calendar) {
				return calendar[match[2] as keyof CalendarConfig];
			}
		}
		return undefined;
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		const match = CALENDAR_KEY.exec(key);
		if (match) {
			const [, id, field] = match;
			const calendar = this.plugin.settings.calendars.find((entry) => entry.id === id);
			if (calendar) {
				if (field === "id" && typeof value === "string") {
					// Renaming the id: composite keys are rebuilt from it, so
					// save first, then let update() re-render with new keys.
					calendar.id = value;
				} else {
					(calendar as unknown as Record<string, unknown>)[field] = value;
				}
				await this.plugin.saveSettings();
				this.update();
			}
			return;
		}
		await super.setControlValue(key, value);
	}
}

function calendarPageItems(calendar: CalendarConfig, allCalendars: CalendarConfig[]): SettingDefinitionItem[] {
	return [
		{
			name: "Active",
			desc: "Include this calendar when fetching events",
			control: {
				type: "toggle",
				key: `calendar.${calendar.id}.active`,
				defaultValue: true,
			},
		},
		{
			name: "Name",
			desc: "Pretty display name, surfaced to templates as {{icsName}}",
			control: {
				type: "text",
				key: `calendar.${calendar.id}.name`,
				placeholder: "e.g. Work",
			},
		},
		{
			name: "ID",
			desc: "Programmatic identifier used to address this calendar in scripts",
			control: {
				type: "text",
				key: `calendar.${calendar.id}.id`,
				validate: (value: string) => {
					if (!value.trim()) {
						return "ID must not be empty";
					}
					if (allCalendars.some((entry) => entry !== calendar && entry.id === value.trim())) {
						return "Another calendar already uses this ID";
					}
				},
			},
		},
		{
			name: "iCal URL",
			desc: "Remote .ics feed address (Google/Apple/Outlook secret links work without authentication)",
			control: {
				type: "text",
				key: `calendar.${calendar.id}.url`,
				placeholder: "https://example.com/calendar.ics",
			},
		},
	];
}

function createCalendar(calendars: CalendarConfig[]): CalendarConfig {
	let index = calendars.length + 1;
	while (calendars.some((calendar) => calendar.id === `calendar-${index}`)) {
		index++;
	}
	return {
		id: `calendar-${index}`,
		name: "",
		url: "",
		active: true,
	};
}
