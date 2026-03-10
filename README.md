# Jira Tempo Week Timesheet CLI

CLI to bulk-create Tempo worklogs from a JSON schedule.

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials:

```
TEMPO_API_TOKEN=your-tempo-api-token
JIRA_ACCOUNT_ID=your-jira-account-id
JIRA_BASE_URL=https://yourorg.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-jira-api-token
```

2. Create a `week.json` file (see `week.example.json` for format):

```json
[
  {
    "day": "monday",
    "start": "09:00",
    "duration": "1h",
    "ticket": "PROJ-123",
    "description": "Sprint planning"
  }
]
```

## Usage

```bash
bun run start
```

This submits worklogs for the current week based on entries in `week.json`.

To use a different file:

```bash
bun run start path/to/custom.json
```

## Date Handling

- The CLI uses the current week's Monday as the reference date
- `day` must be one of: monday, tuesday, wednesday, thursday, friday, saturday, sunday
- `duration` format: `1h`, `30m`, `1h30m`, etc.
