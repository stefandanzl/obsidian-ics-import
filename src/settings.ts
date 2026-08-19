import { Notice, PluginSettingTab, Setting, SettingPage } from "obsidian";
import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";
import type IcsImportPlugin from "./main";
import type { CalendarConfig, IcsImportSettings, OutputTemplate } from "./types";
import type { TemplateDateMode, TemplateSortMode } from "./types";

export const DEFAULT_SETTINGS: IcsImportSettings = {
	calendars: [],
	templates: [],
};

const DATE_MODE_LABELS: Record<TemplateDateMode, string> = {
	today: "Today only",
	relative: "Relative to today",
	fixed: "Fixed dates",
};

const SORT_MODE_LABELS: Record<TemplateSortMode, string> = {
	dateAsc: "Date ascending",
	dateDesc: "Date descending",
	durationAsc: "Duration ascending",
	durationDesc: "Duration descending",
	typeAsc: "All-day first",
	typeDesc: "All-day last",
};

export default class IcsImportSettingTab extends PluginSettingTab {
	declare plugin: IcsImportPlugin;

	getSettingDefinitions(): SettingDefinitionItem[] {
		const calendars = this.plugin.settings.calendars;
		const templates = this.plugin.settings.templates;

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
						this.openPageRow(calendar.name);
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
					name: calendarLabel(calendar),
					desc: calendar.url || "No URL set",
					displayValue: () => (calendar.active ? "Active" : "Inactive"),
					page: () => new CalendarPage(this, calendar),
				})),
			},
			{
				type: "list",
				heading: "Output templates",
				emptyState: "No output templates yet — add one to render event lists into your notes.",
				addItem: {
					name: "Add template",
					action: async () => {
						const template = createTemplate(templates);
						templates.push(template);
						await this.plugin.saveSettings();
						this.update();
						this.openPageRow(template.name);
					},
				},
				onDelete: async (index) => {
					templates.splice(index, 1);
					await this.plugin.saveSettings();
					this.plugin.syncTemplateCommands();
					this.update();
				},
				onReorder: async (oldIndex, newIndex) => {
					const [moved] = templates.splice(oldIndex, 1);
					templates.splice(newIndex, 0, moved);
					await this.plugin.saveSettings();
					this.update();
				},
				items: templates.map((template): SettingGroupItem => ({
					type: "page",
					name: template.name || "Untitled template",
					desc: `${DATE_MODE_LABELS[template.dateMode]} · ${SORT_MODE_LABELS[template.sortMode]}`,
					displayValue: () => (template.exposeAsCommand ? "Command" : ""),
					page: () => new TemplatePage(this, template),
				})),
			},
		];
	}

	/**
	 * Navigate into a newly added entry's submenu. The declarative API has no
	 * programmatic navigation, so simulate a click on the rendered page row.
	 */
	private openPageRow(label: string): void {
		const attempt = (retry: boolean): void => {
			const rows = Array.from(this.containerEl.querySelectorAll<HTMLElement>(".setting-item"));
			const row = rows.reverse().find((el) => el.textContent?.includes(label));
			if (row) {
				row.click();
			} else if (retry) {
				window.requestAnimationFrame(() => attempt(false));
			}
		};
		attempt(true);
	}
}

/** Common save-and-refresh bookkeeping for imperative sub-pages. */
abstract class DirtyPage extends SettingPage {
	protected dirty = false;

	constructor(protected readonly tab: IcsImportSettingTab) {
		super();
	}

	protected async save(): Promise<void> {
		this.dirty = true;
		await this.tab.plugin.saveSettings();
	}

	override hide(): void {
		// Fires when the user navigates away from the page (docs: SettingPage).
		// Rebuild the tab now so the parent lists show the edited labels —
		// doing this earlier would destroy the input mid-typing.
		if (this.dirty) {
			this.dirty = false;
			this.tab.update();
		}
	}
}

/**
 * Slide-out sub-page editing one calendar, built imperatively (docs:
 * "Imperative pages"). Changes save immediately.
 */
class CalendarPage extends DirtyPage {
	constructor(tab: IcsImportSettingTab, private readonly calendar: CalendarConfig) {
		super(tab);
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
		this.title = calendarLabel(this.calendar);

		new Setting(this.containerEl)
			.setName("Name")
			.setDesc("Pretty display name, surfaced to templates as {{icsName}}")
			.addText((text) =>
				text
					.setPlaceholder("e.g. Work")
					.setValue(this.calendar.name)
					.onChange((value) => {
						this.calendar.name = value;
						void this.save();
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
					void this.save();
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
						void this.save();
					}),
			);

		new Setting(this.containerEl)
			.setName("Emoji")
			.setDesc("Decorative prefix for this calendar's events ({{emoji}} in templates)")
			.addText((text) =>
				text
					.setPlaceholder("📅")
					.setValue(this.calendar.emoji ?? "")
					.onChange((value) => {
						this.calendar.emoji = value;
						void this.save();
					}),
			);

		new Setting(this.containerEl)
			.setName("Color")
			.setDesc("Calendar color ({{color}} in templates)")
			.addColorPicker((picker) =>
				picker
					.setValue(this.calendar.color || "#2962ff")
					.onChange((value) => {
						this.calendar.color = value;
						void this.save();
					}),
			);

		new Setting(this.containerEl)
			.setName("Active")
			.setDesc("Include this calendar when fetching events")
			.addToggle((toggle) =>
				toggle.setValue(this.calendar.active).onChange((value) => {
					this.calendar.active = value;
					void this.save();
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
}

/**
 * Slide-out sub-page editing one output template, built imperatively.
 */
class TemplatePage extends DirtyPage {
	constructor(tab: IcsImportSettingTab, private readonly template: OutputTemplate) {
		super(tab);
	}

	display(): void {
		this.containerEl.empty();

		const templates = this.tab.plugin.settings.templates;
		if (!templates.includes(this.template)) {
			this.title = "Deleted template";
			this.containerEl.createEl("p", {
				text: "This template has been deleted. Use the back button to return to the list.",
			});
			return;
		}
		this.title = this.template.name || "Untitled template";

		new Setting(this.containerEl)
			.setName("Name")
			.setDesc("Pretty display name")
			.addText((text) =>
				text
					.setPlaceholder("e.g. Today's tasks")
					.setValue(this.template.name)
					.onChange((value) => {
						this.template.name = value;
						void this.save();
					}),
			);

		new Setting(this.containerEl)
			.setName("ID")
			.setDesc("Programmatic identifier used to call this template")
			.addText((text) =>
				text.setValue(this.template.id).onChange((value) => {
					const invalid =
						value.trim() === "" ||
						templates.some((entry) => entry !== this.template && entry.id === value.trim());
					if (invalid) {
						new Notice("Template IDs must be non-empty and unique");
					}
					this.template.id = value;
					void this.save();
				}),
			);

		new Setting(this.containerEl)
			.setName("Date range")
			.setDesc("Which days the template covers; Today only is 00:00–24:00")
			.addDropdown((dropdown) => {
				for (const [mode, label] of Object.entries(DATE_MODE_LABELS)) {
					dropdown.addOption(mode, label);
				}
				dropdown
					.setValue(this.template.dateMode)
					.onChange((value) => {
						this.template.dateMode = value as TemplateDateMode;
						void this.save();
						this.display();
					});
			});

		if (this.template.dateMode === "relative") {
			this.numberSetting("Start offset", "Days before (-) or after today the range starts", "fromDays");
			this.numberSetting("End offset", "Days before (-) or after today the range ends", "toDays");
		} else if (this.template.dateMode === "fixed") {
			new Setting(this.containerEl)
				.setName("Start date")
				.setDesc("First day of the range (YYYY-MM-DD)")
				.addText((text) =>
					text
						.setPlaceholder("YYYY-MM-DD")
						.setValue(this.template.fromDate)
						.onChange((value) => {
							this.template.fromDate = value;
							void this.save();
						}),
				);
			new Setting(this.containerEl)
				.setName("End date")
				.setDesc("Last day of the range (YYYY-MM-DD)")
				.addText((text) =>
					text
						.setPlaceholder("YYYY-MM-DD")
						.setValue(this.template.toDate)
						.onChange((value) => {
							this.template.toDate = value;
							void this.save();
						}),
				);
		}

		new Setting(this.containerEl)
			.setName("Sorting")
			.setDesc("Order of the rendered events")
			.addDropdown((dropdown) => {
				for (const [mode, label] of Object.entries(SORT_MODE_LABELS)) {
					dropdown.addOption(mode, label);
				}
				dropdown
					.setValue(this.template.sortMode)
					.onChange((value) => {
						this.template.sortMode = value as TemplateSortMode;
						void this.save();
					});
			});

		new Setting(this.containerEl)
			.setName("Group by calendar")
			.setDesc("Separate the events of each calendar under their own header")
			.addToggle((toggle) =>
				toggle.setValue(this.template.grouping).onChange((value) => {
					this.template.grouping = value;
					void this.save();
					this.display();
				}),
			);

		if (this.template.grouping) {
			new Setting(this.containerEl)
				.setName("Group header")
				.setDesc("Rendered once per calendar; placeholders {{icsName}} {{emoji}} {{color}} {{count}}")
				.addText((text) =>
					text
						.setPlaceholder("### {{emoji}} {{icsName}}")
						.setValue(this.template.headerTemplate)
						.onChange((value) => {
							this.template.headerTemplate = value;
							void this.save();
						}),
				);
		}

		new Setting(this.containerEl).setName("Line template").setHeading();

		new Setting(this.containerEl).addTextArea((text) => {
			text.inputEl.rows = 4;
			text
				.setPlaceholder("- [ ] {{time}} {{icsName}} {{summary}} {{location}}")
				.setValue(this.template.lineTemplate)
				.onChange((value) => {
					this.template.lineTemplate = value;
					void this.save();
				});
		});

		new Setting(this.containerEl)
			.setName("Placeholders")
			.setDesc(
				"{{time}} {{endTime}} {{icsName}} {{summary}} {{location}} {{description}} " +
					"{{emoji}} {{color}} {{isAllDay}} {{day}} — rendered once per event; " +
					"unknown placeholders become empty strings",
			);

		const calendars = this.tab.plugin.settings.calendars;
		if (calendars.length > 0) {
			new Setting(this.containerEl)
				.setName("Calendars")
				.setDesc("Which calendars this template includes")
				.setHeading();
			for (const calendar of calendars) {
				new Setting(this.containerEl)
					.setName(calendarLabel(calendar))
					.setDesc(calendar.id)
					.addToggle((toggle) => {
						// undefined/empty calendarIds means "all calendars"
						const ids = this.template.calendarIds;
						const included = !ids?.length || ids.includes(calendar.id);
						toggle.setValue(included).onChange((value) => {
							if (!this.template.calendarIds?.length) {
								this.template.calendarIds = calendars
									.filter((entry) => (value ? true : entry.id !== calendar.id))
									.map((entry) => entry.id);
							} else if (value && !this.template.calendarIds.includes(calendar.id)) {
								this.template.calendarIds.push(calendar.id);
							} else if (!value) {
								this.template.calendarIds = this.template.calendarIds.filter(
									(id) => id !== calendar.id,
								);
							}
							void this.save();
						});
					});
			}
		}

		new Setting(this.containerEl)
			.setName("Expose as command")
			.setDesc("Offer a command that inserts the rendered list at the cursor")
			.addToggle((toggle) =>
				toggle.setValue(this.template.exposeAsCommand).onChange((value) => {
					this.template.exposeAsCommand = value;
					void this.save();
					this.tab.plugin.syncTemplateCommands();
				}),
			);

		new Setting(this.containerEl)
			.setName("Delete this template")
			.setDesc("Remove the template and all of its settings")
			.addButton((button) => {
				button
					.setButtonText("Delete")
					.setIcon("trash-2")
					.setTooltip("Delete this template")
					.onClick(async () => {
						const index = templates.indexOf(this.template);
						if (index !== -1) {
							templates.splice(index, 1);
						}
						this.dirty = false;
						await this.tab.plugin.saveSettings();
						this.tab.plugin.syncTemplateCommands();
						this.tab.update();
						this.display();
					});
				button.buttonEl.addClass("mod-warning");
			});
	}

	private numberSetting(name: string, desc: string, field: "fromDays" | "toDays"): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.inputEl.type = "number";
				text
					.setValue(String(this.template[field]))
					.onChange((value) => {
						this.template[field] = parseInt(value, 10) || 0;
						void this.save();
					});
			});
	}
}

function calendarLabel(calendar: CalendarConfig): string {
	const name = calendar.name || "Untitled calendar";
	return calendar.emoji ? `${calendar.emoji} ${name}` : name;
}

function uniqueSuffix(entries: { id: string }[], prefix: string): number {
	let index = entries.length + 1;
	while (entries.some((entry) => entry.id === `${prefix}-${index}`)) {
		index++;
	}
	// caller uses index for both the id and the unique default name
	return index;
}

function createCalendar(calendars: CalendarConfig[]): CalendarConfig {
	const index = uniqueSuffix(calendars, "calendar");
	return {
		id: `calendar-${index}`,
		// Prefilled so page names stay unique (required for navigation).
		name: `New calendar ${index}`,
		url: "",
		active: true,
		emoji: "",
		color: "",
	};
}

function createTemplate(templates: OutputTemplate[]): OutputTemplate {
	const index = uniqueSuffix(templates, "template");
	return {
		id: `template-${index}`,
		name: `New template ${index}`,
		dateMode: "today",
		fromDays: 0,
		toDays: 0,
		fromDate: "",
		toDate: "",
		sortMode: "dateAsc",
		grouping: false,
		headerTemplate: "### {{emoji}} {{icsName}}",
		lineTemplate: "- [ ] {{time}} {{icsName}} {{summary}} {{location}}",
		exposeAsCommand: false,
	};
}
