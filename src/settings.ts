import { Notice, PluginSettingTab, Setting, SettingPage } from "obsidian";
import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";
import type IcsImportPlugin from "./main";
import type { CalendarConfig, IcsImportSettings } from "./types";

export const DEFAULT_SETTINGS: IcsImportSettings = {
	calendars: [],
};

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
						const calendar = createCalendar(calendars);
						calendars.push(calendar);
						await this.plugin.saveSettings();
						this.update();
						this.openCalendarPage(calendar);
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
					page: () => new CalendarPage(this, calendar),
				})),
			},
		];
	}

	/**
	 * Navigate into a calendar's submenu after it was added. The declarative
	 * API has no programmatic navigation, so simulate a click on the rendered
	 * page row.
	 */
	private openCalendarPage(calendar: CalendarConfig): void {
		const attempt = (retry: boolean): void => {
			const rows = Array.from(this.containerEl.querySelectorAll<HTMLElement>(".setting-item"));
			const row = rows.reverse().find((el) => el.textContent?.includes(calendar.name));
			if (row) {
				row.click();
			} else if (retry) {
				window.requestAnimationFrame(() => attempt(false));
			}
		};
		attempt(true);
	}
}

/**
 * Slide-out sub-page editing one calendar, built imperatively (docs:
 * "Imperative pages"). Changes save immediately; `hide()` rebuilds the tab
 * so the calendar list reflects the edits once the user leaves the page.
 */
class CalendarPage extends SettingPage {
	private dirty = false;

	constructor(
		private readonly tab: IcsImportSettingTab,
		private readonly calendar: CalendarConfig,
	) {
		super();
	}

	display(): void {
		this.containerEl.empty();

		const calendars = this.tab.plugin.settings.calendars;
		if (!calendars.includes(this.calendar)) {
			this.title = "Deleted calendar";
			this.containerEl.createEl("p", {
				text: "This calendar has been deleted. Use the back button to return to the list.",
			});
			return;
		}
		this.title = this.calendar.name || "Untitled calendar";

		const save = async (): Promise<void> => {
			this.dirty = true;
			await this.tab.plugin.saveSettings();
		};

		new Setting(this.containerEl)
			.setName("Name")
			.setDesc("Pretty display name, surfaced to templates as icsName")
			.addText((text) =>
				text
					.setPlaceholder("e.g. Work")
					.setValue(this.calendar.name)
					.onChange((value) => {
						this.calendar.name = value;
						this.title = value || "Untitled calendar";
						void save();
					}),
			);

		new Setting(this.containerEl)
			.setName("ID")
			.setDesc("Programmatic identifier used to address this calendar in scripts")
			.addText((text) =>
				text.setValue(this.calendar.id).onChange((value) => {
					const invalid =
						value.trim() === "" ||
						calendars.some((entry) => entry !== this.calendar && entry.id === value.trim());
					if (invalid) {
						new Notice("Calendar IDs must be non-empty and unique");
					}
					this.calendar.id = value;
					void save();
				}),
			);

		new Setting(this.containerEl)
			.setName("iCal URL")
			.setDesc("Remote .ics feed address (Google/Apple/Outlook secret links work without authentication)")
			.addText((text) =>
				text
					.setPlaceholder("https://example.com/calendar.ics")
					.setValue(this.calendar.url)
					.onChange((value) => {
						this.calendar.url = value;
						void save();
					}),
			);

		new Setting(this.containerEl)
			.setName("Active")
			.setDesc("Include this calendar when fetching events")
			.addToggle((toggle) =>
				toggle.setValue(this.calendar.active).onChange((value) => {
					this.calendar.active = value;
					void save();
				}),
			);

		new Setting(this.containerEl)
			.setName("Delete this calendar")
			.setDesc("Remove the calendar and all of its settings")
			.addButton((button) => {
				button
					.setButtonText("Delete")
					.setIcon("trash-2")
					.setTooltip("Delete this calendar")
					.onClick(async () => {
						const index = calendars.indexOf(this.calendar);
						if (index !== -1) {
							calendars.splice(index, 1);
						}
						this.dirty = false;
						await this.tab.plugin.saveSettings();
						this.tab.update();
						this.display();
					});
				button.buttonEl.addClass("mod-warning");
			});
	}

	override hide(): void {
		// Fires when the user navigates away from the page (docs: SettingPage).
		// Rebuild the tab now so the calendar list shows the edited names —
		// doing this earlier would destroy the input mid-typing.
		if (this.dirty) {
			this.dirty = false;
			this.tab.update();
		}
	}
}

function createCalendar(calendars: CalendarConfig[]): CalendarConfig {
	let index = calendars.length + 1;
	while (calendars.some((calendar) => calendar.id === `calendar-${index}`)) {
		index++;
	}
	return {
		id: `calendar-${index}`,
		// Prefilled so page names stay unique (required for navigation);
		// duplicates are warned about on edit.
		name: `New calendar ${index}`,
		url: "",
		active: true,
	};
}
