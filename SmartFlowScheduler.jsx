import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Home, Calendar as CalendarIcon, ListChecks, BarChart2, Settings as SettingsIcon,
  Plus, Check, X, Pause, Play, Clock, Flame, Moon, Sun, ChevronLeft, ChevronRight,
  Search, Trash2, Edit3, AlertTriangle, Zap, TrendingUp, CheckCircle2, CircleDot,
  SkipForward, RotateCcw, Download, ArrowRight, MapPin, Bell, Sparkles
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line
} from "recharts";

/* =========================================================================
   CONSTANTS
   ========================================================================= */

const STORAGE_KEY = "smartflow:v1";

const CATEGORIES = [
  { id: "Work", color: "#7DD3FC" },
  { id: "Personal", color: "#A78BFA" },
  { id: "Health", color: "#6EE7B7" },
  { id: "Learning", color: "#FBBF6B" },
  { id: "Errands", color: "#F5A3C7" },
  { id: "Social", color: "#F0A868" },
];

const PRIORITY_META = {
  High: { color: "#FF7A85", weight: 3, label: "High" },
  Medium: { color: "#FBBF6B", weight: 2, label: "Medium" },
  Low: { color: "#6EE7B7", weight: 1, label: "Low" },
};

const RECURRING_OPTIONS = [
  { id: "none", label: "Does not repeat" },
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays (Mon–Fri)" },
  { id: "weekly", label: "Weekly" },
];

const NAV_ITEMS = [
  { id: "today", label: "Today", icon: Home },
  { id: "calendar", label: "Calendar", icon: CalendarIcon },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "insights", label: "Insights", icon: BarChart2 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const DEFAULT_PROFILE = {
  name: "Alex",
  workStart: "08:00",
  workEnd: "20:00",
  sleepStart: "23:00",
  sleepEnd: "07:00",
  breakDuration: 15,
  focusStart: "09:00",
  focusEnd: "11:00",
  theme: "dark",
  notifRemind: true,
  notifDaily: true,
};

/* =========================================================================
   TIME / DATE HELPERS
   ========================================================================= */

function pad2(n) { return String(n).padStart(2, "0"); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function toMin(t) {
  if (!t) return 0;
  const parts = t.split(":");
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

function toTime(min) {
  const wrapped = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

function fmtTime12(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${pad2(m)} ${period}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function daysBetween(a, b) {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round((db - da) / 86400000);
}

function dayNameShort(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });
}

function fmtDateLong(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });
}

function fmtDateShort(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
}

function fmtDuration(min) {
  if (min == null || isNaN(min)) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function newId() {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/* =========================================================================
   SCHEDULING ENGINE (pure functions over the tasks array)
   ========================================================================= */

// Statuses that occupy a slot on the calendar (still "in the way")
const BLOCKING_STATUSES = ["pending", "inProgress"];

function getTasksForDate(tasks, date) {
  return tasks
    .filter((t) => t.date === date && t.status !== "cancelled" && t.status !== "unscheduled")
    .sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
}

// Returns free windows [{start,end}] (minutes) within working hours for a date,
// accounting for existing blocking tasks + break buffer, and "now" if date is today.
function getFreeSlots(tasks, profile, date, excludeId) {
  let windowStart = toMin(profile.workStart);
  const windowEnd = toMin(profile.workEnd);
  if (date === todayStr()) {
    windowStart = Math.max(windowStart, nowMinutes() + 5);
  }
  if (windowStart >= windowEnd) return [];

  const dayTasks = getTasksForDate(tasks, date).filter(
    (t) => t.id !== excludeId && BLOCKING_STATUSES.includes(t.status)
  );

  const slots = [];
  let cursor = windowStart;
  for (const t of dayTasks) {
    const ts = toMin(t.startTime);
    const te = toMin(t.endTime);
    if (ts > cursor) slots.push({ start: cursor, end: ts });
    cursor = Math.max(cursor, te + (profile.breakDuration || 0));
  }
  if (cursor < windowEnd) slots.push({ start: cursor, end: windowEnd });
  return slots.filter((s) => s.end - s.start > 0);
}

function totalFreeMinutes(tasks, profile, date) {
  return getFreeSlots(tasks, profile, date).reduce((sum, s) => sum + (s.end - s.start), 0);
}

// Finds the next available slot of `durationMin`, searching forward day by day
// from startDate, honoring an optional deadline date. Returns
// { date, start, end, reason, daysAhead } or null if nothing found.
function findSlotForDuration(tasks, profile, durationMin, startDate, deadlineDate, excludeId, maxLookaheadDays = 21) {
  for (let i = 0; i <= maxLookaheadDays; i++) {
    const date = addDays(startDate, i);
    if (deadlineDate && date > deadlineDate) break;
    const slots = getFreeSlots(tasks, profile, date, excludeId);
    const fit = slots.find((s) => s.end - s.start >= durationMin);
    if (fit) {
      const start = fit.start;
      const end = start + durationMin;
      let reason;
      if (i === 0 && date === todayStr()) {
        reason = `Scheduled today at ${fmtTime12(toTime(start))} — the next open ${durationMin}-min window.`;
      } else if (i === 0) {
        reason = `Scheduled on ${fmtDateLong(date)} at ${fmtTime12(toTime(start))}.`;
      } else {
        const skipped = i === 1 ? fmtDateLong(startDate) : `the prior ${i} day${i > 1 ? "s" : ""}`;
        reason = `Moved to ${fmtDateLong(date)} at ${fmtTime12(toTime(start))} because ${skipped} had no available ${durationMin}-minute slot.`;
      }
      return { date, start: toTime(start), end: toTime(end), reason, daysAhead: i };
    }
  }
  return null;
}

function detectConflict(tasks, date, startTime, endTime, excludeId) {
  const s = toMin(startTime), e = toMin(endTime);
  return getTasksForDate(tasks, date).filter((t) => {
    if (t.id === excludeId || !BLOCKING_STATUSES.includes(t.status)) return false;
    const ts = toMin(t.startTime), te = toMin(t.endTime);
    return s < te && e > ts;
  });
}

// Handles completing / partially completing / skipping a task, and
// automatically carries forward any unfinished remainder.
function resolveTaskProgress(tasks, profile, taskId, minutesSpent, mode) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return { tasks, message: null };

  const spent = Math.max(0, Math.min(minutesSpent, task.durationMinutes));
  const remaining = task.durationMinutes - spent;
  const finalStatus = mode === "skip" ? "skipped" : remaining <= 0 ? "completed" : "partial";

  const nowTs = new Date().toISOString();
  let updated = tasks.map((t) =>
    t.id === taskId
      ? {
          ...t,
          status: finalStatus,
          completedMinutes: spent,
          history: [...(t.history || []), { ts: nowTs, action: finalStatus, note: `${spent}m of ${t.durationMinutes}m` }],
        }
      : t
  );

  if (remaining <= 0) {
    return { tasks: updated, message: `"${task.title}" marked complete.` };
  }

  const searchStart = task.date && task.date >= todayStr() ? task.date : todayStr();
  const result = findSlotForDuration(updated, profile, remaining, searchStart, task.deadline || null, task.id);

  if (result) {
    const carry = {
      ...task,
      id: newId(),
      date: result.date,
      startTime: result.start,
      endTime: result.end,
      durationMinutes: remaining,
      status: "pending",
      completedMinutes: 0,
      parentId: task.id,
      isCarryOver: true,
      recurring: "none",
      history: [{ ts: nowTs, action: "rescheduled", note: result.reason }],
    };
    updated = [...updated, carry];
    return { tasks: updated, message: `${fmtDuration(remaining)} of "${task.title}" left. ${result.reason}` };
  }

  const carry = {
    ...task,
    id: newId(),
    date: null,
    startTime: null,
    endTime: null,
    durationMinutes: remaining,
    status: "unscheduled",
    completedMinutes: 0,
    parentId: task.id,
    isCarryOver: true,
    recurring: "none",
    history: [{ ts: nowTs, action: "unscheduled", note: "No open slot found in the next 21 days." }],
  };
  updated = [...updated, carry];
  return { tasks: updated, message: `Couldn't find room for the remaining ${fmtDuration(remaining)} of "${task.title}" — check Tasks to place it manually.` };
}

// Plan My Day: places any pending, non-fixed, unscheduled ("backlog") tasks
// into the best available slots for `date`, ordered by priority + deadline urgency.
function planMyDay(tasks, profile, date) {
  let working = tasks.map((t) => ({ ...t }));
  const backlog = working.filter(
    (t) => (t.status === "pending" || t.status === "unscheduled") && !t.isFixed && (!t.date || !t.startTime)
  );

  const scored = backlog
    .map((t) => {
      const urgency = t.deadline ? Math.max(0, daysBetween(date, t.deadline)) : 999;
      const score = PRIORITY_META[t.priority].weight * 10000 - urgency;
      return { t, score };
    })
    .sort((a, b) => b.score - a.score);

  const messages = [];
  for (const { t } of scored) {
    const result = findSlotForDuration(working, profile, t.durationMinutes, date, t.deadline || null, t.id);
    const idx = working.findIndex((w) => w.id === t.id);
    if (result) {
      working[idx] = { ...working[idx], date: result.date, startTime: result.start, endTime: result.end, status: "pending" };
      messages.push({ title: t.title, ok: true, text: result.reason });
    } else {
      working[idx] = { ...working[idx], status: "unscheduled" };
      messages.push({ title: t.title, ok: false, text: "No open slot found in the next 21 days." });
    }
  }
  return { tasks: working, messages };
}

function generateRecurringInstances(base) {
  const instances = [];
  const groupId = base.id;
  let count, step;
  if (base.recurring === "daily") { count = 13; step = 1; }
  else if (base.recurring === "weekdays") { count = 24; step = 1; }
  else if (base.recurring === "weekly") { count = 7; step = 7; }
  else return [];

  let added = 0;
  let offset = step;
  let guard = 0;
  while (added < count && guard < 60) {
    guard++;
    const date = addDays(base.date, offset);
    offset += base.recurring === "weekdays" ? 1 : step;
    if (base.recurring === "weekdays") {
      const dow = new Date(date + "T00:00:00").getDay();
      if (dow === 0 || dow === 6) continue;
    }
    instances.push({
      ...base,
      id: newId(),
      date,
      status: "pending",
      completedMinutes: 0,
      recurringGroupId: groupId,
      history: [],
      parentId: null,
      isCarryOver: false,
    });
    added++;
  }
  return instances;
}

/* =========================================================================
   SEED DATA
   ========================================================================= */

function seedTasks() {
  const t = todayStr();
  return [
    {
      id: newId(), title: "Deep Work: Q3 Strategy Doc", description: "Draft the first three sections.",
      category: "Work", priority: "High", date: t, startTime: "09:00", endTime: "11:00",
      durationMinutes: 120, deadline: addDays(t, 1), recurring: "none", notes: "",
      status: "pending", completedMinutes: 0, isFixed: false, parentId: null, isCarryOver: false, history: [],
    },
    {
      id: newId(), title: "Team Standup", description: "Daily sync with the product team.",
      category: "Work", priority: "Medium", date: t, startTime: "11:15", endTime: "11:30",
      durationMinutes: 15, deadline: null, recurring: "none", notes: "",
      status: "pending", completedMinutes: 0, isFixed: true, parentId: null, isCarryOver: false, history: [],
    },
    {
      id: newId(), title: "Lunch", description: "",
      category: "Personal", priority: "Low", date: t, startTime: "12:30", endTime: "13:15",
      durationMinutes: 45, deadline: null, recurring: "none", notes: "",
      status: "pending", completedMinutes: 0, isFixed: true, parentId: null, isCarryOver: false, history: [],
    },
    {
      id: newId(), title: "Write Client Report", description: "Summarize monthly metrics.",
      category: "Work", priority: "Medium", date: t, startTime: "14:00", endTime: "15:30",
      durationMinutes: 90, deadline: t, recurring: "none", notes: "",
      status: "pending", completedMinutes: 0, isFixed: false, parentId: null, isCarryOver: false, history: [],
    },
    {
      id: newId(), title: "Gym Session", description: "Legs + core.",
      category: "Health", priority: "Low", date: t, startTime: "18:00", endTime: "19:00",
      durationMinutes: 60, deadline: null, recurring: "none", notes: "",
      status: "pending", completedMinutes: 0, isFixed: false, parentId: null, isCarryOver: false, history: [],
    },
    {
      id: newId(), title: "Read: 'Deep Work'", description: "Chapter 3.",
      category: "Learning", priority: "Low", date: null, startTime: null, endTime: null,
      durationMinutes: 30, deadline: addDays(t, 3), recurring: "none", notes: "",
      status: "pending", completedMinutes: 0, isFixed: false, parentId: null, isCarryOver: false, history: [],
    },
  ];
}

/* =========================================================================
   SMALL UI PRIMITIVES
   ========================================================================= */

function IconBtn({ icon: Icon, onClick, label, active, size = 18, className = "" }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`sf-iconbtn ${active ? "sf-iconbtn-active" : ""} ${className}`}
      type="button"
    >
      <Icon size={size} />
    </button>
  );
}

function ProgressRing({ percent, size = 128, stroke = 12 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, percent)) / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--accent-a)" />
          <stop offset="100%" stopColor="var(--accent-b)" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--ring-track)" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke="url(#ringGrad)" strokeWidth={stroke} fill="none"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1)" }}
      />
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" className="sf-ring-num">
        {Math.round(percent)}%
      </text>
      <text x="50%" y="64%" textAnchor="middle" dominantBaseline="middle" className="sf-ring-sub">
        complete
      </text>
    </svg>
  );
}

function PriorityBadge({ priority }) {
  const meta = PRIORITY_META[priority] || PRIORITY_META.Medium;
  return (
    <span className="sf-badge" style={{ color: meta.color, background: `${meta.color}22`, borderColor: `${meta.color}44` }}>
      {meta.label}
    </span>
  );
}

function CategoryDot({ category }) {
  const c = CATEGORIES.find((c) => c.id === category)?.color || "#888";
  return <span className="sf-catdot" style={{ background: c }} />;
}

function StatusChip({ status }) {
  const map = {
    pending: { label: "Pending", color: "var(--text-secondary)" },
    inProgress: { label: "In focus", color: "var(--accent-a)" },
    completed: { label: "Completed", color: "var(--success)" },
    partial: { label: "Partial", color: "var(--warning)" },
    skipped: { label: "Skipped", color: "var(--danger)" },
    unscheduled: { label: "Needs a slot", color: "var(--danger)" },
  };
  const m = map[status] || map.pending;
  return <span className="sf-status" style={{ color: m.color }}>{m.label}</span>;
}

/* =========================================================================
   TASK CARD
   ========================================================================= */

function TaskCard({ task, onEdit, onComplete, onPartial, onSkip, onStartFocus, onDelete, isNext, compact }) {
  const meta = PRIORITY_META[task.priority] || PRIORITY_META.Medium;
  const done = task.status === "completed";
  const skipped = task.status === "skipped";
  const inactive = done || skipped || task.status === "partial";

  return (
    <div className={`sf-card sf-task ${isNext ? "sf-task-next" : ""} ${inactive ? "sf-task-inactive" : ""}`}>
      <div className="sf-task-time">
        {task.startTime ? (
          <>
            <div className="sf-task-time-main">{fmtTime12(task.startTime).split(" ")[0]}</div>
            <div className="sf-task-time-ampm">{fmtTime12(task.startTime).split(" ")[1]}</div>
          </>
        ) : (
          <div className="sf-task-time-unset">—</div>
        )}
      </div>
      <div className="sf-task-bar" style={{ background: meta.color }} />
      <div className="sf-task-body">
        <div className="sf-task-toprow">
          <CategoryDot category={task.category} />
          <span className="sf-task-title">{task.title}</span>
          {task.isFixed && <MapPin size={12} className="sf-fixed-icon" title="Fixed appointment" />}
          {task.isCarryOver && <span className="sf-carry-tag">carried forward</span>}
        </div>
        {!compact && task.description && <div className="sf-task-desc">{task.description}</div>}
        <div className="sf-task-meta">
          <span className="sf-task-duration"><Clock size={12} /> {fmtDuration(task.durationMinutes)}</span>
          <PriorityBadge priority={task.priority} />
          <StatusChip status={task.status} />
          {task.deadline && <span className="sf-task-deadline">Due {fmtDateShort(task.deadline)}</span>}
        </div>
        {task.status === "pending" && !compact && (
          <div className="sf-task-actions">
            <button className="sf-action sf-action-primary" onClick={() => onStartFocus(task)}><Play size={13} /> Focus</button>
            <button className="sf-action sf-action-success" onClick={() => onComplete(task)}><Check size={13} /> Done</button>
            <button className="sf-action" onClick={() => onPartial(task)}><Pause size={13} /> Partial</button>
            <button className="sf-action sf-action-muted" onClick={() => onSkip(task)}><SkipForward size={13} /> Skip</button>
          </div>
        )}
        {compact && (
          <div className="sf-task-actions">
            <button className="sf-action-ghost" onClick={() => onEdit(task)}><Edit3 size={13} /></button>
            <button className="sf-action-ghost" onClick={() => onDelete(task)}><Trash2 size={13} /></button>
          </div>
        )}
      </div>
      {!compact && (
        <button className="sf-task-editbtn" onClick={() => onEdit(task)} aria-label="Edit task"><Edit3 size={14} /></button>
      )}
    </div>
  );
}

/* =========================================================================
   FOCUS TIMER MODAL
   ========================================================================= */

function FocusTimerModal({ task, onClose, onFinish }) {
  const totalSec = task.durationMinutes * 60;
  const [remaining, setRemaining] = useState(totalSec);
  const [running, setRunning] = useState(true);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) {
            clearInterval(intervalRef.current);
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  useEffect(() => {
    if (remaining === 0) {
      const t = setTimeout(() => onFinish(task, task.durationMinutes), 400);
      return () => clearTimeout(t);
    }
  }, [remaining]);

  const elapsedMin = Math.round((totalSec - remaining) / 60);
  const mm = pad2(Math.floor(remaining / 60));
  const ss = pad2(remaining % 60);
  const pct = ((totalSec - remaining) / totalSec) * 100;

  return (
    <div className="sf-modal-overlay" onClick={onClose}>
      <div className="sf-modal sf-focus-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sf-focus-label">FOCUS MODE</div>
        <div className="sf-focus-title">{task.title}</div>
        <div className="sf-focus-ringwrap"><ProgressRing percent={pct} size={180} stroke={10} /></div>
        <div className="sf-focus-clock">{mm}:{ss}</div>
        <div className="sf-focus-buttons">
          <button className="sf-btn sf-btn-ghost" onClick={() => setRunning((r) => !r)}>
            {running ? <><Pause size={16} /> Pause</> : <><Play size={16} /> Resume</>}
          </button>
          <button className="sf-btn sf-btn-primary" onClick={() => onFinish(task, Math.max(1, elapsedMin || 1))}>
            <Check size={16} /> Finish now
          </button>
        </div>
        <button className="sf-modal-close" onClick={onClose}><X size={18} /></button>
      </div>
    </div>
  );
}

/* =========================================================================
   PARTIAL-COMPLETE PROMPT
   ========================================================================= */

function PartialModal({ task, onClose, onConfirm }) {
  const [minutes, setMinutes] = useState(Math.round(task.durationMinutes / 2));
  return (
    <div className="sf-modal-overlay" onClick={onClose}>
      <div className="sf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sf-modal-title">How much did you finish?</div>
        <div className="sf-modal-sub">{task.title} — {fmtDuration(task.durationMinutes)} planned</div>
        <input
          type="range" min="0" max={task.durationMinutes} value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          className="sf-slider"
        />
        <div className="sf-partial-readout">{fmtDuration(minutes)} <span>done</span> · {fmtDuration(task.durationMinutes - minutes)} <span>remaining</span></div>
        <div className="sf-modal-buttons">
          <button className="sf-btn sf-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="sf-btn sf-btn-primary" onClick={() => onConfirm(task, minutes)}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   TASK EDITOR
   ========================================================================= */

function emptyDraft(date) {
  return {
    id: null, title: "", description: "", category: "Work", priority: "Medium",
    date: date || "", startTime: "", durationMinutes: 30, deadline: "",
    recurring: "none", notes: "", isFixed: false,
  };
}

function TaskEditor({ draft, setDraft, tasks, profile, onSave, onClose, isNew }) {
  const [conflicts, setConflicts] = useState([]);
  const [suggested, setSuggested] = useState(null);

  const endTime = draft.startTime ? toTime(toMin(draft.startTime) + Number(draft.durationMinutes || 0)) : "";

  function checkConflicts() {
    if (!draft.date || !draft.startTime) { setConflicts([]); setSuggested(null); return; }
    const c = detectConflict(tasks, draft.date, draft.startTime, endTime, draft.id);
    setConflicts(c);
    setSuggested(null);
  }

  function findAlternative() {
    const res = findSlotForDuration(tasks, profile, Number(draft.durationMinutes || 30), draft.date || todayStr(), draft.deadline || null, draft.id);
    setSuggested(res);
  }

  function applySuggestion() {
    if (!suggested) return;
    setDraft((d) => ({ ...d, date: suggested.date, startTime: suggested.start }));
    setConflicts([]);
    setSuggested(null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    onSave();
  }

  return (
    <div className="sf-modal-overlay" onClick={onClose}>
      <form className="sf-modal sf-editor" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="sf-modal-title">{isNew ? "New task" : "Edit task"}</div>

        <label className="sf-field">
          <span>Title</span>
          <input required value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="What needs to get done?" />
        </label>

        <label className="sf-field">
          <span>Description</span>
          <textarea rows={2} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Optional details" />
        </label>

        <div className="sf-field-row">
          <label className="sf-field">
            <span>Category</span>
            <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
            </select>
          </label>
          <label className="sf-field">
            <span>Priority</span>
            <select value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}>
              {Object.keys(PRIORITY_META).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>

        <div className="sf-field-row">
          <label className="sf-field">
            <span>Date <em>(optional — leave blank to auto-place)</em></span>
            <input type="date" value={draft.date || ""} onChange={(e) => { setDraft((d) => ({ ...d, date: e.target.value })); }} onBlur={checkConflicts} />
          </label>
          <label className="sf-field">
            <span>Start time <em>(optional)</em></span>
            <input type="time" value={draft.startTime || ""} onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value }))} onBlur={checkConflicts} />
          </label>
        </div>

        <div className="sf-field-row">
          <label className="sf-field">
            <span>Duration (minutes)</span>
            <input type="number" min="5" step="5" required value={draft.durationMinutes}
              onChange={(e) => setDraft((d) => ({ ...d, durationMinutes: e.target.value }))} onBlur={checkConflicts} />
          </label>
          <label className="sf-field">
            <span>Deadline <em>(optional)</em></span>
            <input type="date" value={draft.deadline || ""} onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))} />
          </label>
        </div>

        {draft.startTime && <div className="sf-computed-end">Ends at {fmtTime12(endTime)}</div>}

        <label className="sf-field">
          <span>Repeats</span>
          <select value={draft.recurring} onChange={(e) => setDraft((d) => ({ ...d, recurring: e.target.value }))}>
            {RECURRING_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>

        <label className="sf-checkbox-field">
          <input type="checkbox" checked={draft.isFixed} onChange={(e) => setDraft((d) => ({ ...d, isFixed: e.target.checked }))} />
          <span>Fixed appointment — keep this exact time, never auto-move it</span>
        </label>

        <label className="sf-field">
          <span>Notes</span>
          <textarea rows={2} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Optional notes" />
        </label>

        {conflicts.length > 0 && (
          <div className="sf-conflict-box">
            <div className="sf-conflict-title"><AlertTriangle size={14} /> Overlaps with {conflicts.map((c) => c.title).join(", ")}</div>
            {!suggested ? (
              <button type="button" className="sf-action sf-action-primary" onClick={findAlternative}>Find next available slot</button>
            ) : suggested.date ? (
              <div className="sf-suggest-row">
                <span>{fmtDateLong(suggested.date)} at {fmtTime12(suggested.start)}</span>
                <button type="button" className="sf-action sf-action-success" onClick={applySuggestion}>Use this slot</button>
              </div>
            ) : (
              <span>No open slot found nearby — try a shorter duration.</span>
            )}
          </div>
        )}

        <div className="sf-modal-buttons">
          <button type="button" className="sf-btn sf-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="sf-btn sf-btn-primary">Save task</button>
        </div>
        <button type="button" className="sf-modal-close" onClick={onClose}><X size={18} /></button>
      </form>
    </div>
  );
}

/* =========================================================================
   ONBOARDING
   ========================================================================= */

function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ ...DEFAULT_PROFILE });

  const steps = [
    {
      title: "Welcome to SmartFlow", sub: "Let's set up your rhythm so scheduling works for you, not against you.",
      body: (
        <label className="sf-field">
          <span>What should we call you?</span>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Your name" />
        </label>
      ),
    },
    {
      title: "Working hours", sub: "When are you generally available for tasks and meetings?",
      body: (
        <div className="sf-field-row">
          <label className="sf-field"><span>Start</span><input type="time" value={form.workStart} onChange={(e) => setForm((f) => ({ ...f, workStart: e.target.value }))} /></label>
          <label className="sf-field"><span>End</span><input type="time" value={form.workEnd} onChange={(e) => setForm((f) => ({ ...f, workEnd: e.target.value }))} /></label>
        </div>
      ),
    },
    {
      title: "Sleep hours", sub: "We'll never schedule anything while you're asleep.",
      body: (
        <div className="sf-field-row">
          <label className="sf-field"><span>Bedtime</span><input type="time" value={form.sleepStart} onChange={(e) => setForm((f) => ({ ...f, sleepStart: e.target.value }))} /></label>
          <label className="sf-field"><span>Wake up</span><input type="time" value={form.sleepEnd} onChange={(e) => setForm((f) => ({ ...f, sleepEnd: e.target.value }))} /></label>
        </div>
      ),
    },
    {
      title: "Focus & breaks", sub: "Your preferred deep-focus window, and the buffer to leave between tasks.",
      body: (
        <>
          <div className="sf-field-row">
            <label className="sf-field"><span>Focus start</span><input type="time" value={form.focusStart} onChange={(e) => setForm((f) => ({ ...f, focusStart: e.target.value }))} /></label>
            <label className="sf-field"><span>Focus end</span><input type="time" value={form.focusEnd} onChange={(e) => setForm((f) => ({ ...f, focusEnd: e.target.value }))} /></label>
          </div>
          <label className="sf-field">
            <span>Break between tasks (minutes)</span>
            <input type="number" min="0" step="5" value={form.breakDuration} onChange={(e) => setForm((f) => ({ ...f, breakDuration: Number(e.target.value) }))} />
          </label>
        </>
      ),
    },
  ];

  const isLast = step === steps.length - 1;

  return (
    <div className="sf-onboarding">
      <div className="sf-onboarding-progress">
        {steps.map((_, i) => <span key={i} className={`sf-dot ${i <= step ? "sf-dot-active" : ""}`} />)}
      </div>
      <Sparkles size={28} className="sf-onboarding-icon" />
      <div className="sf-onboarding-title">{steps[step].title}</div>
      <div className="sf-onboarding-sub">{steps[step].sub}</div>
      <div className="sf-onboarding-body">{steps[step].body}</div>
      <div className="sf-onboarding-nav">
        {step > 0 && <button className="sf-btn sf-btn-ghost" onClick={() => setStep((s) => s - 1)}>Back</button>}
        <button className="sf-btn sf-btn-primary" style={{ marginLeft: "auto" }}
          onClick={() => (isLast ? onComplete(form) : setStep((s) => s + 1))}>
          {isLast ? "Start planning" : "Continue"} <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

/* =========================================================================
   TODAY SCREEN
   ========================================================================= */

function TodayScreen({ tasks, profile, onEdit, onComplete, onPartial, onSkip, onStartFocus, onPlanMyDay, banner, dismissBanner }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(iv);
  }, []);

  const t = todayStr();
  const todays = getTasksForDate(tasks, t);
  const completed = todays.filter((x) => x.status === "completed").length;
  const skipped = todays.filter((x) => x.status === "skipped").length;
  const partial = todays.filter((x) => x.status === "partial").length;
  const pending = todays.filter((x) => x.status === "pending" || x.status === "inProgress");
  const total = todays.length || 1;
  const percent = ((completed + partial * 0.5) / total) * 100;
  const freeMin = totalFreeMinutes(tasks, profile, t);
  const backlogCount = tasks.filter((x) => (x.status === "pending" || x.status === "unscheduled") && !x.isFixed && (!x.date || !x.startTime)).length;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nextTask = pending.find((x) => toMin(x.endTime) >= nowMin) || pending[0];

  return (
    <div className="sf-screen">
      <div className="sf-today-header">
        <div>
          <div className="sf-greeting">Hi, {profile.name || "there"} 👋</div>
          <div className="sf-date">{fmtDateLong(t)}</div>
        </div>
      </div>

      {banner && (
        <div className="sf-banner">
          <Zap size={14} />
          <span>{banner}</span>
          <button onClick={dismissBanner}><X size={14} /></button>
        </div>
      )}

      <div className="sf-card sf-hero">
        <ProgressRing percent={isNaN(percent) ? 0 : percent} />
        <div className="sf-hero-stats">
          <div className="sf-hero-stat"><CheckCircle2 size={15} style={{ color: "var(--success)" }} /> {completed} completed</div>
          <div className="sf-hero-stat"><CircleDot size={15} style={{ color: "var(--text-secondary)" }} /> {pending.length} remaining</div>
          <div className="sf-hero-stat"><RotateCcw size={15} style={{ color: "var(--warning)" }} /> {partial + skipped} carried forward</div>
          <div className="sf-hero-stat"><Clock size={15} style={{ color: "var(--accent-a)" }} /> {fmtDuration(freeMin)} free today</div>
        </div>
      </div>

      {backlogCount > 0 && (
        <button className="sf-plan-btn" onClick={onPlanMyDay}>
          <Zap size={16} /> Plan My Day <span className="sf-plan-count">{backlogCount} unscheduled</span>
        </button>
      )}

      {nextTask && (
        <div className="sf-next-label">Up next</div>
      )}
      {nextTask && (
        <TaskCard task={nextTask} isNext onEdit={onEdit} onComplete={onComplete} onPartial={onPartial} onSkip={onSkip} onStartFocus={onStartFocus} />
      )}

      <div className="sf-next-label">Today's timeline</div>
      {todays.length === 0 && <div className="sf-empty">Nothing scheduled yet. Add a task or try Plan My Day.</div>}
      <div className="sf-timeline">
        {todays.filter((x) => x.id !== nextTask?.id).map((task) => (
          <TaskCard key={task.id} task={task} onEdit={onEdit} onComplete={onComplete} onPartial={onPartial} onSkip={onSkip} onStartFocus={onStartFocus} />
        ))}
      </div>
    </div>
  );
}

/* =========================================================================
   CALENDAR SCREEN
   ========================================================================= */

function CalendarScreen({ tasks, profile, onEdit, onComplete, onPartial, onSkip, onStartFocus }) {
  const [mode, setMode] = useState("day");
  const [cursor, setCursor] = useState(todayStr());

  return (
    <div className="sf-screen">
      <div className="sf-cal-modes">
        {["day", "week", "month"].map((m) => (
          <button key={m} className={`sf-cal-mode ${mode === m ? "sf-cal-mode-active" : ""}`} onClick={() => setMode(m)}>
            {m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {mode === "day" && (
        <DayView date={cursor} setDate={setCursor} tasks={tasks} onEdit={onEdit} onComplete={onComplete} onPartial={onPartial} onSkip={onSkip} onStartFocus={onStartFocus} />
      )}
      {mode === "week" && (
        <WeekView date={cursor} setDate={setCursor} tasks={tasks} onSelectDay={(d) => { setCursor(d); setMode("day"); }} />
      )}
      {mode === "month" && (
        <MonthView date={cursor} setDate={setCursor} tasks={tasks} onSelectDay={(d) => { setCursor(d); setMode("day"); }} />
      )}
    </div>
  );
}

function DayView({ date, setDate, tasks, onEdit, onComplete, onPartial, onSkip, onStartFocus }) {
  const dayTasks = getTasksForDate(tasks, date);
  return (
    <div>
      <div className="sf-day-nav">
        <IconBtn icon={ChevronLeft} onClick={() => setDate(addDays(date, -1))} label="Previous day" />
        <div className="sf-day-nav-label">{fmtDateLong(date)} {date === todayStr() && <span className="sf-today-pill">Today</span>}</div>
        <IconBtn icon={ChevronRight} onClick={() => setDate(addDays(date, 1))} label="Next day" />
      </div>
      {dayTasks.length === 0 && <div className="sf-empty">No tasks on this day.</div>}
      <div className="sf-timeline">
        {dayTasks.map((task) => (
          <TaskCard key={task.id} task={task} onEdit={onEdit} onComplete={onComplete} onPartial={onPartial} onSkip={onSkip} onStartFocus={onStartFocus} />
        ))}
      </div>
    </div>
  );
}

function WeekView({ date, setDate, tasks, onSelectDay }) {
  const start = addDays(date, -new Date(date + "T00:00:00").getDay());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div>
      <div className="sf-day-nav">
        <IconBtn icon={ChevronLeft} onClick={() => setDate(addDays(date, -7))} label="Previous week" />
        <div className="sf-day-nav-label">{fmtDateShort(start)} – {fmtDateShort(addDays(start, 6))}</div>
        <IconBtn icon={ChevronRight} onClick={() => setDate(addDays(date, 7))} label="Next week" />
      </div>
      <div className="sf-week-grid">
        {days.map((d) => {
          const dTasks = getTasksForDate(tasks, d);
          const isToday = d === todayStr();
          return (
            <button key={d} className={`sf-week-col ${isToday ? "sf-week-col-today" : ""}`} onClick={() => onSelectDay(d)}>
              <div className="sf-week-col-head">
                <span className="sf-week-dayname">{dayNameShort(d)}</span>
                <span className="sf-week-daynum">{Number(d.split("-")[2])}</span>
              </div>
              <div className="sf-week-col-body">
                {dTasks.slice(0, 4).map((t) => (
                  <div key={t.id} className="sf-week-chip" style={{ background: `${PRIORITY_META[t.priority].color}26`, color: PRIORITY_META[t.priority].color }}>
                    {t.title}
                  </div>
                ))}
                {dTasks.length > 4 && <div className="sf-week-more">+{dTasks.length - 4} more</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthView({ date, setDate, tasks, onSelectDay }) {
  const d = new Date(date + "T00:00:00");
  const year = d.getFullYear(), month = d.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(`${year}-${pad2(month + 1)}-${pad2(day)}`);

  function shiftMonth(n) {
    const nd = new Date(year, month + n, 1);
    setDate(`${nd.getFullYear()}-${pad2(nd.getMonth() + 1)}-${pad2(1)}`);
  }

  return (
    <div>
      <div className="sf-day-nav">
        <IconBtn icon={ChevronLeft} onClick={() => shiftMonth(-1)} label="Previous month" />
        <div className="sf-day-nav-label">{first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</div>
        <IconBtn icon={ChevronRight} onClick={() => shiftMonth(1)} label="Next month" />
      </div>
      <div className="sf-month-weekdays">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => <span key={i}>{w}</span>)}
      </div>
      <div className="sf-month-grid">
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="sf-month-cell sf-month-cell-empty" />;
          const dTasks = getTasksForDate(tasks, c);
          const isToday = c === todayStr();
          const density = Math.min(3, dTasks.length);
          return (
            <button key={i} className={`sf-month-cell ${isToday ? "sf-month-cell-today" : ""}`} onClick={() => onSelectDay(c)}>
              <span>{Number(c.split("-")[2])}</span>
              {density > 0 && (
                <div className="sf-month-dots">
                  {Array.from({ length: density }).map((_, k) => <span key={k} className="sf-month-dot" />)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* =========================================================================
   TASKS SCREEN
   ========================================================================= */

function TasksScreen({ tasks, onEdit, onDelete, onNew }) {
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const filtered = tasks
    .filter((t) => t.status !== "cancelled")
    .filter((t) => !query || t.title.toLowerCase().includes(query.toLowerCase()))
    .filter((t) => catFilter === "All" || t.category === catFilter)
    .filter((t) => statusFilter === "All" || t.status === statusFilter)
    .sort((a, b) => {
      const da = a.date || "9999", db = b.date || "9999";
      if (da !== db) return da.localeCompare(db);
      return toMin(a.startTime) - toMin(b.startTime);
    });

  return (
    <div className="sf-screen">
      <div className="sf-search-row">
        <Search size={16} className="sf-search-icon" />
        <input className="sf-search-input" placeholder="Search tasks..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="sf-chip-row">
        <button className={`sf-chip ${catFilter === "All" ? "sf-chip-active" : ""}`} onClick={() => setCatFilter("All")}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} className={`sf-chip ${catFilter === c.id ? "sf-chip-active" : ""}`} onClick={() => setCatFilter(c.id)}>{c.id}</button>
        ))}
      </div>
      <div className="sf-chip-row">
        {["All", "pending", "completed", "partial", "skipped", "unscheduled"].map((s) => (
          <button key={s} className={`sf-chip ${statusFilter === s ? "sf-chip-active" : ""}`} onClick={() => setStatusFilter(s)}>
            {s === "All" ? "All statuses" : s}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <div className="sf-empty">No tasks match your filters.</div>}
      <div className="sf-timeline">
        {filtered.map((task) => (
          <div key={task.id} className="sf-card sf-task sf-task-compact">
            <div className="sf-task-bar" style={{ background: PRIORITY_META[task.priority].color }} />
            <div className="sf-task-body">
              <div className="sf-task-toprow">
                <CategoryDot category={task.category} />
                <span className="sf-task-title">{task.title}</span>
              </div>
              <div className="sf-task-meta">
                <span className="sf-task-duration">
                  <Clock size={12} /> {task.date ? `${fmtDateShort(task.date)}${task.startTime ? " · " + fmtTime12(task.startTime) : ""}` : "Unscheduled"} · {fmtDuration(task.durationMinutes)}
                </span>
                <PriorityBadge priority={task.priority} />
                <StatusChip status={task.status} />
              </div>
            </div>
            <div className="sf-task-actions-col">
              <button className="sf-action-ghost" onClick={() => onEdit(task)}><Edit3 size={14} /></button>
              <button className="sf-action-ghost" onClick={() => onDelete(task)}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      <button className="sf-fab" onClick={onNew}><Plus size={22} /></button>
    </div>
  );
}

/* =========================================================================
   INSIGHTS SCREEN
   ========================================================================= */

function computeStreak(tasks) {
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = addDays(todayStr(), -i);
    const dTasks = getTasksForDate(tasks, d);
    const completedCount = dTasks.filter((t) => t.status === "completed" || t.status === "partial").length;
    if (i === 0 && completedCount === 0 && dTasks.length > 0) continue; // today may still be in progress
    if (completedCount > 0) streak++;
    else break;
  }
  return streak;
}

function InsightsScreen({ tasks }) {
  const weekData = useMemo(() => {
    const arr = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(todayStr(), -i);
      const dTasks = getTasksForDate(tasks, d);
      arr.push({
        day: dayNameShort(d),
        completed: dTasks.filter((t) => t.status === "completed").length,
        partial: dTasks.filter((t) => t.status === "partial").length,
        skipped: dTasks.filter((t) => t.status === "skipped").length,
      });
    }
    return arr;
  }, [tasks]);

  const categoryData = useMemo(() => {
    const map = {};
    tasks.filter((t) => t.status === "completed" || t.status === "partial").forEach((t) => {
      const mins = t.status === "completed" ? t.durationMinutes : t.completedMinutes;
      map[t.category] = (map[t.category] || 0) + mins;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).filter((d) => d.value > 0);
  }, [tasks]);

  const streak = computeStreak(tasks);
  const totalCompleted = tasks.filter((t) => t.status === "completed").length;
  const totalPartial = tasks.filter((t) => t.status === "partial").length;
  const totalSkipped = tasks.filter((t) => t.status === "skipped").length;
  const totalTracked = totalCompleted + totalPartial + totalSkipped;
  const completionRate = totalTracked ? Math.round(((totalCompleted + totalPartial * 0.5) / totalTracked) * 100) : 0;
  const carriedCount = tasks.filter((t) => t.isCarryOver).length;

  return (
    <div className="sf-screen">
      <div className="sf-insight-stats">
        <div className="sf-card sf-stat-card">
          <Flame size={20} style={{ color: "var(--warning)" }} />
          <div className="sf-stat-num">{streak}</div>
          <div className="sf-stat-label">day streak</div>
        </div>
        <div className="sf-card sf-stat-card">
          <TrendingUp size={20} style={{ color: "var(--success)" }} />
          <div className="sf-stat-num">{completionRate}%</div>
          <div className="sf-stat-label">completion rate</div>
        </div>
        <div className="sf-card sf-stat-card">
          <RotateCcw size={20} style={{ color: "var(--accent-a)" }} />
          <div className="sf-stat-num">{carriedCount}</div>
          <div className="sf-stat-label">tasks carried forward</div>
        </div>
      </div>

      <div className="sf-card sf-chart-card">
        <div className="sf-chart-title">Last 7 days</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={weekData} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="day" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} axisLine={false} tickLine={false} width={22} />
            <Tooltip contentStyle={{ background: "var(--tooltip-bg)", border: "1px solid var(--card-border)", borderRadius: 10, fontSize: 12 }} />
            <Bar dataKey="completed" stackId="a" fill="var(--success)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="partial" stackId="a" fill="var(--warning)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="skipped" stackId="a" fill="var(--danger)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="sf-card sf-chart-card">
        <div className="sf-chart-title">Focus time by category</div>
        {categoryData.length === 0 ? (
          <div className="sf-empty">Complete a few tasks to see this breakdown.</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                {categoryData.map((entry, i) => (
                  <Cell key={i} fill={CATEGORIES.find((c) => c.id === entry.name)?.color || "#888"} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => fmtDuration(v)}
                contentStyle={{ background: "var(--tooltip-bg)", border: "1px solid var(--card-border)", borderRadius: 10, fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
        <div className="sf-legend-row">
          {categoryData.map((d) => (
            <span key={d.name} className="sf-legend-item">
              <span className="sf-catdot" style={{ background: CATEGORIES.find((c) => c.id === d.name)?.color }} />
              {d.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   SETTINGS SCREEN
   ========================================================================= */

function SettingsScreen({ profile, setProfile, theme, setTheme, onExport, onReset, taskCount }) {
  const [local, setLocal] = useState(profile);
  useEffect(() => setLocal(profile), [profile]);

  function save() { setProfile(local); }

  return (
    <div className="sf-screen">
      <div className="sf-card sf-settings-block">
        <div className="sf-settings-title">Appearance</div>
        <div className="sf-theme-toggle">
          <button className={`sf-theme-opt ${theme === "dark" ? "sf-theme-opt-active" : ""}`} onClick={() => setTheme("dark")}><Moon size={15} /> Dark</button>
          <button className={`sf-theme-opt ${theme === "light" ? "sf-theme-opt-active" : ""}`} onClick={() => setTheme("light")}><Sun size={15} /> Light</button>
        </div>
      </div>

      <div className="sf-card sf-settings-block">
        <div className="sf-settings-title">Your schedule</div>
        <label className="sf-field"><span>Name</span><input value={local.name} onChange={(e) => setLocal((f) => ({ ...f, name: e.target.value }))} /></label>
        <div className="sf-field-row">
          <label className="sf-field"><span>Work start</span><input type="time" value={local.workStart} onChange={(e) => setLocal((f) => ({ ...f, workStart: e.target.value }))} /></label>
          <label className="sf-field"><span>Work end</span><input type="time" value={local.workEnd} onChange={(e) => setLocal((f) => ({ ...f, workEnd: e.target.value }))} /></label>
        </div>
        <div className="sf-field-row">
          <label className="sf-field"><span>Sleep start</span><input type="time" value={local.sleepStart} onChange={(e) => setLocal((f) => ({ ...f, sleepStart: e.target.value }))} /></label>
          <label className="sf-field"><span>Wake up</span><input type="time" value={local.sleepEnd} onChange={(e) => setLocal((f) => ({ ...f, sleepEnd: e.target.value }))} /></label>
        </div>
        <div className="sf-field-row">
          <label className="sf-field"><span>Focus start</span><input type="time" value={local.focusStart} onChange={(e) => setLocal((f) => ({ ...f, focusStart: e.target.value }))} /></label>
          <label className="sf-field"><span>Focus end</span><input type="time" value={local.focusEnd} onChange={(e) => setLocal((f) => ({ ...f, focusEnd: e.target.value }))} /></label>
        </div>
        <label className="sf-field">
          <span>Break between tasks (minutes)</span>
          <input type="number" min="0" step="5" value={local.breakDuration} onChange={(e) => setLocal((f) => ({ ...f, breakDuration: Number(e.target.value) }))} />
        </label>
        <button className="sf-btn sf-btn-primary" onClick={save}>Save changes</button>
      </div>

      <div className="sf-card sf-settings-block">
        <div className="sf-settings-title">Notifications</div>
        <label className="sf-switch-row">
          <span><Bell size={14} /> Task reminders</span>
          <input type="checkbox" checked={local.notifRemind} onChange={(e) => { const f = { ...local, notifRemind: e.target.checked }; setLocal(f); setProfile(f); }} />
        </label>
        <label className="sf-switch-row">
          <span><Bell size={14} /> Daily plan summary</span>
          <input type="checkbox" checked={local.notifDaily} onChange={(e) => { const f = { ...local, notifDaily: e.target.checked }; setLocal(f); setProfile(f); }} />
        </label>
      </div>

      <div className="sf-card sf-settings-block">
        <div className="sf-settings-title">Data</div>
        <div className="sf-settings-sub">{taskCount} tasks stored on this device, synced automatically.</div>
        <button className="sf-btn sf-btn-ghost" onClick={onExport}><Download size={15} /> Export data as JSON</button>
        <button className="sf-btn sf-btn-danger" onClick={onReset}><Trash2 size={15} /> Reset all data</button>
      </div>
    </div>
  );
}

/* =========================================================================
   ROOT APP
   ========================================================================= */

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfileState] = useState(DEFAULT_PROFILE);
  const [tasks, setTasks] = useState([]);
  const [onboarded, setOnboarded] = useState(false);
  const [theme, setThemeState] = useState("dark");
  const [screen, setScreen] = useState("today");

  const [editorDraft, setEditorDraft] = useState(null);
  const [editorIsNew, setEditorIsNew] = useState(true);
  const [focusTask, setFocusTask] = useState(null);
  const [partialTask, setPartialTask] = useState(null);
  const [banner, setBanner] = useState(null);
  const bannerTimer = useRef(null);

  // ---- load persisted state ----
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setProfileState(parsed.profile || DEFAULT_PROFILE);
          setTasks(parsed.tasks || seedTasks());
          setOnboarded(!!parsed.onboarded);
          setThemeState(parsed.theme || "dark");
        } else {
          setTasks(seedTasks());
        }
      } catch (e) {
        setTasks(seedTasks());
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // ---- persist on change ----
  useEffect(() => {
    if (!loaded) return;
    const payload = JSON.stringify({ profile, tasks, onboarded, theme });
    const t = setTimeout(async () => {
      try { await window.storage.set(STORAGE_KEY, payload, false); } catch (e) { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [profile, tasks, onboarded, theme, loaded]);

  function showBanner(msg) {
    setBanner(msg);
    clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 7000);
  }

  function setProfile(p) { setProfileState(p); }
  function setTheme(th) { setThemeState(th); }

  function openNewTask(prefillDate) {
    setEditorDraft(emptyDraft(prefillDate));
    setEditorIsNew(true);
  }
  function openEditTask(task) {
    setEditorDraft({
      id: task.id, title: task.title, description: task.description, category: task.category,
      priority: task.priority, date: task.date || "", startTime: task.startTime || "",
      durationMinutes: task.durationMinutes, deadline: task.deadline || "",
      recurring: task.recurring || "none", notes: task.notes || "", isFixed: !!task.isFixed,
    });
    setEditorIsNew(false);
  }

  function saveDraft() {
    const d = editorDraft;
    const duration = Math.max(5, Number(d.durationMinutes) || 30);
    let date = d.date || null;
    let startTime = d.startTime || null;
    let endTime = startTime ? toTime(toMin(startTime) + duration) : null;

    if (editorIsNew) {
      const base = {
        id: newId(), title: d.title.trim(), description: d.description.trim(), category: d.category,
        priority: d.priority, date, startTime, endTime, durationMinutes: duration,
        deadline: d.deadline || null, recurring: d.recurring, notes: d.notes.trim(),
        status: "pending", completedMinutes: 0, isFixed: d.isFixed, parentId: null, isCarryOver: false, history: [],
      };

      let toAdd = [base];
      // Auto-place if no explicit time was given
      if (!date || !startTime) {
        const result = findSlotForDuration(tasks, profile, duration, todayStr(), d.deadline || null, base.id);
        if (result) {
          toAdd[0] = { ...base, date: result.date, startTime: result.start, endTime: result.end };
          showBanner(result.reason);
        } else {
          toAdd[0] = { ...base, status: "unscheduled" };
          showBanner("No open slot found in the next 21 days — placed in your backlog.");
        }
      }
      if (base.recurring !== "none" && date) {
        toAdd = toAdd.concat(generateRecurringInstances({ ...toAdd[0] }));
      }
      setTasks((prev) => [...prev, ...toAdd]);
    } else {
      setTasks((prev) => prev.map((t) => t.id === d.id ? {
        ...t, title: d.title.trim(), description: d.description.trim(), category: d.category,
        priority: d.priority, date, startTime, endTime, durationMinutes: duration,
        deadline: d.deadline || null, recurring: d.recurring, notes: d.notes.trim(), isFixed: d.isFixed,
      } : t));
    }
    setEditorDraft(null);
  }

  function deleteTask(task) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
  }

  function handleComplete(task) {
    const { tasks: updated, message } = resolveTaskProgress(tasks, profile, task.id, task.durationMinutes, "complete");
    setTasks(updated);
    showBanner(message);
  }
  function handleSkip(task) {
    const { tasks: updated, message } = resolveTaskProgress(tasks, profile, task.id, 0, "skip");
    setTasks(updated);
    showBanner(message);
  }
  function handlePartialConfirm(task, minutes) {
    const { tasks: updated, message } = resolveTaskProgress(tasks, profile, task.id, minutes, "partial");
    setTasks(updated);
    showBanner(message);
    setPartialTask(null);
  }
  function handleFocusFinish(task, elapsedMinutes) {
    setFocusTask(null);
    const mode = elapsedMinutes >= task.durationMinutes ? "complete" : "partial";
    const { tasks: updated, message } = resolveTaskProgress(tasks, profile, task.id, elapsedMinutes, mode);
    setTasks(updated);
    showBanner(message);
  }

  function handlePlanMyDay() {
    const { tasks: updated, messages } = planMyDay(tasks, profile, todayStr());
    setTasks(updated);
    const ok = messages.filter((m) => m.ok).length;
    showBanner(`Plan My Day placed ${ok} of ${messages.length} pending task${messages.length === 1 ? "" : "s"}.`);
  }

  function handleExport() {
    try {
      const payload = JSON.stringify({ profile, tasks }, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "smartflow-export.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      showBanner("Export failed — your browser may be blocking downloads here.");
    }
  }

  function handleReset() {
    setTasks(seedTasks());
    setProfileState(DEFAULT_PROFILE);
    setThemeState("dark");
    showBanner("All data reset.");
  }

  if (!loaded) {
    return <div className="sf-root" data-theme="dark"><ThemeStyles /><div className="sf-loading">Loading SmartFlow…</div></div>;
  }

  if (!onboarded) {
    return (
      <div className="sf-root" data-theme={theme}>
        <ThemeStyles />
        <div className="sf-phone">
          <Onboarding onComplete={(form) => { setProfileState(form); setThemeState(form.theme); setOnboarded(true); }} />
        </div>
      </div>
    );
  }

  return (
    <div className="sf-root" data-theme={theme}>
      <ThemeStyles />
      <div className="sf-phone">
        <div className="sf-phone-content">
          {screen === "today" && (
            <TodayScreen
              tasks={tasks} profile={profile}
              onEdit={openEditTask} onComplete={handleComplete}
              onPartial={(t) => setPartialTask(t)} onSkip={handleSkip}
              onStartFocus={(t) => setFocusTask(t)}
              onPlanMyDay={handlePlanMyDay}
              banner={banner} dismissBanner={() => setBanner(null)}
            />
          )}
          {screen === "calendar" && (
            <CalendarScreen tasks={tasks} profile={profile} onEdit={openEditTask} onComplete={handleComplete} onPartial={(t) => setPartialTask(t)} onSkip={handleSkip} onStartFocus={(t) => setFocusTask(t)} />
          )}
          {screen === "tasks" && (
            <TasksScreen tasks={tasks} onEdit={openEditTask} onDelete={deleteTask} onNew={() => openNewTask(null)} />
          )}
          {screen === "insights" && <InsightsScreen tasks={tasks} />}
          {screen === "settings" && (
            <SettingsScreen profile={profile} setProfile={setProfile} theme={theme} setTheme={setTheme}
              onExport={handleExport} onReset={handleReset} taskCount={tasks.length} />
          )}
        </div>

        <div className="sf-bottomnav">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} className={`sf-navitem ${screen === item.id ? "sf-navitem-active" : ""}`} onClick={() => setScreen(item.id)}>
              <item.icon size={20} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {screen !== "tasks" && (
          <button className="sf-fab sf-fab-raised" onClick={() => openNewTask(screen === "calendar" ? todayStr() : null)}>
            <Plus size={22} />
          </button>
        )}
      </div>

      {editorDraft && (
        <TaskEditor draft={editorDraft} setDraft={setEditorDraft} tasks={tasks} profile={profile}
          onSave={saveDraft} onClose={() => setEditorDraft(null)} isNew={editorIsNew} />
      )}
      {focusTask && <FocusTimerModal task={focusTask} onClose={() => setFocusTask(null)} onFinish={handleFocusFinish} />}
      {partialTask && <PartialModal task={partialTask} onClose={() => setPartialTask(null)} onConfirm={handlePartialConfirm} />}
    </div>
  );
}

/* =========================================================================
   THEME / GLOBAL STYLES
   ========================================================================= */

function ThemeStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

      .sf-root[data-theme="dark"] {
        --bg-grad: linear-gradient(165deg, #090c16 0%, #0e1424 45%, #131a2e 100%);
        --card-bg: rgba(255,255,255,0.045);
        --card-border: rgba(255,255,255,0.09);
        --text-primary: #edf1fa;
        --text-secondary: #8e97b0;
        --text-tertiary: #5c6480;
        --accent-a: #7dd3fc;
        --accent-b: #a78bfa;
        --success: #6ee7b7;
        --warning: #fbbf6b;
        --danger: #ff7a85;
        --nav-bg: rgba(12,16,28,0.9);
        --ring-track: rgba(255,255,255,0.08);
        --chart-grid: rgba(255,255,255,0.06);
        --tooltip-bg: #161d30;
        --input-bg: rgba(255,255,255,0.05);
        --overlay: rgba(4,6,12,0.72);
        --modal-bg: #131a2c;
      }
      .sf-root[data-theme="light"] {
        --bg-grad: linear-gradient(165deg, #f4f6fb 0%, #eef1f9 50%, #e8ecf7 100%);
        --card-bg: rgba(255,255,255,0.8);
        --card-border: rgba(20,25,45,0.08);
        --text-primary: #1a2035;
        --text-secondary: #5c6480;
        --text-tertiary: #8790a8;
        --accent-a: #4c9fe0;
        --accent-b: #8b6fe8;
        --success: #22b679;
        --warning: #d9871f;
        --danger: #e0525f;
        --nav-bg: rgba(255,255,255,0.9);
        --ring-track: rgba(20,25,45,0.08);
        --chart-grid: rgba(20,25,45,0.06);
        --tooltip-bg: #ffffff;
        --input-bg: rgba(20,25,45,0.04);
        --overlay: rgba(20,25,45,0.35);
        --modal-bg: #ffffff;
      }

      .sf-root {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        display: flex; justify-content: center;
        min-height: 100vh; width: 100%;
        background: var(--bg-grad);
        color: var(--text-primary);
        padding: 20px 12px;
        box-sizing: border-box;
      }
      .sf-loading { padding: 40px; text-align: center; color: var(--text-secondary); }

      .sf-phone {
        width: 100%; max-width: 430px;
        background: var(--bg-grad);
        border-radius: 32px;
        border: 1px solid var(--card-border);
        box-shadow: 0 30px 80px -20px rgba(0,0,0,0.5);
        position: relative;
        display: flex; flex-direction: column;
        height: min(860px, 92vh);
        overflow: hidden;
      }
      .sf-phone-content { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
      .sf-screen { padding: 20px 16px 100px; }

      * { box-sizing: border-box; }
      button { font-family: inherit; cursor: pointer; }

      /* ---------- header ---------- */
      .sf-today-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
      .sf-greeting { font-family: 'Space Grotesk', sans-serif; font-size: 21px; font-weight: 600; }
      .sf-date { color: var(--text-secondary); font-size: 13px; margin-top: 2px; }

      .sf-banner {
        display: flex; align-items: center; gap: 8px;
        background: linear-gradient(90deg, rgba(125,211,252,0.14), rgba(167,139,250,0.14));
        border: 1px solid var(--card-border);
        color: var(--text-primary);
        border-radius: 14px; padding: 10px 12px; font-size: 12.5px; margin-bottom: 14px;
      }
      .sf-banner span { flex: 1; line-height: 1.4; }
      .sf-banner button { background: none; border: none; color: var(--text-secondary); display: flex; }

      /* ---------- cards ---------- */
      .sf-card {
        background: var(--card-bg);
        border: 1px solid var(--card-border);
        border-radius: 20px;
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
      }
      .sf-hero { display: flex; align-items: center; gap: 18px; padding: 20px; margin-bottom: 16px; }
      .sf-ring-num { font-family: 'Space Grotesk', sans-serif; font-size: 24px; font-weight: 700; fill: var(--text-primary); }
      .sf-ring-sub { font-size: 10px; fill: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; }
      .sf-hero-stats { display: flex; flex-direction: column; gap: 8px; flex: 1; }
      .sf-hero-stat { font-size: 12.5px; color: var(--text-secondary); display: flex; align-items: center; gap: 7px; }

      .sf-plan-btn {
        width: 100%; display: flex; align-items: center; gap: 8px; justify-content: center;
        background: linear-gradient(135deg, var(--accent-a), var(--accent-b));
        color: #0a0e1a; font-weight: 600; font-size: 14px;
        border: none; border-radius: 16px; padding: 13px; margin-bottom: 18px;
        box-shadow: 0 8px 24px -8px rgba(125,211,252,0.4);
        transition: transform 0.15s ease;
      }
      .sf-plan-btn:active { transform: scale(0.98); }
      .sf-plan-count { background: rgba(10,14,26,0.18); border-radius: 20px; padding: 2px 9px; font-size: 11px; font-weight: 500; }

      .sf-next-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); margin: 18px 2px 8px; }
      .sf-empty { color: var(--text-tertiary); font-size: 13px; padding: 18px 4px; text-align: center; }

      /* ---------- task card ---------- */
      .sf-timeline { display: flex; flex-direction: column; gap: 10px; }
      .sf-task { display: flex; gap: 0; padding: 12px 14px 12px 0; position: relative; margin-bottom: 0; transition: opacity 0.2s; }
      .sf-task-inactive { opacity: 0.55; }
      .sf-task-next { border-color: var(--accent-a); box-shadow: 0 0 0 1px var(--accent-a) inset, 0 8px 24px -10px rgba(125,211,252,0.35); }
      .sf-task-time { width: 54px; flex-shrink: 0; text-align: center; padding-top: 12px; }
      .sf-task-time-main { font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 600; }
      .sf-task-time-ampm { font-size: 9px; color: var(--text-tertiary); }
      .sf-task-time-unset { color: var(--text-tertiary); font-size: 13px; }
      .sf-task-bar { width: 3px; border-radius: 3px; margin-right: 12px; align-self: stretch; opacity: 0.85; }
      .sf-task-body { flex: 1; min-width: 0; padding-top: 2px; }
      .sf-task-toprow { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
      .sf-task-title { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sf-fixed-icon { color: var(--text-tertiary); flex-shrink: 0; }
      .sf-carry-tag { font-size: 9.5px; color: var(--warning); background: rgba(251,191,107,0.12); border-radius: 8px; padding: 1px 6px; flex-shrink: 0; }
      .sf-task-desc { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
      .sf-task-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; color: var(--text-tertiary); }
      .sf-task-duration { display: flex; align-items: center; gap: 3px; }
      .sf-task-deadline { color: var(--text-tertiary); }
      .sf-badge { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 8px; border: 1px solid; }
      .sf-status { font-size: 10.5px; font-weight: 600; }
      .sf-catdot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
      .sf-task-editbtn { position: absolute; top: 10px; right: 10px; background: none; border: none; color: var(--text-tertiary); }
      .sf-task-actions { display: flex; gap: 6px; margin-top: 9px; flex-wrap: wrap; }
      .sf-action {
        display: flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 500;
        background: var(--input-bg); border: 1px solid var(--card-border); color: var(--text-primary);
        border-radius: 10px; padding: 6px 9px;
      }
      .sf-action-primary { background: rgba(125,211,252,0.14); border-color: rgba(125,211,252,0.3); color: var(--accent-a); }
      .sf-action-success { background: rgba(110,231,183,0.14); border-color: rgba(110,231,183,0.3); color: var(--success); }
      .sf-action-muted { color: var(--text-secondary); }
      .sf-action-ghost { background: none; border: none; color: var(--text-tertiary); padding: 5px; }
      .sf-task-compact { padding: 12px; align-items: center; }
      .sf-task-actions-col { display: flex; flex-direction: column; gap: 4px; }

      /* ---------- modals ---------- */
      .sf-modal-overlay { position: fixed; inset: 0; background: var(--overlay); display: flex; align-items: flex-end; justify-content: center; z-index: 100; backdrop-filter: blur(3px); }
      .sf-modal {
        background: var(--modal-bg); border: 1px solid var(--card-border);
        border-radius: 24px 24px 0 0; padding: 22px 18px 26px; width: 100%; max-width: 430px;
        max-height: 88vh; overflow-y: auto; position: relative;
        animation: sfSlideUp 0.25s cubic-bezier(.25,.8,.35,1);
      }
      @keyframes sfSlideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .sf-modal-close { position: absolute; top: 16px; right: 16px; background: var(--input-bg); border: none; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); }
      .sf-modal-title { font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 600; margin-bottom: 4px; }
      .sf-modal-sub { color: var(--text-secondary); font-size: 12.5px; margin-bottom: 14px; }
      .sf-modal-buttons { display: flex; gap: 10px; margin-top: 16px; }

      .sf-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 11px 18px; border-radius: 14px; border: none; font-size: 14px; font-weight: 600; flex: 1; }
      .sf-btn-primary { background: linear-gradient(135deg, var(--accent-a), var(--accent-b)); color: #0a0e1a; }
      .sf-btn-ghost { background: var(--input-bg); color: var(--text-primary); border: 1px solid var(--card-border); }
      .sf-btn-danger { background: rgba(255,122,133,0.12); color: var(--danger); border: 1px solid rgba(255,122,133,0.3); margin-top: 8px; }

      .sf-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; flex: 1; font-size: 13px; color: var(--text-secondary); }
      .sf-field em { font-style: normal; font-size: 10.5px; color: var(--text-tertiary); }
      .sf-field input, .sf-field select, .sf-field textarea {
        background: var(--input-bg); border: 1px solid var(--card-border); border-radius: 12px;
        padding: 10px 12px; color: var(--text-primary); font-size: 14px; font-family: inherit; width: 100%;
      }
      .sf-field textarea { resize: vertical; }
      .sf-field-row { display: flex; gap: 10px; }
      .sf-checkbox-field { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-secondary); margin-bottom: 14px; }
      .sf-checkbox-field input { width: 16px; height: 16px; }
      .sf-computed-end { font-size: 12px; color: var(--text-tertiary); margin: -6px 0 12px; }

      .sf-conflict-box { background: rgba(255,122,133,0.08); border: 1px solid rgba(255,122,133,0.25); border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; }
      .sf-conflict-title { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--danger); margin-bottom: 8px; font-weight: 500; }
      .sf-suggest-row { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; gap: 8px; }

      .sf-slider { width: 100%; margin: 10px 0; accent-color: var(--accent-a); }
      .sf-partial-readout { text-align: center; font-size: 13px; color: var(--text-primary); margin-bottom: 4px; }
      .sf-partial-readout span { color: var(--text-tertiary); font-size: 11px; }

      .sf-focus-modal { text-align: center; padding-top: 30px; }
      .sf-focus-label { font-size: 11px; letter-spacing: 0.1em; color: var(--accent-a); font-weight: 600; margin-bottom: 8px; }
      .sf-focus-title { font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 600; margin-bottom: 18px; }
      .sf-focus-ringwrap { display: flex; justify-content: center; margin-bottom: 18px; }
      .sf-focus-clock { font-family: 'Space Grotesk', sans-serif; font-size: 15px; color: var(--text-secondary); margin-bottom: 20px; }
      .sf-focus-buttons { display: flex; gap: 10px; }

      /* ---------- onboarding ---------- */
      .sf-onboarding { padding: 40px 26px; display: flex; flex-direction: column; height: 100%; }
      .sf-onboarding-progress { display: flex; gap: 6px; margin-bottom: 30px; }
      .sf-dot { height: 4px; flex: 1; border-radius: 4px; background: var(--card-border); }
      .sf-dot-active { background: linear-gradient(90deg, var(--accent-a), var(--accent-b)); }
      .sf-onboarding-icon { color: var(--accent-b); margin-bottom: 14px; }
      .sf-onboarding-title { font-family: 'Space Grotesk', sans-serif; font-size: 24px; font-weight: 600; margin-bottom: 8px; }
      .sf-onboarding-sub { color: var(--text-secondary); font-size: 13.5px; margin-bottom: 26px; line-height: 1.5; }
      .sf-onboarding-body { flex: 1; }
      .sf-onboarding-nav { display: flex; align-items: center; margin-top: 20px; }
      .sf-onboarding-nav .sf-btn { flex: none; }

      /* ---------- calendar ---------- */
      .sf-cal-modes { display: flex; background: var(--input-bg); border-radius: 14px; padding: 4px; margin-bottom: 16px; }
      .sf-cal-mode { flex: 1; background: none; border: none; color: var(--text-secondary); font-size: 13px; font-weight: 500; padding: 8px; border-radius: 10px; }
      .sf-cal-mode-active { background: var(--card-bg); color: var(--text-primary); box-shadow: 0 1px 4px rgba(0,0,0,0.15); }
      .sf-day-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      .sf-day-nav-label { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; }
      .sf-today-pill { font-size: 10px; background: rgba(125,211,252,0.15); color: var(--accent-a); padding: 2px 8px; border-radius: 8px; }
      .sf-iconbtn { background: var(--input-bg); border: 1px solid var(--card-border); border-radius: 10px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; color: var(--text-primary); }

      .sf-week-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
      .sf-week-col { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 6px 4px; display: flex; flex-direction: column; gap: 4px; min-height: 130px; text-align: left; }
      .sf-week-col-today { border-color: var(--accent-a); }
      .sf-week-col-head { text-align: center; margin-bottom: 4px; }
      .sf-week-dayname { display: block; font-size: 9px; color: var(--text-tertiary); text-transform: uppercase; }
      .sf-week-daynum { display: block; font-size: 13px; font-weight: 600; }
      .sf-week-col-body { display: flex; flex-direction: column; gap: 3px; }
      .sf-week-chip { font-size: 8.5px; border-radius: 5px; padding: 3px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sf-week-more { font-size: 8px; color: var(--text-tertiary); text-align: center; }

      .sf-month-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 10px; color: var(--text-tertiary); margin-bottom: 6px; }
      .sf-month-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
      .sf-month-cell { aspect-ratio: 1; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font-size: 12px; color: var(--text-primary); }
      .sf-month-cell-empty { background: none; border: none; }
      .sf-month-cell-today { border-color: var(--accent-a); color: var(--accent-a); font-weight: 700; }
      .sf-month-dots { display: flex; gap: 2px; }
      .sf-month-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--accent-b); }

      /* ---------- tasks list ---------- */
      .sf-search-row { display: flex; align-items: center; gap: 8px; background: var(--input-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 10px 14px; margin-bottom: 12px; }
      .sf-search-icon { color: var(--text-tertiary); flex-shrink: 0; }
      .sf-search-input { background: none; border: none; outline: none; color: var(--text-primary); font-size: 14px; width: 100%; }
      .sf-chip-row { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 10px; padding-bottom: 2px; }
      .sf-chip { flex-shrink: 0; background: var(--input-bg); border: 1px solid var(--card-border); color: var(--text-secondary); font-size: 12px; padding: 6px 12px; border-radius: 20px; white-space: nowrap; }
      .sf-chip-active { background: linear-gradient(135deg, var(--accent-a), var(--accent-b)); color: #0a0e1a; border-color: transparent; font-weight: 600; }

      .sf-fab { position: absolute; bottom: 92px; right: 18px; width: 52px; height: 52px; border-radius: 50%; background: linear-gradient(135deg, var(--accent-a), var(--accent-b)); color: #0a0e1a; border: none; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 26px -6px rgba(125,211,252,0.5); }
      .sf-fab-raised { position: absolute; }

      /* ---------- insights ---------- */
      .sf-insight-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
      .sf-stat-card { padding: 14px 8px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
      .sf-stat-num { font-family: 'Space Grotesk', sans-serif; font-size: 19px; font-weight: 700; }
      .sf-stat-label { font-size: 9.5px; color: var(--text-tertiary); text-align: center; line-height: 1.3; }
      .sf-chart-card { padding: 16px; margin-bottom: 14px; }
      .sf-chart-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; }
      .sf-legend-row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; justify-content: center; }
      .sf-legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-secondary); }

      /* ---------- settings ---------- */
      .sf-settings-block { padding: 16px; margin-bottom: 14px; }
      .sf-settings-title { font-weight: 600; font-size: 14px; margin-bottom: 12px; }
      .sf-settings-sub { font-size: 12px; color: var(--text-secondary); margin-bottom: 10px; }
      .sf-theme-toggle { display: flex; gap: 8px; }
      .sf-theme-opt { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; border-radius: 12px; border: 1px solid var(--card-border); background: var(--input-bg); color: var(--text-secondary); font-size: 13px; }
      .sf-theme-opt-active { background: linear-gradient(135deg, var(--accent-a), var(--accent-b)); color: #0a0e1a; font-weight: 600; border-color: transparent; }
      .sf-switch-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; font-size: 13px; color: var(--text-primary); }
      .sf-switch-row span { display: flex; align-items: center; gap: 7px; }

      /* ---------- bottom nav ---------- */
      .sf-bottomnav { display: flex; background: var(--nav-bg); border-top: 1px solid var(--card-border); backdrop-filter: blur(20px); padding: 8px 4px calc(8px + env(safe-area-inset-bottom, 0px)); }
      .sf-navitem { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; background: none; border: none; color: var(--text-tertiary); font-size: 10px; padding: 6px 0; }
      .sf-navitem-active { color: var(--accent-a); }

      @media (max-width: 380px) {
        .sf-hero { flex-direction: column; }
      }
    `}</style>
  );
}
