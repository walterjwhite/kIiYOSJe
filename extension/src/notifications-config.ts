/**
 * Notification quiet-period configuration command.
 *
 * Gates when mind may proactively notify the person (e.g. a future
 * "your brief is ready" ping) — separate from asking for something right
 * now, which this never holds back, and separate from the send gates in
 * PLAN §7, which govern outbound messages, not notifications.
 *
 * PUT /admin/notifications writes ~/.config/mind/notifications.json, read
 * fresh by isWithinNotificationWindow() on every call — no restart needed.
 */

import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";

interface QuietPeriodResponse {
  enabled: boolean;
  days: number[];
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  allowedNow: boolean;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTime(input: string): { hour: number; minute: number } | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!m) return undefined;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return { hour, minute };
}

export async function configureNotificationQuietPeriod(): Promise<void> {
  let current: QuietPeriodResponse;
  try {
    current = await apiFetch<QuietPeriodResponse>("/admin/notifications");
  } catch (err) {
    vscode.window.showErrorMessage(String(err));
    return;
  }

  const enabledPick = await vscode.window.showQuickPick(
    [
      { label: "On — only notify within the window below", enabled: true },
      { label: "Off — notify any time", enabled: false },
    ],
    {
      placeHolder: `Quiet period is currently ${current.enabled ? "on" : "off"}`,
      title: "mind: Notification Quiet Period",
    },
  );
  if (!enabledPick) return;

  if (!enabledPick.enabled) {
    try {
      await apiFetch("/admin/notifications", {
        method: "PUT",
        body: JSON.stringify({ ...current, enabled: false }),
      });
      vscode.window.showInformationMessage(
        "mind: notification quiet period turned off. Notifications may go out any time.",
      );
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    return;
  }

  const dayPicks = await vscode.window.showQuickPick(
    DAY_LABELS.map((label, day) => ({
      label,
      day,
      picked: current.days.includes(day),
    })),
    {
      canPickMany: true,
      placeHolder: "Days notifications are allowed",
      title: "mind: Notification Quiet Period — days",
    },
  );
  if (!dayPicks) return;
  if (dayPicks.length === 0) {
    vscode.window.showErrorMessage("mind: pick at least one day, or turn the quiet period off.");
    return;
  }

  const startInput = await vscode.window.showInputBox({
    title: "Window start (24h HH:MM, local time)",
    value: formatTime(current.startHour, current.startMinute),
    validateInput: (v) => (parseTime(v) ? undefined : "Use 24h HH:MM, e.g. 08:00"),
  });
  if (startInput === undefined) return;
  const start = parseTime(startInput);
  if (!start) return;

  const endInput = await vscode.window.showInputBox({
    title: "Window end (24h HH:MM, local time)",
    value: formatTime(current.endHour, current.endMinute),
    validateInput: (v) => (parseTime(v) ? undefined : "Use 24h HH:MM, e.g. 15:00"),
  });
  if (endInput === undefined) return;
  const end = parseTime(endInput);
  if (!end) return;

  try {
    await apiFetch("/admin/notifications", {
      method: "PUT",
      body: JSON.stringify({
        enabled: true,
        days: dayPicks.map((p) => p.day).sort(),
        startHour: start.hour,
        startMinute: start.minute,
        endHour: end.hour,
        endMinute: end.minute,
      }),
    });
    const dayNames = dayPicks.map((p) => p.label).join(", ");
    vscode.window.showInformationMessage(
      `mind: notifications allowed ${dayNames}, ${formatTime(start.hour, start.minute)}–${formatTime(end.hour, end.minute)}. Takes effect immediately — no restart needed.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(String(err));
  }
}
