import "dotenv/config";
import { readFileSync } from "fs";
import { resolve } from "path";

// --- Types ---

interface MeetingEntry {
  day: string;
  start: string;
  duration: string;
  ticket: string;
  description?: string;
}

interface Env {
  TEMPO_API_TOKEN: string;
  JIRA_ACCOUNT_ID: string;
  JIRA_BASE_URL: string;
  JIRA_EMAIL: string;
  JIRA_API_TOKEN: string;
}

// --- Config ---

const TEMPO_API = "https://api.tempo.io/4";

const DAY_OFFSETS: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

// --- Helpers ---

function loadEnv(): Env {
  const required = [
    "TEMPO_API_TOKEN",
    "JIRA_ACCOUNT_ID",
    "JIRA_BASE_URL",
    "JIRA_EMAIL",
    "JIRA_API_TOKEN",
  ] as const;

  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Missing env var: ${key}`);
      process.exit(1);
    }
  }

  return {
    TEMPO_API_TOKEN: process.env.TEMPO_API_TOKEN!,
    JIRA_ACCOUNT_ID: process.env.JIRA_ACCOUNT_ID!,
    JIRA_BASE_URL: process.env.JIRA_BASE_URL!.replace(/\/+$/, ""),
    JIRA_EMAIL: process.env.JIRA_EMAIL!,
    JIRA_API_TOKEN: process.env.JIRA_API_TOKEN!,
  };
}

function loadMeetings(filePath: string): MeetingEntry[] {
  const raw = readFileSync(filePath, "utf-8");
  const meetings: MeetingEntry[] = JSON.parse(raw);

  for (const m of meetings) {
    if (!m.day || !m.start || !m.duration || !m.ticket) {
      console.error("Invalid entry (missing required fields):", m);
      process.exit(1);
    }
    if (!(m.day.toLowerCase() in DAY_OFFSETS)) {
      console.error(`Invalid day: "${m.day}"`);
      process.exit(1);
    }
  }

  return meetings;
}

/** Parse duration string like "1h", "30m", "1h30m" into seconds */
function parseDuration(dur: string): number {
  const match = dur.match(/^(?:(\d+)h)?(?:(\d+)m)?$/);
  if (!match || (!match[1] && !match[2])) {
    console.error(`Invalid duration: "${dur}". Use format like "1h", "30m", "1h30m"`);
    process.exit(1);
  }
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  return (hours * 60 + minutes) * 60;
}

/** Get the Monday of the current week as a Date (local time) */
function getCurrentMonday(): Date {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  return monday;
}

/** Format Date as YYYY-MM-DD */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Resolve a Jira issue key (e.g. PROJ-123) to its numeric ID via Jira REST API */
async function resolveIssueId(key: string, env: Env): Promise<number> {
  const url = `${env.JIRA_BASE_URL}/rest/api/3/issue/${encodeURIComponent(key)}?fields=id`;
  const auth = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");

  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to resolve issue ${key}: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { id: string };
  return parseInt(data.id, 10);
}

/** Create a worklog in Tempo */
async function createWorklog(
  env: Env,
  issueId: number,
  startDate: string,
  startTime: string,
  timeSpentSeconds: number,
  description?: string
): Promise<void> {
  const body: Record<string, unknown> = {
    authorAccountId: env.JIRA_ACCOUNT_ID,
    issueId,
    startDate,
    startTime: `${startTime}:00`, // API expects HH:mm:ss
    timeSpentSeconds,
  };

  if (description) {
    body.description = description;
  }

  const res = await fetch(`${TEMPO_API}/worklogs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TEMPO_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tempo API error: ${res.status} ${text}`);
  }
}

// --- Main ---

async function main() {
  const env = loadEnv();

  const inputFile = process.argv[2] || resolve(process.cwd(), "week.json");
  const meetings = loadMeetings(inputFile);
  const monday = getCurrentMonday();

  console.log(`Week of ${formatDate(monday)}`);
  console.log(`Submitting ${meetings.length} worklog(s)...\n`);

  // Resolve all unique ticket keys to IDs
  const ticketKeys = [...new Set(meetings.map((m) => m.ticket))];
  const issueIdMap = new Map<string, number>();

  for (const key of ticketKeys) {
    try {
      const id = await resolveIssueId(key, env);
      issueIdMap.set(key, id);
      console.log(`  ${key} -> issue #${id}`);
    } catch (err) {
      console.error(`  Failed to resolve ${key}:`, (err as Error).message);
      process.exit(1);
    }
  }
  console.log();

  // Submit worklogs
  let ok = 0;
  let fail = 0;

  for (const m of meetings) {
    const offset = DAY_OFFSETS[m.day.toLowerCase()];
    const date = new Date(monday);
    date.setDate(date.getDate() + offset);
    const startDate = formatDate(date);
    const seconds = parseDuration(m.duration);
    const issueId = issueIdMap.get(m.ticket)!;

    const label = `${m.day} ${m.start} ${m.duration} ${m.ticket}${m.description ? ` "${m.description}"` : ""}`;

    try {
      await createWorklog(env, issueId, startDate, m.start, seconds, m.description);
      console.log(`  OK  ${label}`);
      ok++;
    } catch (err) {
      console.error(`  ERR ${label}: ${(err as Error).message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} created, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main();
