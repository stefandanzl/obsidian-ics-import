# ICS Import

Fetch, parse, and insert events from remote iCalendar (.ics) feeds directly into your Obsidian notes.

Multiple calendars, recurring events, timezones, and reusable output templates — rendered into your notes via a global API, [Templater](https://github.com/SilentVoid13/Templater), or editor commands.

## How it works

- Add any number of remote calendars (Google/Apple/Outlook secret links work without authentication — no login, no OAuth).
- Events are fetched live on every render, parsed with [ical.js](https://github.com/kewisch/ical.js) (full RFC 5545 support), including RRULE/RDATE recurrence expansion, timezone conversion, cancelled-event filtering, and multi-day events that are still ongoing.
- Output templates turn those events into exactly the text you want — line by line.

## Settings

### Calendars

Each calendar is configured in its own submenu:

| Setting | Description |
|---|---|
| Name | Pretty display name, available as `{{calendar}}` in templates |
| ID | Programmatic identifier for scripts |
| iCalendar URL | Remote `.ics` feed address |
| Emoji | Decorative prefix, available as `{{emoji}}` |
| Color | Color picker, available as `{{color}}` (hex) |
| Active | Include this calendar when fetching events |

### Output templates

Templates render events over a date range into one accumulated string:

- **Name / ID** — the ID is what you call the template with from scripts or commands
- **Date range** — one of:
  - *Today only* — all events overlapping today, 00:00–24:00
  - *Rest of today* — from **now** until 24:00; already-ended events are skipped
  - *Relative to today* — day offsets from today (negative values reach into the past, `0` is today)
  - *Fixed dates* — explicit `YYYY-MM-DD` on either side (each side falls back to today when empty/invalid)
- **Sorting** — date asc/desc, duration asc/desc, all-day first/last
- **Grouping** — disabled, or by calendar / day / hour / month. Time groups are always ordered chronologically; your sort mode still applies within each group. Each group can have a header template.
- **Frame** — a header rendered once before everything (e.g. `#todo/heute`) and a last line rendered after everything (e.g. blank lines for clean spacing)
- **Line template** — rendered once per event (see placeholders below)
- **Calendars** — per-calendar toggles for which feeds the template includes
- **Expose as command** — registers an editor command that inserts the rendered list at the cursor

## Template placeholders

| Placeholder | Renders |
|---|---|
| `{{start}}` / `{{end}}` | Start/end time, 24h (`19:00`); empty for all-day events |
| `{{start:FORMAT}}` / `{{end:FORMAT}}` | Start/end with any [moment.js](https://momentjs.com/docs/#/displaying/format/) format |
| `{{duration}}` | Compact duration: `45m`, `1h 30m`, `2d 3h` |
| `{{duration:HH:mm}}` | Clock-style duration: `1:46`, `26:00` (custom tokens: `D`, `H`/`HH`, `m`/`mm`) |
| `{{duration:human}}` | Humanized duration: `2 hours` |
| `{{isAllDay}}` | `all day` for all-day events, empty for timed events |
| `{{isAllDay:your text}}` | Your text for all-day events, empty for timed events |
| `{{calendar}}` | Calendar display name |
| `{{summary}}`, `{{location}}`, `{{description}}` | Event fields |
| `{{emoji}}`, `{{color}}` | Calendar emoji / hex color |
| `{{count}}` | (Headers/last line only) number of rendered events |

Group header placeholders: `{{calendar}} {{emoji}} {{color}}` for calendar groups, `{{start:FORMAT}} {{count}}` for day/hour/month groups.

Unknown placeholders render as empty strings.

### Example FORMATs

| Example | Output (for an event on Aug 20, 2026, 19:00–21:30) |
|---|---|
| `{{start}}` | `19:00` |
| `{{start:H:mm}}` | `19:00` |
| `{{start:YYYY-MM-DD}}` | `2026-08-20` |
| `{{start:ddd DD.MM.}}` | `Thu 20.08.` |
| `{{start:dddd, Do MMMM}}` | `Thursday, 20th August` |
| `{{end:HH:mm}}` | `21:30` |
| `{{duration}}` | `2h 30m` |
| `{{duration:H:mm}}` | `2:30` |
| `{{duration:mm}}` | `150` (total minutes) |
| `{{duration:human}}` | `2 hours` |
| `{{isAllDay:ganztägig}}` | `ganztägig` (or empty for timed events) |

### Example template

Settings: date range *Today only*, grouping *Calendar*, header `### {{emoji}} {{calendar}}`, line `- [ ] {{start}} {{summary}}{{isAllDay: — all day}}` → renders

```md
### 📅 Work
- [ ] 09:00 Team sync
- [ ] 13:00 Quarterly review
### 🏠 Private
- [ ] 19:00 Dinner
- [ ] ️Gardening — all day
```

## Public API

While the plugin is enabled, a global API is available as `icsImport` (also `window.icsImport`), and of course on the plugin instance:

```js
// All events overlapping a day (defaults to today), sorted by start time.
// Drop-in compatible with the old "ics" plugin: events keep the legacy
// field names (time, utime, icsName, summary, location, ...).
const events = await icsImport.getEvents();
const events = await icsImport.getEvents(moment("2026-08-20", "YYYY-MM-DD"));

// Render an output template (by ID first, then by name) to a string.
const text = await icsImport.renderTemplate("today");
const text = await app.plugins.getPlugin("ics-import").renderTemplate("today");
```

Returned event objects carry (legacy names first, extras after): `day`, `utime`, `time`, `endTime`, `icsName`, `summary`, `location`, `description`, plus `uid`, `id`, `calendarId`, `emoji`, `color`, `isAllDay`, `isRecurring`, `endUtime`, `url`.

### Templater

Daily note drop-in (the reason this plugin exists):

```js
<%* var events = await app.plugins.getPlugin('ics-import').getEvents(moment(tp.date.now("YYYY-MM-DD"),'YYYY-MM-DD')); events.sort((a,b) => a.utime - b.utime).forEach((e) => { tR+=`\n- [ ] ${e.time} ${e.icsName} ${e.summary} ${e.location? e.location : ''}` }) %>
```

Or just render a previously configured template with id `today`:

```js
<%* tR += await window.icsImport.renderTemplate('today') %>
```

## Development

```sh
task
```

## Bundle size analysis

```q
  main.js                               96.6kb  100.0%
   ├ node_modules/ical.js/dist/ical.js  76.9kb   79.7%
   ├ src/settings.ts                    11.3kb   11.7%
   ├ src/templates.ts                    3.2kb    3.3%
   ├ src/ical.ts                         2.2kb    2.3%
   └ src/main.ts                         1.9kb    2.0%
```

Requires Obsidian 1.13.1+ (declarative Settings API). MIT licensed.
