import { Notice, PluginSettingTab, Setting, SettingGroup, SettingPage } from "obsidian";
import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";
import type IcsImportPlugin from "./main";
import type { CalendarConfig, IcsImportSettings, OutputTemplate } from "./types";
import type { TemplateDateMode, TemplateGroupMode, TemplateSortMode } from "./types";

export const DEFAULT_SETTINGS: IcsImportSettings = {
	calendars: [],
	templates: [],
};

const DATE_MODE_LABELS: Record<TemplateDateMode, string> = {
	today: "Today only",
	restOfDay: "Rest of today",
	relative: "Relative to today",
	fixed: "Fixed dates",
};

const GROUP_MODE_LABELS: Record<TemplateGroupMode, string> = {
	"": "Disabled",
	calendar: "Calendar",
	day: "Day",
	hour: "Hour",
	month: "Month",
};

const DATE_MODE_EXPLAINERS: Record<TemplateDateMode, string> = {
	today: "All events overlapping today, 00:00–24:00",
	restOfDay: "Events from now until 24:00 today; events that have already ended are skipped",
	relative: "Range in day offsets from today — negative values reach into the past, 0 is today",
	fixed: "Explicit range — each side falls back to today when empty or invalid",
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

	/** Red destructive action row shared by both sub-pages. */
	protected addDeleteSetting(name: string, desc: string, deleteAction: () => void): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addButton((button) => {
				button
					.setButtonText("Delete")
					.setIcon("trash-2")
					.setTooltip(name)
					.onClick(async () => {
						deleteAction();
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

		const general = new SettingGroup(this.containerEl).setHeading("General");
		general.addSetting((setting) =>
			setting
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
				),
		);
		general.addSetting((setting) =>
			setting
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
				),
		);

		const source = new SettingGroup(this.containerEl).setHeading("Source");
		source.addSetting((setting) =>
			setting
				.setName("iCal URL")
				.setDesc(
					"Remote .ics feed address (Google/Apple/Outlook secret links work without authentication)",
				)
				.addText((text) =>
					text
						.setPlaceholder("https://example.com/calendar.ics")
						.setValue(this.calendar.url)
						.onChange((value) => {
							this.calendar.url = value;
							void this.save();
						}),
				),
		);
		source.addSetting((setting) =>
			setting
				.setName("Active")
				.setDesc("Include this calendar when fetching events")
				.addToggle((toggle) =>
					toggle.setValue(this.calendar.active).onChange((value) => {
						this.calendar.active = value;
						void this.save();
					}),
				),
		);

		const appearance = new SettingGroup(this.containerEl).setHeading("Appearance");
		appearance.addSetting((setting) =>
			setting
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
				),
		);
		appearance.addSetting((setting) =>
			setting
				.setName("Color")
				.setDesc("Calendar color ({{color}} in templates)")
				.addColorPicker((picker) =>
					picker.setValue(this.calendar.color || "#2962ff").onChange((value) => {
						this.calendar.color = value;
						void this.save();
					}),
				),
		);

		this.addDeleteSetting("Delete this calendar", "Remove the calendar and all of its settings", () => {
			const index = calendars.indexOf(this.calendar);
			if (index !== -1) {
				calendars.splice(index, 1);
			}
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

		const general = new SettingGroup(this.containerEl).setHeading("General");
		general.addSetting((setting) =>
			setting
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
				),
		);
		general.addSetting((setting) =>
			setting
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
				),
		);

		const dateRange = new SettingGroup(this.containerEl).setHeading("Date range");
		dateRange.addSetting((setting) =>
			setting
				.setName("Mode")
				.setDesc("Which days the template covers")
				.addDropdown((dropdown) => {
					for (const [mode, label] of Object.entries(DATE_MODE_LABELS)) {
						dropdown.addOption(mode, label);
					}
					dropdown.setValue(this.template.dateMode).onChange((value) => {
						this.template.dateMode = value as TemplateDateMode;
						void this.save();
						this.display();
					});
				}),
		);
		dateRange.addSetting((setting) =>
			setting.setName("").setDesc(DATE_MODE_EXPLAINERS[this.template.dateMode]),
		);
		if (this.template.dateMode === "relative") {
			this.addNumberSetting(dateRange, "Start offset", "Days before (-) or after today the range starts", "fromDays");
			this.addNumberSetting(dateRange, "End offset", "Days before (-) or after today the range ends", "toDays");
		} else if (this.template.dateMode === "fixed") {
			this.addDateSetting(dateRange, "Start date", "First day of the range (YYYY-MM-DD)", "fromDate");
			this.addDateSetting(dateRange, "End date", "Last day of the range (YYYY-MM-DD)", "toDate");
		}

		const sorting = new SettingGroup(this.containerEl).setHeading("Sorting");
		sorting.addSetting((setting) =>
			setting
				.setName("Order")
				.setDesc("Order of the rendered events")
				.addDropdown((dropdown) => {
					for (const [mode, label] of Object.entries(SORT_MODE_LABELS)) {
						dropdown.addOption(mode, label);
					}
					dropdown.setValue(this.template.sortMode).onChange((value) => {
						this.template.sortMode = value as TemplateSortMode;
						void this.save();
					});
				}),
		);

		const grouping = new SettingGroup(this.containerEl).setHeading("Grouping");
		grouping.addSetting((setting) =>
			setting
				.setName("Group by")
				.setDesc(
					"Separate the events of each group under their own header; " +
						"time groups are ordered chronologically",
				)
				.addDropdown((dropdown) => {
					for (const [mode, label] of Object.entries(GROUP_MODE_LABELS)) {
						dropdown.addOption(mode, label);
					}
					dropdown.setValue(this.template.groupBy).onChange((value) => {
						this.template.groupBy = value as TemplateGroupMode;
						void this.save();
						this.display();
					});
				}),
		);
		if (this.template.groupBy) {
			grouping.addSetting((setting) =>
				setting
					.setName("Group header")
					.setDesc(
						"Placeholders {{icsName}} {{emoji}} {{color}} for calendar groups, " +
							"{{date:FORMAT}} {{count}} for day/hour/month groups. Enter blank lines for extra spacing",
					)
					.addTextArea((text) => {
						text.inputEl.rows = 2;
						text
							.setPlaceholder("### {{emoji}} {{icsName}}")
							.setValue(this.template.headerTemplate ?? "")
							.onChange((value) => {
								this.template.headerTemplate = value;
								void this.save();
							});
					}),
			);
		}

		const frame = new SettingGroup(this.containerEl).setHeading("Frame");
		frame.addSetting((setting) =>
			setting
				.setName("Header")
				.setDesc("Rendered once before all events; placeholder {{count}}")
				.addTextArea((text) => {
					text.inputEl.rows = 2;
					text
						.setPlaceholder("#todo/heute")
						.setValue(this.template.outputHeaderTemplate ?? "")
						.onChange((value) => {
							this.template.outputHeaderTemplate = value;
							void this.save();
						});
				}),
		);
		frame.addSetting((setting) =>
			setting
				.setName("Last line")
				.setDesc("Rendered once after all events; placeholder {{count}}. Enter blank lines to end with clean spacing")
				.addTextArea((text) => {
					text.inputEl.rows = 2;
					text
						.setPlaceholder("")
						.setValue(this.template.lastLineTemplate ?? "")
						.onChange((value) => {
							this.template.lastLineTemplate = value;
							void this.save();
						});
				}),
		);

		const lineTemplate = new SettingGroup(this.containerEl).setHeading("Line template");
		lineTemplate.addSetting((setting) =>
			setting.addTextArea((text) => {
				text.inputEl.rows = 4;
				text
					.setPlaceholder("- [ ] {{time}} {{icsName}} {{summary}} {{location}}")
					.setValue(this.template.lineTemplate)
					.onChange((value) => {
						this.template.lineTemplate = value;
						void this.save();
					});
			}),
		);
		lineTemplate.addSetting((setting) =>
			setting.setName("Placeholders").setDesc(
				"{{time}} {{endTime}} (24h) · {{date:FORMAT}} {{endDate:FORMAT}} with moment.js tokens, " +
					"e.g. {{date:ddd DD.MM.}} · {{icsName}} {{summary}} {{location}} {{description}} " +
					"{{emoji}} {{color}} {{isAllDay}} {{day}} — unknown placeholders become empty strings",
			),
		);

		const calendars = this.tab.plugin.settings.calendars;
		if (calendars.length > 0) {
			const calendarGroup = new SettingGroup(this.containerEl).setHeading("Calendars");
			calendarGroup.addSetting((setting) =>
				setting.setName("").setDesc("Which calendars this template includes"),
			);
			for (const calendar of calendars) {
				calendarGroup.addSetting((setting) =>
					setting.setName(calendarLabel(calendar)).addToggle((toggle) => {
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
					}),
				);
			}
		}

		const command = new SettingGroup(this.containerEl).setHeading("Command");
		command.addSetting((setting) =>
			setting
				.setName("Expose as command")
				.setDesc("Offer a command that inserts the rendered list at the cursor")
				.addToggle((toggle) =>
					toggle.setValue(this.template.exposeAsCommand).onChange((value) => {
						this.template.exposeAsCommand = value;
						void this.save();
						this.tab.plugin.syncTemplateCommands();
					}),
				),
		);

		this.addDeleteSetting("Delete this template", "Remove the template and all of its settings", () => {
			const index = templates.indexOf(this.template);
			if (index !== -1) {
				templates.splice(index, 1);
			}
			this.tab.plugin.syncTemplateCommands();
		});
	}

	private addNumberSetting(
		group: SettingGroup,
		name: string,
		desc: string,
		field: "fromDays" | "toDays",
	): void {
		group.addSetting((setting) =>
			setting.setName(name).setDesc(desc).addText((text) => {
				text.inputEl.type = "number";
				text.setValue(String(this.template[field])).onChange((value) => {
					this.template[field] = parseInt(value, 10) || 0;
					void this.save();
				});
			}),
		);
	}

	private addDateSetting(
		group: SettingGroup,
		name: string,
		desc: string,
		field: "fromDate" | "toDate",
	): void {
		group.addSetting((setting) =>
			setting
				.setName(name)
				.setDesc(desc)
				.addText((text) =>
					text
						.setPlaceholder("YYYY-MM-DD")
						.setValue(this.template[field])
						.onChange((value) => {
							this.template[field] = value;
							void this.save();
						}),
				),
		);
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
		groupBy: "",
		headerTemplate: "### {{emoji}} {{icsName}}",
		outputHeaderTemplate: "",
		lastLineTemplate: "",
		lineTemplate: "- [ ] {{time}} {{icsName}} {{summary}} {{location}}",
		exposeAsCommand: false,
	};
}
