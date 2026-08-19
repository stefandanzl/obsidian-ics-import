import { Editor, Notice, Plugin, moment } from "obsidian";
import { fetchIcsText, parseIcsEvents } from "./ical";
import IcsImportSettingTab from "./settings";
import { renderTemplateOutput, resolveTemplateDays } from "./templates";
import type { IcsEvent, IcsImportSettings } from "./types";

/** Global API exposed as `window.icsImport` while the plugin is loaded. */
export interface IcsImportGlobalApi {
	/** All events overlapping the given day across all active calendars. */
	getEvents: (day?: string | number | Date | moment.Moment) => Promise<IcsEvent[]>;
	/** Render an output template (by id or name) to its accumulated string. */
	renderTemplate: (templateIdOrName: string) => Promise<string>;
}

export default class IcsImportPlugin extends Plugin {
	declare settings: IcsImportSettings;

	private templateCommandIds: string[] = [];

	async onload(): Promise<void> {
		this.settings = Object.assign({}, await this.loadData());
		if (!Array.isArray(this.settings.calendars)) {
			this.settings.calendars = [];
		}
		if (!Array.isArray(this.settings.templates)) {
			this.settings.templates = [];
		}

		this.addSettingTab(new IcsImportSettingTab(this.app, this));
		this.syncTemplateCommands();

		const api: IcsImportGlobalApi = {
			getEvents: (day) => this.getEvents(day),
			renderTemplate: (templateIdOrName) => this.renderTemplate(templateIdOrName),
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

		const events = await this.getEventsForDays([targetDay]);
		return events.sort((a, b) => a.utime - b.utime);
	}

	/**
	 * Render an output template (matched by id first, then name) over its
	 * date range and return the accumulated string.
	 */
	async renderTemplate(templateIdOrName: string): Promise<string> {
		const template = this.settings.templates.find(
			(entry) => entry.id === templateIdOrName || entry.name === templateIdOrName,
		);
		if (!template) {
			new Notice(`[ics-import] no output template "${templateIdOrName}"`);
			return "";
		}
		const events = await this.getEventsForDays(resolveTemplateDays(template));
		return renderTemplateOutput(template, events, this.settings.calendars);
	}

	/** (Re-)register editor commands for templates with exposeAsCommand. */
	syncTemplateCommands(): void {
		// Not part of the public App typings, but stable at runtime.
		const commands = (
			this.app as unknown as { commands: { removeCommand(commandId: string): void } }
		).commands;
		for (const commandId of this.templateCommandIds) {
			commands.removeCommand(commandId);
		}
		this.templateCommandIds = [];
		for (const template of this.settings.templates) {
			if (!template.exposeAsCommand) {
				continue;
			}
			const command = this.addCommand({
				id: `insert-${template.id}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
				name: `Insert event list: ${template.name || template.id}`,
				editorCallback: (editor: Editor) => {
					void this.insertTemplateAtCursor(editor, template.id);
				},
			});
			this.templateCommandIds.push(`${this.manifest.id}:${command.id}`);
		}
	}

	private async insertTemplateAtCursor(editor: Editor, templateId: string): Promise<void> {
		const text = await this.renderTemplate(templateId);
		if (text !== "") {
			editor.replaceSelection(text);
		}
	}

	/** Fetch each calendar once and parse it against every requested day. */
	private async getEventsForDays(days: moment.Moment[]): Promise<IcsEvent[]> {
		const activeCalendars = this.settings.calendars.filter((calendar) => calendar.active && calendar.url);
		const results = await Promise.all(
			activeCalendars.map(async (calendar) => {
				try {
					const icsText = await fetchIcsText(calendar.url);
					return days.flatMap((day) => parseIcsEvents(icsText, calendar, day));
				} catch (error) {
					console.warn(
						`[ics-import] failed to load calendar "${calendar.name}" (${calendar.url})`,
						error,
					);
					return [] as IcsEvent[];
				}
			}),
		);
		return results.flat();
	}
}
